import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-ai-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'test.sqlite');
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-validation';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'gemini-3.8-flash';

const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');
migrateDatabase(db);
const { assessmentSchema, geminiResponseSchema } = await import('../src/modules/intelligence/intelligence.validation.js');
const { processNextAssessment, recoverInterruptedAssessments } = await import('../src/modules/intelligence/intelligence.worker.js');
const { getOwnedAssessment } = await import('../src/modules/intelligence/intelligence.service.js');
const { classifyComplaint, classifyProviderError, redactPersonalDetails } = await import('../src/services/geminiProvider.js');

const validAssessment = {
  category: 'ROAD_DAMAGE',
  department: 'Roads & Infrastructure',
  severity: 'LOW',
  severity_reason: 'A small defect is described on a quiet street with no reported danger.',
  risk_factors: ['Limited traffic exposure'],
  confidence: 0.91,
  human_review_required: false,
  human_review_reason: ''
};

after(() => {
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

function addComplaint(userId = 1, assessmentStatus = 'PENDING') {
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) {
    db.prepare(`INSERT INTO users (id, display_name, email, password_hash) VALUES (?, ?, ?, 'hash')`)
      .run(userId, `User ${userId}`, `user${userId}@example.test`);
  }
  const complaintId = Number(db.prepare(`INSERT INTO complaints
    (user_id, title, description, latitude, longitude) VALUES (?, 'Road issue', 'A road issue was reported here.', 0, 0)`)
    .run(userId).lastInsertRowid);
  const assessmentId = Number(db.prepare(`INSERT INTO complaint_ai_assessments (complaint_id, status)
    VALUES (?, ?)`).run(complaintId, assessmentStatus).lastInsertRowid);
  return { complaintId, assessmentId };
}

test('valid classification passes and invalid taxonomy, severity, and confidence fail', () => {
  assert.equal(assessmentSchema.safeParse(validAssessment).success, true);
  assert.equal(assessmentSchema.safeParse({ ...validAssessment, category: 'MADE_UP' }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessment, severity: 'URGENT' }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessment, confidence: 1.01 }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessment, confidence: -0.01 }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessment, department: 'Sanitation' }).success, false);
});

test('insufficient facts require a review reason; urgency language does not define severity', async () => {
  const sparse = {
    ...validAssessment,
    severity: 'MEDIUM',
    severity_reason: 'The report does not identify the issue scale or exposure.',
    risk_factors: [],
    confidence: 0.35,
    human_review_required: true,
    human_review_reason: 'Location, size, and public exposure are missing.'
  };
  assert.equal(assessmentSchema.safeParse(sparse).success, true);
  assert.equal(assessmentSchema.safeParse({ ...sparse, human_review_reason: '' }).success, false);

  const requested = [];
  const mockClient = { models: { generateContent: async (request) => {
    requested.push(request);
    return { text: JSON.stringify(validAssessment) };
  } } };
  const result = await classifyComplaint({ title: 'CRITICAL emergency', description: 'Small garbage pile; no other danger described.' }, mockClient);
  assert.equal(result.severity, 'LOW');
  assert.match(requested[0].config.systemInstruction, /not urgency words/);
  assert.equal(requested[0].config.responseMimeType, 'application/json');
  assert.equal(requested[0].config.responseSchema, geminiResponseSchema);
  assert.deepEqual(requested[0].config.thinkingConfig, { thinkingLevel: 'LOW' });
  const privateText = redactPersonalDetails('My name is Asha Rao, email a@b.com, call +91 98765 43210 at Flat 12, 123 Main Road');
  assert.doesNotMatch(privateText, /Asha Rao|a@b\.com|98765|Flat 12|123 Main Road/);
  await classifyComplaint({ title: 'Road issue', description: privateText }, mockClient);
  assert.match(requested[1].contents, /\[ADDRESS REDACTED\]/);
  assert.doesNotMatch(requested[1].contents, /Asha Rao|a@b\.com|98765|Flat 12|123 Main Road/);
});

