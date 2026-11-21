import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-admin-officers-test-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_PATH: path.join(tempDirectory, 'admin-officers.sqlite'),
  JWT_SECRET: 'admin-officers-test-secret-long-enough',
  CORS_ORIGINS: 'http://localhost:3000',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'test-key',
  GEMINI_API_KEY: 'test-key',
  GEMINI_MODEL: 'gemini-3.5-flash-lite'
});

const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');
migrateDatabase(db);
const { createAdminRouter } = await import('../src/modules/admin/admin.routes.js');
const { VerificationError } = await import('../src/modules/auth/verification.service.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const invitationCalls = [];
let failInvitation = false;
const verificationSender = async (userId, purpose) => {
  invitationCalls.push({ userId, purpose });
  if (failInvitation) throw new VerificationError('Email delivery failed', 503);
  return { resendAfter: '2026-11-20T13:00:00.000Z' };
};
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin', createAdminRouter({
  createComplaintReadUrl: async () => 'signed',
  createRepairEvidenceReadUrl: async () => 'signed',
  createSupportAttachmentReadUrl: async () => 'signed'
}, verificationSender));
app.use(errorHandler);

let server;
let baseUrl;
let wardId;
let otherWardId;
let teamA;
let teamB;
let otherWardTeam;
let officerId;
let issueId;

function tokenFor(userId, version = 0) {
  return jwt.sign({ ver: version }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: 'civicpulse-api',
    audience: 'civicpulse-client'
  });
}

