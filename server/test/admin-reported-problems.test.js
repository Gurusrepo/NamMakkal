import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-admin-reported-problems-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'problems.sqlite');
process.env.JWT_SECRET = 'admin-problems-test-secret-long-enough';
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
  kind = 'BUG_REPORT',
  title,
  category,
  description,
  screenshotKey = null,
  screenshotMimeType = null,
  status = 'NEW',
  adminNotes = null,
  closedAt = null
}) {
  db.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description,
     screenshot_key, screenshot_mime_type, status, admin_notes, closed_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
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
  assert.equal((await request('/api/admin/reported-problems')).status, 401);
  assert.equal((await request('/api/admin/reported-problems/NM-TEST01')).status, 401);
  assert.equal((await request('/api/admin/reported-problems/NM-TEST01/status', {
    method: 'PATCH',
    body: { status: 'IN_PROGRESS' }
  })).status, 401);

  for (const userId of [2, 3]) {
    assert.equal((await request('/api/admin/reported-problems', { userId })).status, 403);
    assert.equal((await request('/api/admin/reported-problems/NM-TEST01', { userId })).status, 403);
    assert.equal((await request('/api/admin/reported-problems/NM-TEST01/status', {
      userId,
      method: 'PATCH',
      body: { status: 'IN_PROGRESS' }
    })).status, 403);
  }
});

test('admin can list reported problems with pagination, category filter, status filter, and search', async () => {
  addSubmission({
    referenceId: 'NM-BUG01',
    userId: 2,
    kind: 'BUG_REPORT',
    title: 'Login OTP fails on mobile',
    category: 'LOGIN_ISSUE',
    description: 'When I request an OTP on Android, the SMS never arrives.',
    status: 'NEW'
  });
  addSubmission({
    referenceId: 'NM-BUG02',
    userId: 4,
    kind: 'BUG_REPORT',
    title: 'Profile avatar upload returns 500',
    category: 'PROFILE_ISSUE',
    description: 'Uploading a valid PNG fails with an internal server error.',
    status: 'IN_PROGRESS'
  });
  addSubmission({
    referenceId: 'NM-BUG03',
    userId: 2,
    kind: 'BUG_REPORT',
    title: 'Map pin drifts away from tap location',
    category: 'TECHNICAL_ERROR',
    description: 'Tapping on the map sets the marker 100 meters to the north.',
    status: 'RESOLVED',
    closedAt: new Date().toISOString()
  });

  const allResponse = await request('/api/admin/reported-problems?limit=10', { userId: 1 });
  assert.equal(allResponse.status, 200);
  const allResult = await allResponse.json();
  assert.equal(allResult.items.length, 3);
  assert.equal(allResult.pagination.total, 3);
  assert.equal(allResult.pagination.hasMore, false);

  const first = allResult.items.find((item) => item.referenceId === 'NM-BUG01');
  assert.ok(first);
  assert.equal(first.title, 'Login OTP fails on mobile');
  assert.equal(first.category, 'LOGIN_ISSUE');
  assert.equal(first.status, 'NEW');
  assert.equal(first.user.displayName, 'Citizen Jane');
  assert.equal(first.user.email, 'citizen.jane@example.test');
  assert.equal(first.user.phoneNumber, '+919876543210');
  assert.equal(first.hasScreenshot, false);
  assert.equal(first.screenshot_key, undefined);

  // Filter by category
  const catResponse = await request('/api/admin/reported-problems?category=LOGIN_ISSUE', { userId: 1 });
  assert.equal(catResponse.status, 200);
  const catResult = await catResponse.json();
  assert.equal(catResult.items.length, 1);
  assert.equal(catResult.items[0].referenceId, 'NM-BUG01');

  // Filter by status
  const statusResponse = await request('/api/admin/reported-problems?status=IN_PROGRESS', { userId: 1 });
  assert.equal(statusResponse.status, 200);
  const statusResult = await statusResponse.json();
  assert.equal(statusResult.items.length, 1);
  assert.equal(statusResult.items[0].referenceId, 'NM-BUG02');

  // Search by keyword
  const searchResponse = await request('/api/admin/reported-problems?search=pin%20drifts', { userId: 1 });
  assert.equal(searchResponse.status, 200);
  const searchResult = await searchResponse.json();
  assert.equal(searchResult.items.length, 1);
  assert.equal(searchResult.items[0].referenceId, 'NM-BUG03');

  // Search by reference ID
  const searchRef = await request('/api/admin/reported-problems?search=BUG02', { userId: 1 });
  assert.equal(searchRef.status, 200);
  const searchRefResult = await searchRef.json();
  assert.equal(searchRefResult.items.length, 1);
  assert.equal(searchRefResult.items[0].referenceId, 'NM-BUG02');

  // Pagination limit and offset
  const page1 = await request('/api/admin/reported-problems?limit=2&offset=0', { userId: 1 });
  const page1Result = await page1.json();
  assert.equal(page1Result.items.length, 2);
  assert.equal(page1Result.pagination.hasMore, true);
  assert.equal(page1Result.pagination.total, 3);
});