test('Gemini HTTP 504 is TIMEOUT while HTTP 500 remains SERVER', () => {
  assert.equal(classifyProviderError(Object.assign(new Error('gateway timeout'), { status: 504 })).category, 'TIMEOUT');
  assert.equal(classifyProviderError(Object.assign(new Error('provider error'), { status: 500 })).category, 'SERVER');
});

test('high danger fixture supports CRITICAL only with evidence and review', () => {
  const fallenWire = {
    ...validAssessment,
    category: 'STREETLIGHT',
    department: 'Electricity',
    severity: 'CRITICAL',
    severity_reason: 'A live fallen wire is reported across an accessible public footpath.',
    risk_factors: ['Live wire', 'Public access'],
    confidence: 0.84,
    human_review_required: true,
    human_review_reason: 'An officer must verify the live electrical hazard and secure the area.'
  };
  assert.equal(assessmentSchema.safeParse(fallenWire).success, true);
  assert.equal(assessmentSchema.safeParse({ ...fallenWire, human_review_required: false }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...fallenWire, severity_reason: 'Danger reported.' }).success, false);
  const garbage = { ...validAssessment, category: 'WASTE_MANAGEMENT', department: 'Sanitation' };
  assert.equal(assessmentSchema.safeParse(garbage).success, true);
});

test('Gemini retries a rate limit once, while timeout fails safely', async () => {
  let calls = 0;
  const rateLimited = { models: { generateContent: async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('private provider details'), { status: 429 });
    return { text: JSON.stringify(validAssessment) };
  } } };
  assert.equal((await classifyComplaint({ title: 'Title', description: 'Description' }, rateLimited)).severity, 'LOW');
  assert.equal(calls, 2);

  calls = 0;
  const timeout = { models: { generateContent: async () => {
    calls += 1;
    throw Object.assign(new Error('sensitive text'), { name: 'TimeoutError' });
  } } };
  await assert.rejects(classifyComplaint({ title: 'Title', description: 'Description' }, timeout), (error) => {
    assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(error.message, 'Classification provider request failed');
    return true;
  });
  assert.equal(calls, 2);
});

test('malformed risk factors do not break assessment retrieval', () => {
  const { complaintId } = addComplaint(1, 'SUCCEEDED');
  db.prepare(`UPDATE complaint_ai_assessments
    SET category='ROAD_DAMAGE', department='Roads & Infrastructure', severity='LOW',
        risk_factors='not-json', confidence=0.8, human_review_required=0
    WHERE complaint_id=?`).run(complaintId);
  assert.deepEqual(getOwnedAssessment(1, complaintId).risk_factors, []);
  assert.equal(getOwnedAssessment(2, complaintId), null);
});

test('assessment failure leaves complaint persisted and ownership limits retrieval', async () => {
  const { complaintId } = addComplaint(1);
  const processed = await processNextAssessment(async () => { throw new Error('provider unavailable'); });
  assert.equal(processed, true);
  assert.ok(db.prepare('SELECT id FROM complaints WHERE id = ?').get(complaintId));
  assert.equal(getOwnedAssessment(1, complaintId).status, 'FAILED');
  assert.equal(getOwnedAssessment(2, complaintId), null);
});

test('valid output is persisted; competing workers cannot claim a PROCESSING assessment twice', async () => {
  const { complaintId } = addComplaint(1);
  let release;
  let calls = 0;
  const classifier = async () => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
    return validAssessment;
  };
  const first = processNextAssessment(classifier);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await processNextAssessment(classifier), false);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.equal(getOwnedAssessment(1, complaintId).status, 'SUCCEEDED');
});

test('PROCESSING assessments are returned to PENDING for restart recovery', () => {
  const { assessmentId } = addComplaint(1, 'PROCESSING');
  db.prepare(`UPDATE complaint_ai_assessments SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).run(assessmentId);
  recoverInterruptedAssessments();
  assert.equal(db.prepare('SELECT status FROM complaint_ai_assessments WHERE id = ?').get(assessmentId).status, 'PENDING');
});