async function request(pathname, { userId = 1, method = 'GET', body } = {}) {
  const headers = { cookie: `civicpulse_token=${tokenFor(userId)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function createOfficerBody(overrides = {}) {
  return {
    displayName: 'New Officer',
    email: 'new.officer@example.test',
    wardId,
    teamIds: [teamA, teamB],
    ...overrides
  };
}

before(async () => {
  db.prepare(`INSERT INTO users(id,display_name,email,password_hash,role,email_verified)
    VALUES(1,'Admin','admin@example.test','hash','ADMIN',1),
      (2,'Citizen','citizen@example.test','hash','CITIZEN',1),
      (3,'Existing Officer','existing.officer@example.test','hash','OFFICER',1)`).run();
  wardId = Number(db.prepare("INSERT INTO wards(code,name) VALUES('NORTH','North Ward')").run().lastInsertRowid);
  otherWardId = Number(db.prepare("INSERT INTO wards(code,name) VALUES('SOUTH','South Ward')").run().lastInsertRowid);
  teamA = Number(db.prepare(`INSERT INTO ward_teams(ward_id,name,department)
    VALUES(?,'Roads Team','Roads & Infrastructure')`).run(wardId).lastInsertRowid);
  teamB = Number(db.prepare(`INSERT INTO ward_teams(ward_id,name,department)
    VALUES(?,'Water Team','Water Supply')`).run(wardId).lastInsertRowid);
  otherWardTeam = Number(db.prepare(`INSERT INTO ward_teams(ward_id,name,department)
    VALUES(?,'South Roads Team','Roads & Infrastructure')`).run(otherWardId).lastInsertRowid);
  issueId = Number(db.prepare('INSERT INTO civic_issues DEFAULT VALUES').run().lastInsertRowid);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('Admin creates a pending OFFICER with a unique employee ID, team memberships, and an email invitation', async () => {
  const response = await request('/api/admin/officers', {
    method: 'POST',
    body: createOfficerBody()
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  officerId = result.officer.id;
  assert.equal(result.officer.name, 'New Officer');
  assert.equal(result.officer.email, 'new.officer@example.test');
  assert.match(result.officer.employeeId, /^EMP-[0-9A-F]{12}$/);
  assert.equal(result.officer.status, 'PENDING_EMAIL_VERIFICATION');
  assert.equal(result.invitation.sent, true);
  assert.equal(result.officer.teams.length, 2);
  assert.equal(JSON.stringify(result).includes('password'), false);
  assert.deepEqual(invitationCalls[0], { userId: officerId, purpose: 'REGISTRATION' });
  assert.deepEqual(db.prepare('SELECT role,employee_id,account_status,email_verified FROM users WHERE id=?').get(officerId), {
    role: 'OFFICER',
    employee_id: result.officer.employeeId,
    account_status: 'PENDING_EMAIL_VERIFICATION',
    email_verified: 0
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM officer_account_events WHERE officer_user_id=?').get(officerId).count, 1);
});

test('Admin officer creation validates ward membership and rejects client-selected employee IDs', async () => {
  const missingWard = await request('/api/admin/officers', {
    method: 'POST',
    body: createOfficerBody({ email: 'missing-ward@example.test', wardId: 99999 })
  });
  assert.equal(missingWard.status, 404);

  const mismatchedTeam = await request('/api/admin/officers', {
    method: 'POST',
    body: createOfficerBody({ email: 'mismatched-team@example.test', wardId: otherWardId, teamIds: [teamA] })
  });
  assert.equal(mismatchedTeam.status, 409);

  const clientSelectedId = await request('/api/admin/officers', {
    method: 'POST',
    body: createOfficerBody({ email: 'client-id@example.test', employeeId: 'EMP-OVERRIDE' })
  });
  assert.equal(clientSelectedId.status, 400);
});

test('generated employee IDs remain unique across concurrent Officer creation', async () => {
  const [first, second] = await Promise.all([
    request('/api/admin/officers', {
      method: 'POST',
      body: createOfficerBody({ email: 'concurrent-one@example.test' })
    }),
    request('/api/admin/officers', {
      method: 'POST',
      body: createOfficerBody({ email: 'concurrent-two@example.test' })
    })
  ]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstId = (await first.json()).officer.employeeId;
  const secondId = (await second.json()).officer.employeeId;
  assert.match(firstId, /^EMP-[0-9A-F]{12}$/);
  assert.match(secondId, /^EMP-[0-9A-F]{12}$/);
  assert.notEqual(firstId, secondId);
});

test('Admin officer listing validates filters, paginates, searches employee IDs, and returns missing records explicitly', async () => {
  const page = await request('/api/admin/officers?limit=1&offset=0');
  assert.equal(page.status, 200);
  const result = await page.json();
  assert.equal(result.items.length, 1);
  assert.equal(result.pagination.hasMore, true);

  const createdResponse = await request(`/api/admin/officers/${officerId}`);
  const employeeId = (await createdResponse.json()).officer.employeeId;
  const search = await request(`/api/admin/officers?search=${encodeURIComponent(employeeId.toLowerCase())}&status=PENDING_EMAIL_VERIFICATION`);
  assert.equal(search.status, 200);
  assert.deepEqual((await search.json()).items.map((officer) => officer.id), [officerId]);

  const invalid = await request('/api/admin/officers?limit=51');
  assert.equal(invalid.status, 400);
  const invalidBody = await request('/api/admin/officers', {
    method: 'POST',
    body: createOfficerBody({ teamIds: [teamA, teamA] })
  });
  assert.equal(invalidBody.status, 400);

  const duplicate = await request('/api/admin/officers', {
    method: 'POST',
    body: createOfficerBody({ email: 'new.officer@example.test' })
  });
  assert.equal(duplicate.status, 409);

  const missing = await request('/api/admin/officers/99999');
  assert.equal(missing.status, 404);
});

test('invitation delivery failures are visible and can be retried without duplicating the account', async () => {
  failInvitation = true;
  const response = await request('/api/admin/officers', {
    method: 'POST',
    body: createOfficerBody({
      displayName: 'Pending Officer',
      email: 'pending.officer@example.test',
      wardId: otherWardId,
      teamIds: [otherWardTeam]
    })
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.invitation.sent, false);
  assert.match(result.invitation.error, /verification email could not be sent/i);
  assert.match(result.officer.employeeId, /^EMP-[0-9A-F]{12}$/);
  assert.notEqual(result.officer.employeeId, db.prepare('SELECT employee_id FROM users WHERE id=?').get(officerId).employee_id);
  const createdId = result.officer.id;

  failInvitation = false;
  const retry = await request(`/api/admin/officers/${createdId}/invitation`, { method: 'POST' });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).invitation.sent, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE email=?').get('pending.officer@example.test').count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM officer_account_events WHERE officer_user_id=? AND event_type='INVITATION_RESENT'")
    .get(createdId).count, 1);
});

test('Admin deactivation revokes sessions and excludes an officer from active team routing; reactivation restores eligibility', async () => {
  db.prepare(`UPDATE users SET account_status='ACTIVE',email_verified=1,email_verified_at='2026-11-20T12:00:00.000Z'
    WHERE id=?`).run(officerId);
  db.prepare(`INSERT INTO ward_team_memberships(team_id,officer_user_id,added_by_admin_id)
    VALUES(?,?,1)`).run(teamA, 3);

  const assignment = await request(`/api/admin/civic-issues/${issueId}/team-assignments`, {
    method: 'POST',
    body: { teamId: teamA, routingDepartment: 'Roads & Infrastructure' }
  });
  assert.equal(assignment.status, 201);

  const previousVersion = db.prepare('SELECT session_version FROM users WHERE id=?').get(officerId).session_version;
  const deactivated = await request(`/api/admin/officers/${officerId}/status`, {
    method: 'PATCH',
    body: { status: 'DEACTIVATED' }
  });
  assert.equal(deactivated.status, 200);
  assert.equal((await deactivated.json()).officer.status, 'DEACTIVATED');
  assert.equal(db.prepare('SELECT session_version FROM users WHERE id=?').get(officerId).session_version, previousVersion + 1);
  assert.equal((await (await request(`/api/admin/ward-teams/${teamA}`)).json()).team.activeMemberCount, 1);

  const noActiveReplacement = await request(`/api/admin/civic-issues/${issueId}/team-assignments/reassign`, {
    method: 'POST',
    body: { teamId: teamB, routingDepartment: 'Water Supply' }
  });
  assert.equal(noActiveReplacement.status, 409);
  const addDeactivated = await request(`/api/admin/ward-teams/${teamB}/members`, {
    method: 'POST',
    body: { officerId }
  });
  assert.equal(addDeactivated.status, 400);

  const reactivated = await request(`/api/admin/officers/${officerId}/status`, {
    method: 'PATCH',
    body: { status: 'ACTIVE' }
  });
  assert.equal(reactivated.status, 200);
  assert.equal((await reactivated.json()).officer.status, 'ACTIVE');
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM officer_account_events
    WHERE officer_user_id=? AND event_type IN ('ACTIVATED','DEACTIVATED')`).get(officerId).count, 2);
});

test('citizens and officers cannot use Admin officer management endpoints', async () => {
  for (const userId of [2, 3]) {
    assert.equal((await request('/api/admin/officers', { userId })).status, 403);
    assert.equal((await request(`/api/admin/officers/${officerId}`, { userId })).status, 403);
    assert.equal((await request('/api/admin/officers', {
      userId,
      method: 'POST',
      body: createOfficerBody({ employeeId: 'ESCALATION-1' })
    })).status, 403);
  }
});