test('SUGGESTION records are strictly excluded from reported problems list and details', async () => {
  addSubmission({
    referenceId: 'NM-SUGG01',
    userId: 2,
    kind: 'SUGGESTION',
    title: 'Add dark mode to citizen app',
    category: 'USER_EXPERIENCE',
    description: 'It would be great to have dark mode when reporting issues at night.',
    status: 'NEW'
  });

  const listResponse = await request('/api/admin/reported-problems', { userId: 1 });
  const listResult = await listResponse.json();
  assert.ok(!listResult.items.some((item) => item.referenceId === 'NM-SUGG01'));

  const detailResponse = await request('/api/admin/reported-problems/NM-SUGG01', { userId: 1 });
  assert.equal(detailResponse.status, 404);

  const updateResponse = await request('/api/admin/reported-problems/NM-SUGG01/status', {
    userId: 1,
    method: 'PATCH',
    body: { status: 'IN_PROGRESS' }
  });
  assert.equal(updateResponse.status, 404);
});

test('admin can view problem details and access screenshot without exposing storage key', async () => {
  addSubmission({
    referenceId: 'NM-SCREEN01',
    userId: 2,
    kind: 'BUG_REPORT',
    title: 'Button overlapped on small screens',
    category: 'UI_DESIGN',
    description: 'The submit button is obscured by the footer nav bar.',
    screenshotKey: 'support-attachments/test-screenshot.jpg',
    screenshotMimeType: 'image/jpeg',
    status: 'NEW'
  });

  const response = await request('/api/admin/reported-problems/NM-SCREEN01', { userId: 1 });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.problem);
  assert.equal(result.problem.referenceId, 'NM-SCREEN01');
  assert.equal(result.problem.hasScreenshot, true);
  assert.equal(result.problem.screenshot_key, undefined);
  assert.equal(result.problem.screenshotKey, undefined);
  assert.ok(result.problem.screenshotUrl);
  assert.ok(result.problem.screenshotUrl.includes('test-screenshot.jpg'));
  assert.equal(result.problem.user.displayName, 'Citizen Jane');
});

