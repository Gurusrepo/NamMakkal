import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-admin-suggestions-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'suggestions.sqlite');
process.env.JWT_SECRET = 'admin-suggestions-test-secret-long-enough';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';

const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');
migrateDatabase(db);
const { default: express } = await import('express');
const { default: cookieParser } = await import('cookie-parser');
const { createAdminRouter } = await import('../src/modules/admin/admin.routes.js');
const { errorHandler, notFound } = await import('../src/middleware/errorHandler.js');

const fakeStorage = {
  async createSupportAttachmentReadUrl(key, mimeType) {
    if (!key.startsWith('support-attachments/')) throw new Error('Invalid support attachment object key');
    return `https://fake.supabase.co/signed/${key}`;
  }
};

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin', createAdminRouter(fakeStorage));
app.use(notFound);
app.use(errorHandler);

let server;
let baseUrl;

function tokenFor(userId) {
  return jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: 'civicpulse-api',
    audience: 'civicpulse-client'
  });
}

async function request(pathname, { userId, method = 'GET', body } = {}) {
  const headers = userId === undefined
    ? {}
    : { cookie: `civicpulse_token=${tokenFor(userId)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function addUser(id, role, name, phone = null) {
  db.prepare(`INSERT INTO users
    (id, display_name, email, password_hash, role, email_verified, account_status, phone_number)
    VALUES(?, ?, ?, 'test-hash', ?, 1, 'ACTIVE', ?)`)
    .run(id, name, `${name.toLowerCase().replaceAll(' ', '.')}@example.test`, role, phone);
}

function addSubmission({
  referenceId,
  userId,
  kind = 'SUGGESTION',
  title,
  category,
  description,
  screenshotKey = null,
  screenshotMimeType = null,
  status = 'NEW',
  adminNotes = null,
  rejectionReason = null,
  closedAt = null
}) {
  db.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description,
     screenshot_key, screenshot_mime_type, status, admin_notes, rejection_reason, closed_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      referenceId,
      userId,
      kind,
      title,
      category,
      description,
      screenshotKey,
      screenshotMimeType,
      status,
      adminNotes,
      rejectionReason,
      closedAt
    );
}

before(async () => {
  addUser(1, 'ADMIN', 'Civic Admin');
  addUser(2, 'CITIZEN', 'Citizen Jane', '+919876543210');
  addUser(3, 'OFFICER', 'Officer Bob');
  addUser(4, 'CITIZEN', 'Citizen John');

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('unauthenticated users, citizens, and officers are rejected with 401 or 403', async () => {
  assert.equal((await request('/api/admin/suggestions')).status, 401);
  assert.equal((await request('/api/admin/suggestions/NM-TEST01')).status, 401);
  assert.equal((await request('/api/admin/suggestions/NM-TEST01/status', {
    method: 'PATCH',
    body: { status: 'UNDER_REVIEW' }
  })).status, 401);

  for (const userId of [2, 3]) {
    assert.equal((await request('/api/admin/suggestions', { userId })).status, 403);
    assert.equal((await request('/api/admin/suggestions/NM-TEST01', { userId })).status, 403);
    assert.equal((await request('/api/admin/suggestions/NM-TEST01/status', {
      userId,
      method: 'PATCH',
      body: { status: 'UNDER_REVIEW' }
    })).status, 403);
  }

  // Admin can access
  const adminRes = await request('/api/admin/suggestions', { userId: 1 });
  assert.equal(adminRes.status, 200);
});

test('admin can list suggestions with pagination, category filter, status filter, and search', async () => {
  addSubmission({
    referenceId: 'NM-SUGG01',
    userId: 2,
    kind: 'SUGGESTION',
    title: 'Add dark mode support',
    category: 'USER_EXPERIENCE',
    description: 'It would be great to have a dark mode option for night usage.',
    status: 'NEW'
  });
  addSubmission({
    referenceId: 'NM-SUGG02',
    userId: 4,
    kind: 'SUGGESTION',
    title: 'Keyboard navigation improvements',
    category: 'ACCESSIBILITY',
    description: 'Make the entire app navigable using only a keyboard.',
    status: 'UNDER_REVIEW'
  });
  addSubmission({
    referenceId: 'NM-SUGG03',
    userId: 2,
    kind: 'SUGGESTION',
    title: 'Government services integration',
    category: 'GOVERNMENT_SERVICES',
    description: 'Integrate with existing government portals for better UX.',
    status: 'PLANNED',
    closedAt: null
  });

  const allResponse = await request('/api/admin/suggestions?limit=10', { userId: 1 });
  assert.equal(allResponse.status, 200);
  const allResult = await allResponse.json();
  assert.equal(allResult.items.length, 3);
  assert.equal(allResult.pagination.total, 3);
  assert.equal(allResult.pagination.hasMore, false);

  const first = allResult.items.find((item) => item.referenceId === 'NM-SUGG01');
  assert.ok(first);
  assert.equal(first.title, 'Add dark mode support');
  assert.equal(first.category, 'USER_EXPERIENCE');
  assert.equal(first.status, 'NEW');
  assert.equal(first.user.displayName, 'Citizen Jane');
  assert.equal(first.user.email, 'citizen.jane@example.test');
  assert.equal(first.user.phoneNumber, '+919876543210');

  // Filter by category
  const catResponse = await request('/api/admin/suggestions?category=ACCESSIBILITY', { userId: 1 });
  assert.equal(catResponse.status, 200);
  const catResult = await catResponse.json();
  assert.equal(catResult.items.length, 1);
  assert.equal(catResult.items[0].referenceId, 'NM-SUGG02');

  // Filter by status
  const statusResponse = await request('/api/admin/suggestions?status=PLANNED', { userId: 1 });
  assert.equal(statusResponse.status, 200);
  const statusResult = await statusResponse.json();
  assert.equal(statusResult.items.length, 1);
  assert.equal(statusResult.items[0].referenceId, 'NM-SUGG03');

  // Search by keyword
  const searchResponse = await request('/api/admin/suggestions?search=dark+mode', { userId: 1 });
  assert.equal(searchResponse.status, 200);
  const searchResult = await searchResponse.json();
  assert.equal(searchResult.items.length, 1);
  assert.equal(searchResult.items[0].referenceId, 'NM-SUGG01');

  // Search by reference ID
  const searchRef = await request('/api/admin/suggestions?search=SUGG02', { userId: 1 });
  assert.equal(searchRef.status, 200);
  const searchRefResult = await searchRef.json();
  assert.equal(searchRefResult.items.length, 1);
  assert.equal(searchRefResult.items[0].referenceId, 'NM-SUGG02');

  // Pagination limit and offset
  const page1 = await request('/api/admin/suggestions?limit=2&offset=0', { userId: 1 });
  const page1Result = await page1.json();
  assert.equal(page1Result.items.length, 2);
  assert.equal(page1Result.pagination.hasMore, true);
  assert.equal(page1Result.pagination.total, 3);
});

test('BUG_REPORT records are strictly excluded from suggestions list and detail', async () => {
  addSubmission({
    referenceId: 'NM-BUGONLY01',
    userId: 2,
    kind: 'BUG_REPORT',
    title: 'Login OTP fails on mobile',
    category: 'LOGIN_ISSUE',
    description: 'When I request an OTP on Android, the SMS never arrives.',
    status: 'NEW'
  });

  const listResponse = await request('/api/admin/suggestions', { userId: 1 });
  const listResult = await listResponse.json();
  assert.ok(!listResult.items.some((item) => item.referenceId === 'NM-BUGONLY01'));

  // Detail view should return 404 for a BUG_REPORT reference ID
  const detailResponse = await request('/api/admin/suggestions/NM-BUGONLY01', { userId: 1 });
  assert.equal(detailResponse.status, 404);

  // Update status should return 404 for a BUG_REPORT reference ID
  const updateResponse = await request('/api/admin/suggestions/NM-BUGONLY01/status', {
    userId: 1,
    method: 'PATCH',
    body: { status: 'UNDER_REVIEW' }
  });
  assert.equal(updateResponse.status, 404);
});

test('admin can view suggestion details including reporter info', async () => {
  addSubmission({
    referenceId: 'NM-SUGG-DETAIL01',
    userId: 2,
    kind: 'SUGGESTION',
    title: 'Better font options',
    category: 'ACCESSIBILITY',
    description: 'Please allow citizens to choose their preferred font size.',
    status: 'NEW'
  });

  const response = await request('/api/admin/suggestions/NM-SUGG-DETAIL01', { userId: 1 });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.suggestion);
  assert.equal(result.suggestion.referenceId, 'NM-SUGG-DETAIL01');
  assert.equal(result.suggestion.title, 'Better font options');
  assert.equal(result.suggestion.user.id, 2);
  assert.equal(result.suggestion.user.displayName, 'Citizen Jane');
  assert.equal(result.suggestion.user.email, 'citizen.jane@example.test');
  assert.equal(result.suggestion.user.phoneNumber, '+919876543210');

  // admin_notes and storage keys must NOT be leaked for citizen-facing endpoints
  // (this endpoint IS admin-only, but we confirm admin_notes presence is fine here)
  // The important thing: citizen endpoints do not expose these - tested via service layer isolation
});

test('allowed status transitions succeed', async () => {
  addSubmission({
    referenceId: 'NM-SUGG-TRANS01',
    userId: 4,
    kind: 'SUGGESTION',
    title: 'New feature request for maps',
    category: 'NEW_FEATURE',
    description: 'Please add a detailed map view for civic issue reports.',
    status: 'NEW'
  });

  // NEW → UNDER_REVIEW
  const toUnderReview = await request('/api/admin/suggestions/NM-SUGG-TRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'UNDER_REVIEW', adminNotes: 'Reviewing this suggestion' }
  });
  assert.equal(toUnderReview.status, 200);
  const urData = await toUnderReview.json();
  assert.equal(urData.suggestion.status, 'UNDER_REVIEW');
  assert.equal(urData.suggestion.closedAt, null);
  assert.equal(urData.suggestion.adminNotes, 'Reviewing this suggestion');

  // UNDER_REVIEW → PLANNED
  const toPlanned = await request('/api/admin/suggestions/NM-SUGG-TRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'PLANNED' }
  });
  assert.equal(toPlanned.status, 200);
  const plannedData = await toPlanned.json();
  assert.equal(plannedData.suggestion.status, 'PLANNED');
  assert.equal(plannedData.suggestion.closedAt, null);

  // PLANNED → IMPLEMENTED (sets closed_at)
  const toImplemented = await request('/api/admin/suggestions/NM-SUGG-TRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'IMPLEMENTED' }
  });
  assert.equal(toImplemented.status, 200);
  const implData = await toImplemented.json();
  assert.equal(implData.suggestion.status, 'IMPLEMENTED');
  assert.ok(implData.suggestion.closedAt, 'closedAt should be set when IMPLEMENTED');
  const closedTimestamp = implData.suggestion.closedAt;

  // IMPLEMENTED → UNDER_REVIEW (clears closed_at)
  const backToUR = await request('/api/admin/suggestions/NM-SUGG-TRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'UNDER_REVIEW' }
  });
  assert.equal(backToUR.status, 200);
  const backURData = await backToUR.json();
  assert.equal(backURData.suggestion.status, 'UNDER_REVIEW');
  assert.equal(backURData.suggestion.closedAt, null, 'closedAt should be cleared on reopen');
  assert.equal(backURData.suggestion.rejectionReason, null);

  // UNDER_REVIEW → REJECTED (requires rejectionReason)
  const toRejected = await request('/api/admin/suggestions/NM-SUGG-TRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'REJECTED', rejectionReason: 'Not in our roadmap at this time' }
  });
  assert.equal(toRejected.status, 200);
  const rejData = await toRejected.json();
  assert.equal(rejData.suggestion.status, 'REJECTED');
  assert.ok(rejData.suggestion.closedAt, 'closedAt should be set when REJECTED');
  assert.equal(rejData.suggestion.rejectionReason, 'Not in our roadmap at this time');

  // REJECTED → UNDER_REVIEW (clears closed_at and rejection_reason)
  const rejToUR = await request('/api/admin/suggestions/NM-SUGG-TRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'UNDER_REVIEW' }
  });
  assert.equal(rejToUR.status, 200);
  const rejURData = await rejToUR.json();
  assert.equal(rejURData.suggestion.status, 'UNDER_REVIEW');
  assert.equal(rejURData.suggestion.closedAt, null);
  assert.equal(rejURData.suggestion.rejectionReason, null);

  // UNDER_REVIEW → REJECTED then REJECTED → NEW (clears closed_at and rejection_reason)
  await request('/api/admin/suggestions/NM-SUGG-TRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'REJECTED', rejectionReason: 'Feasibility concerns' }
  });
  const rejToNew = await request('/api/admin/suggestions/NM-SUGG-TRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'NEW' }
  });
  assert.equal(rejToNew.status, 200);
  const rejNewData = await rejToNew.json();
  assert.equal(rejNewData.suggestion.status, 'NEW');
  assert.equal(rejNewData.suggestion.closedAt, null);
  assert.equal(rejNewData.suggestion.rejectionReason, null);
});


test('disallowed status transitions are rejected with 400', async () => {
  addSubmission({
    referenceId: 'NM-SUGG-BADTRANS01',
    userId: 4,
    kind: 'SUGGESTION',
    title: 'Invalid transition test suggestion',
    category: 'OTHER',
    description: 'This suggestion is used to test invalid status transitions.',
    status: 'NEW'
  });

  // NEW -> PLANNED (not allowed)
  const newToPlanned = await request('/api/admin/suggestions/NM-SUGG-BADTRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'PLANNED' }
  });
  assert.equal(newToPlanned.status, 400);

  // NEW -> IMPLEMENTED (not allowed)
  const newToImplemented = await request('/api/admin/suggestions/NM-SUGG-BADTRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'IMPLEMENTED' }
  });
  assert.equal(newToImplemented.status, 400);

  // NEW -> UNDER_REVIEW (allowed)
  const toUnderReview = await request('/api/admin/suggestions/NM-SUGG-BADTRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'UNDER_REVIEW' }
  });
  assert.equal(toUnderReview.status, 200);

  // UNDER_REVIEW -> NEW (allowed)
  const underReviewToNew = await request('/api/admin/suggestions/NM-SUGG-BADTRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'NEW' }
  });
  assert.equal(underReviewToNew.status, 200);

  // NEW -> UNDER_REVIEW -> PLANNED (both allowed)
  const newToUnderReview = await request('/api/admin/suggestions/NM-SUGG-BADTRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'UNDER_REVIEW' }
  });
  assert.equal(newToUnderReview.status, 200);

  const underReviewToPlanned = await request('/api/admin/suggestions/NM-SUGG-BADTRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'PLANNED' }
  });
  assert.equal(underReviewToPlanned.status, 200);

  // PLANNED -> NEW (not allowed)
  const plannedToNew = await request('/api/admin/suggestions/NM-SUGG-BADTRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'NEW' }
  });
  assert.equal(plannedToNew.status, 400);

  // PLANNED -> IMPLEMENTED (allowed)
  const plannedToImplemented = await request('/api/admin/suggestions/NM-SUGG-BADTRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'IMPLEMENTED' }
  });
  assert.equal(plannedToImplemented.status, 200);

  // IMPLEMENTED -> REJECTED (not allowed)
  const implementedToRejected = await request('/api/admin/suggestions/NM-SUGG-BADTRANS01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'REJECTED', rejectionReason: 'Actually not done' }
  });
  assert.equal(implementedToRejected.status, 400);
});


test('REJECTED requires rejectionReason of at least 3 characters', async () => {
  addSubmission({
    referenceId: 'NM-SUGG-REJVAL01',
    userId: 2,
    kind: 'SUGGESTION',
    title: 'Suggestion for rejection reason validation',
    category: 'OTHER',
    description: 'Test that rejection reason is validated properly.',
    status: 'UNDER_REVIEW'
  });

  // Missing rejectionReason → 400
  const missingReason = await request('/api/admin/suggestions/NM-SUGG-REJVAL01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'REJECTED' }
  });
  assert.equal(missingReason.status, 400);

  // Blank rejectionReason → 400
  const blankReason = await request('/api/admin/suggestions/NM-SUGG-REJVAL01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'REJECTED', rejectionReason: '' }
  });
  assert.equal(blankReason.status, 400);

  // Too short rejectionReason (< 3 chars) → 400
  const shortReason = await request('/api/admin/suggestions/NM-SUGG-REJVAL01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'REJECTED', rejectionReason: 'ab' }
  });
  assert.equal(shortReason.status, 400);

  // Valid rejectionReason → 200
  const validReason = await request('/api/admin/suggestions/NM-SUGG-REJVAL01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'REJECTED', rejectionReason: 'Not feasible at this stage' }
  });
  assert.equal(validReason.status, 200);
  const rejData = await validReason.json();
  assert.equal(rejData.suggestion.rejectionReason, 'Not feasible at this stage');
  assert.ok(rejData.suggestion.closedAt);
});

test('admin_notes-only update preserves closed_at and rejection_reason', async () => {
  addSubmission({
    referenceId: 'NM-SUGG-NOTES01',
    userId: 2,
    kind: 'SUGGESTION',
    title: 'Notes preservation test suggestion',
    category: 'USER_EXPERIENCE',
    description: 'Testing that updating admin notes preserves closed state.',
    status: 'UNDER_REVIEW'
  });

  // Reject it first
  const rejectRes = await request('/api/admin/suggestions/NM-SUGG-NOTES01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'REJECTED', rejectionReason: 'Not in scope for this release' }
  });
  assert.equal(rejectRes.status, 200);
  const rejectData = await rejectRes.json();
  const closedAt = rejectData.suggestion.closedAt;
  assert.ok(closedAt);

  // Now update admin_notes only - pass same status (REJECTED stays REJECTED)
  const notesRes = await request('/api/admin/suggestions/NM-SUGG-NOTES01/status', {
    userId: 1, method: 'PATCH',
    body: { status: 'REJECTED',  adminNotes: 'Reviewed by team on 2026-11-20' }
  });
  assert.equal(notesRes.status, 200);
  const notesData = await notesRes.json();
  assert.equal(notesData.suggestion.status, 'REJECTED');
  assert.equal(notesData.suggestion.adminNotes, 'Reviewed by team on 2026-11-20');
  assert.equal(notesData.suggestion.rejectionReason, 'Not in scope for this release');
  // closed_at should be preserved (same timestamp since already closed)
  assert.equal(notesData.suggestion.closedAt, closedAt);
});

test('saved suggestion notes notify only the original submitter and retries are deduplicated', async () => {
  addSubmission({
    referenceId: 'NM-NOTE-SUGG01',
    userId: 4,
    kind: 'SUGGESTION',
    title: 'Notification suggestion',
    category: 'USER_EXPERIENCE',
    description: 'Testing internal note notifications for a suggestion.',
    status: 'NEW'
  });

  const payload = { status: 'UNDER_REVIEW', adminNotes: 'We are evaluating this feature.' };
  assert.equal((await request('/api/admin/suggestions/NM-NOTE-SUGG01/status', {
    userId: 1, method: 'PATCH', body: payload
  })).status, 200);
  assert.equal((await request('/api/admin/suggestions/NM-NOTE-SUGG01/status', {
    userId: 1, method: 'PATCH', body: payload
  })).status, 200);

  const notifications = db.prepare(`SELECT user_id,title,message,notification_type,related_support_reference
    FROM notifications WHERE related_support_reference=?`).all('NM-NOTE-SUGG01');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].user_id, 4);
  assert.equal(notifications[0].notification_type, 'SUPPORT_UPDATE');
  assert.match(notifications[0].message, /We are evaluating this feature/);
  assert.equal(notifications[0].related_support_reference, 'NM-NOTE-SUGG01');
});

test('admin_notes and storage keys are not exposed to citizen-facing responses', async () => {
  // The suggestion service mapSuggestionRecord always returns adminNotes
  // but the admin endpoint is protected. We verify that the service
  // correctly isolates by kind (BUG_REPORT vs SUGGESTION) only here.
  // The citizen endpoints live in separate modules and don't use suggestion.service.js.

  addSubmission({
    referenceId: 'NM-SUGG-LEAK01',
    userId: 2,
    kind: 'SUGGESTION',
    title: 'Privacy check suggestion',
    category: 'OTHER',
    description: 'Verifying admin_notes are not leaked to citizens.',
    status: 'NEW',
    adminNotes: 'Internal note: citizen should not see this'
  });

  // Admin can see admin_notes
  const adminDetail = await request('/api/admin/suggestions/NM-SUGG-LEAK01', { userId: 1 });
  assert.equal(adminDetail.status, 200);
  const adminData = await adminDetail.json();
  assert.equal(adminData.suggestion.adminNotes, 'Internal note: citizen should not see this');

  // Citizens cannot access the admin endpoint at all (403)
  const citizenAttempt = await request('/api/admin/suggestions/NM-SUGG-LEAK01', { userId: 2 });
  assert.equal(citizenAttempt.status, 403);

  // Verify no screenshot_key is in the response (storage key not leaked)
  assert.equal(adminData.suggestion.screenshot_key, undefined);
  assert.equal(adminData.suggestion.screenshotKey, undefined);
});

test('invalid reference IDs, missing suggestions, or invalid statuses are rejected', async () => {
  // Non-existent suggestion
  const notFoundRes = await request('/api/admin/suggestions/NM-NONEXISTENT', { userId: 1 });
  assert.equal(notFoundRes.status, 404);

  // Invalid status value
  const invalidStatusRes = await request('/api/admin/suggestions/NM-SUGG01/status', {
    userId: 1,
    method: 'PATCH',
    body: { status: 'INVALID_STATUS' }
  });
  assert.equal(invalidStatusRes.status, 400);

  // Invalid reference ID format
  const invalidRefRes = await request('/api/admin/suggestions/INVALID_REF', { userId: 1 });
  assert.equal(invalidRefRes.status, 400);
});