test('admin can update status and closed_at is set for terminal statuses and cleared on reopen', async () => {
  addSubmission({
    referenceId: 'NM-LIFECYCLE01',
    userId: 4,
    kind: 'BUG_REPORT',
    title: 'White screen on complaint details',
    category: 'TECHNICAL_ERROR',
    description: 'Viewing complaint details without photos leads to a blank screen.',
    status: 'NEW'
  });

  // Step 1: Move from NEW to IN_PROGRESS
  const progressRes = await request('/api/admin/reported-problems/NM-LIFECYCLE01/status', {
    userId: 1,
    method: 'PATCH',
    body: { status: 'IN_PROGRESS', adminNotes: 'Investigating null checks in ComplaintCard' }
  });
  assert.equal(progressRes.status, 200);
  const progressData = await progressRes.json();
  assert.equal(progressData.problem.status, 'IN_PROGRESS');
  assert.equal(progressData.problem.closedAt, null);
  assert.equal(progressData.problem.adminNotes, 'Investigating null checks in ComplaintCard');
  assert.ok(progressData.problem.updatedAt);

  // Step 2: Resolve (terminal status) -> closedAt should be populated
  const resolvedRes = await request('/api/admin/reported-problems/NM-LIFECYCLE01/status', {
    userId: 1,
    method: 'PATCH',
    body: { status: 'RESOLVED', adminNotes: 'Patched optional chaining for photos array' }
  });
  assert.equal(resolvedRes.status, 200);
  const resolvedData = await resolvedRes.json();
  assert.equal(resolvedData.problem.status, 'RESOLVED');
  assert.ok(resolvedData.problem.closedAt);
  const closedTimestamp = resolvedData.problem.closedAt;

  // Step 3: Reopen back to IN_PROGRESS -> closedAt should be cleared to null
  const reopenRes = await request('/api/admin/reported-problems/NM-LIFECYCLE01/status', {
    userId: 1,
    method: 'PATCH',
    body: { status: 'IN_PROGRESS', adminNotes: 'Regression reported on iOS Safari' }
  });
  assert.equal(reopenRes.status, 200);
  const reopenData = await reopenRes.json();
  assert.equal(reopenData.problem.status, 'IN_PROGRESS');
  assert.equal(reopenData.problem.closedAt, null);
  assert.equal(reopenData.problem.adminNotes, 'Regression reported on iOS Safari');

  // Step 4: Reject (terminal status) -> closedAt should be set again
  const rejectRes = await request('/api/admin/reported-problems/NM-LIFECYCLE01/status', {
    userId: 1,
    method: 'PATCH',
    body: { status: 'REJECTED', adminNotes: 'Not reproducible on current version' }
  });
  assert.equal(rejectRes.status, 200);
  const rejectData = await rejectRes.json();
  assert.equal(rejectData.problem.status, 'REJECTED');
  assert.ok(rejectData.problem.closedAt);

  // Step 5: Verify in database directly
  const inDb = db.prepare('SELECT status, admin_notes, closed_at FROM citizen_support_submissions WHERE reference_id = ?')
    .get('NM-LIFECYCLE01');
  assert.equal(inDb.status, 'REJECTED');
  assert.equal(inDb.admin_notes, 'Not reproducible on current version');
  assert.ok(inDb.closed_at);
});

test('saved internal notes notify only the original submitter and retries are deduplicated', async () => {
  addSubmission({
    referenceId: 'NM-NOTE-BUG01',
    userId: 2,
    kind: 'BUG_REPORT',
    title: 'Notification bug report',
    category: 'TECHNICAL_ERROR',
    description: 'Testing internal note notifications for the original submitter.',
    status: 'NEW'
  });

  const payload = { status: 'IN_PROGRESS', adminNotes: 'The team reproduced this issue.' };
  assert.equal((await request('/api/admin/reported-problems/NM-NOTE-BUG01/status', {
    userId: 1, method: 'PATCH', body: payload
  })).status, 200);
  assert.equal((await request('/api/admin/reported-problems/NM-NOTE-BUG01/status', {
    userId: 1, method: 'PATCH', body: payload
  })).status, 200);

  const notifications = db.prepare(`SELECT user_id,title,message,notification_type,related_support_reference
    FROM notifications WHERE related_support_reference=?`).all('NM-NOTE-BUG01');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].user_id, 2);
  assert.equal(notifications[0].notification_type, 'SUPPORT_UPDATE');
  assert.match(notifications[0].message, /The team reproduced this issue/);
  assert.equal(notifications[0].related_support_reference, 'NM-NOTE-BUG01');

  const beforeStatusOnly = db.prepare(`SELECT COUNT(*) AS count FROM notifications
    WHERE related_support_reference='NM-NOTE-BUG01'`).get().count;
  assert.equal((await request('/api/admin/reported-problems/NM-NOTE-BUG01/status', {
    userId: 1, method: 'PATCH', body: { status: 'RESOLVED', adminNotes: null }
  })).status, 200);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM notifications
    WHERE related_support_reference='NM-NOTE-BUG01'`).get().count, beforeStatusOnly);
});

test('invalid reference IDs, missing problems, or invalid statuses are rejected', async () => {
  // Non-existent problem
  const notFoundRes = await request('/api/admin/reported-problems/NM-NONEXISTENT', { userId: 1 });
  assert.equal(notFoundRes.status, 404);

  // Invalid status value
  const invalidStatusRes = await request('/api/admin/reported-problems/NM-BUG01/status', {
    userId: 1,
    method: 'PATCH',
    body: { status: 'INVALID_STATUS' }
  });
  assert.equal(invalidStatusRes.status, 400);

  // Invalid reference ID format
  const invalidRefRes = await request('/api/admin/reported-problems/INVALID_REF', { userId: 1 });
  assert.equal(invalidRefRes.status, 400);
});
