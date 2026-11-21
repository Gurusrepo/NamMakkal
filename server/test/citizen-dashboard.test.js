import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-citizen-dashboard-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'dashboard.sqlite');
process.env.JWT_SECRET = 'citizen-dashboard-test-secret-long-enough';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';

const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');
migrateDatabase(db);
const { default: app } = await import('../src/app.js');

let server;
let baseUrl;
const complaintIds = [];

function addUser(id, role, name) {
  db.prepare(`INSERT INTO users (id,display_name,email,password_hash,role,email_verified,phone_number)
    VALUES (?,?,?,'test-hash',?,?,?)`).run(id, name, `${name.toLowerCase()}@example.test`, role,
    role === 'CITIZEN' ? 1 : 0,
    role === 'CITIZEN' ? `+9198765432${String(id).padStart(2, '0')}` : null);
}

function addIssue(status, mergedIntoIssueId = null) {
  return Number(db.prepare('INSERT INTO civic_issues (status,merged_into_issue_id) VALUES (?,?)')
    .run(status, mergedIntoIssueId).lastInsertRowid);
}

function addComplaint(userId, issueId, title) {
  const result = db.prepare(`INSERT INTO complaints
    (user_id,civic_issue_id,title,description,latitude,longitude)
    VALUES (?,?,?,'A sufficiently detailed complaint description.',1,2)`).run(userId, issueId, title);
  return Number(result.lastInsertRowid);
}

function tokenFor(userId) {
  const { session_version: version } = db.prepare('SELECT session_version FROM users WHERE id=?').get(userId);
  return jwt.sign({ ver: version }, process.env.JWT_SECRET, {
    algorithm: 'HS256', subject: String(userId), issuer: 'civicpulse-api', audience: 'civicpulse-client'
  });
}

async function request(pathname, { userId, method = 'GET', body } = {}) {
  const headers = {};
  if (userId !== undefined) headers.cookie = `civicpulse_token=${tokenFor(userId)}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

before(async () => {
  addUser(1, 'ADMIN', 'Dashboard Admin');
  addUser(2, 'CITIZEN', 'Dashboard Citizen');
  addUser(3, 'CITIZEN', 'Other Citizen');
  addUser(4, 'OFFICER', 'Dashboard Officer');

  const openIssue = addIssue('OPEN');
  const inProgressIssue = addIssue('IN_PROGRESS');
  const resolvedIssue = addIssue('RESOLVED');
  const mergedIntoIssue = addIssue('OPEN');
  const mergedIssue = addIssue('MERGED', mergedIntoIssue);
  complaintIds.push(
    addComplaint(2, openIssue, 'Open complaint one'),
    addComplaint(2, openIssue, 'Open complaint two'),
    addComplaint(2, inProgressIssue, 'In-progress complaint'),
    addComplaint(2, resolvedIssue, 'Resolved complaint'),
    addComplaint(2, mergedIssue, 'Merged complaint'),
    addComplaint(3, openIssue, 'Another citizen complaint')
  );

  for (let index = 0; index < 4; index += 1) {
    db.prepare(`INSERT INTO civic_announcements (title,description,published_by_admin_id,published_at)
      VALUES (?,?,1,?)`).run(`Announcement ${index + 1}`, `Description ${index + 1}`,
      `2026-11-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`);
  }

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('complaint summary counts owned complaint rows by linked civic issue status', async () => {
  const response = await request('/api/complaints/summary', { userId: 2 });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).summary, {
    total: 5,
    open: 2,
    inProgress: 1,
    resolved: 1
  });

  const otherCitizen = await request('/api/complaints/summary', { userId: 3 });
  assert.deepEqual((await otherCitizen.json()).summary, {
    total: 1,
    open: 1,
    inProgress: 0,
    resolved: 0
  });

  const latest = await request('/api/complaints?limit=4&offset=0', { userId: 2 });
  const { items } = await latest.json();
  assert.deepEqual(items.map((item) => item.id), complaintIds.slice(0, 5).reverse().slice(0, 4));
});

test('announcement creation is admin-only and published announcements are citizen-readable', async () => {
  const denied = await request('/api/admin/announcements', {
    userId: 2, method: 'POST', body: { title: 'Town notice', description: 'A public notice.' }
  });
  assert.equal(denied.status, 403);

  const created = await request('/api/admin/announcements', {
    userId: 1, method: 'POST', body: { title: 'Town notice', description: 'A public notice.' }
  });
  assert.equal(created.status, 201);
  const { announcement } = await created.json();
  assert.equal(announcement.title, 'Town notice');
  assert.equal(announcement.isPublished, false);

  const publishResponse = await request(`/api/admin/announcements/${announcement.id}/publication`, {
    userId: 1,
    method: 'PATCH',
    body: { isPublished: true }
  });
  assert.equal(publishResponse.status, 200);
  const { announcement: published } = await publishResponse.json();
  assert.equal(published.isPublished, true);
  assert.ok(published.publishedAt);

  const list = await request('/api/announcements?limit=3&offset=0', { userId: 2 });
  assert.equal(list.status, 200);
  const result = await list.json();
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].id, announcement.id);
  assert.equal(result.pagination.hasMore, true);

  const detail = await request(`/api/announcements/${announcement.id}`, { userId: 2 });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).announcement.description, 'A public notice.');
});

test('announcement endpoints require authentication and reject invalid publication fields', async () => {
  assert.equal((await request('/api/announcements')).status, 401);
  assert.equal((await request('/api/admin/announcements')).status, 401);
  const invalid = await request('/api/admin/announcements', {
    userId: 1, method: 'POST', body: { title: 'No', description: '' }
  });
  assert.equal(invalid.status, 400);
  assert.equal((await request('/api/announcements?limit=0', { userId: 2 })).status, 400);
  assert.equal((await request('/api/announcements?offset=1000001', { userId: 2 })).status, 400);
});

test('citizens cannot list or fetch unpublished or non-public announcements', async () => {
  const draftId = Number(db.prepare(`INSERT INTO civic_announcements
    (title,description,published_by_admin_id,is_published,is_public)
    VALUES ('Draft announcement','Draft text',1,0,1)`).run().lastInsertRowid);
  const privateId = Number(db.prepare(`INSERT INTO civic_announcements
    (title,description,published_by_admin_id,is_published,is_public)
    VALUES ('Private announcement','Private text',1,1,0)`).run().lastInsertRowid);

  const list = await request('/api/announcements?limit=50&offset=0', { userId: 2 });
  assert.equal(list.status, 200);
  const { items } = await list.json();
  assert.equal(items.some((item) => item.id === draftId || item.id === privateId), false);
  assert.equal((await request(`/api/announcements/${draftId}`, { userId: 2 })).status, 404);
  assert.equal((await request(`/api/announcements/${privateId}`, { userId: 2 })).status, 404);
});

test('profile updates are self-only, validated, role-safe and keep email read-only', async () => {
  const updated = await request('/api/auth/profile', {
    userId: 2,
    method: 'PATCH',
    body: { name: 'Updated Citizen', phoneNumber: '+91 98765 43210', dateOfBirth: '1980-01-02', address: '12 Main Road' }
  });
  assert.equal(updated.status, 200);
  const { user } = await updated.json();
  assert.deepEqual(Object.keys(user).sort(), ['address', 'age', 'ageBasedCitizenCategory', 'ageBasedCitizenEligible', 'citizenIdentityVerificationStatus', 'createdAt', 'dateOfBirth', 'dateOfBirthVerificationStatus', 'email', 'emailVerified', 'id', 'name', 'phoneNumber', 'profileImage', 'role', 'verificationAvailability']);
  assert.deepEqual(user.profileImage, { available: false });
  assert.equal(user.name, 'Updated Citizen');
  assert.equal(user.email, 'dashboard citizen@example.test');
  assert.equal(user.phoneNumber, '+919876543210');
  assert.equal(user.dateOfBirth, '1980-01-02');
  assert.equal(user.dateOfBirthVerificationStatus, 'NOT_VERIFIED');
  assert.equal(user.emailVerified, true);
  assert.equal(user.citizenIdentityVerificationStatus, 'NOT_CONFIGURED');
  assert.equal(user.ageBasedCitizenCategory, 'CITIZEN');
  assert.equal(user.address, '12 Main Road');
  assert.equal(user.role, 'CITIZEN');
  assert.ok(user.createdAt);

  const me = await request('/api/auth/me', { userId: 2 });
  assert.equal(me.status, 200);
  assert.deepEqual((await me.json()).user, user);

  const attemptedEmailChange = await request('/api/auth/profile', {
    userId: 2,
    method: 'PATCH',
    body: { name: 'Should Not Persist', phoneNumber: '', dateOfBirth: null, address: '', email: 'other.citizen@example.test' }
  });

  assert.equal(attemptedEmailChange.status, 400);

  const roleChange = await request('/api/auth/profile', {
    userId: 2,
    method: 'PATCH',
    body: { name: 'Updated Citizen', phoneNumber: '', dateOfBirth: null, address: '', role: 'ADMIN' }
  });
  assert.equal(roleChange.status, 400);
  assert.equal(db.prepare('SELECT role FROM users WHERE id=2').get().role, 'CITIZEN');

  const targetingOtherUser = await request('/api/auth/profile', {
    userId: 2,
    method: 'PATCH',
    body: { name: 'Updated Citizen', phoneNumber: '', dateOfBirth: null, address: '', userId: 3 }
  });
  assert.equal(targetingOtherUser.status, 400);
  assert.equal(db.prepare('SELECT display_name FROM users WHERE id=3').get().display_name, 'Other Citizen');

  const invalid = await request('/api/auth/profile', {
    userId: 2,
    method: 'PATCH',
    body: { name: ' ', phoneNumber: '', dateOfBirth: null, address: '' }
  });
  assert.equal(invalid.status, 400);
  const futureDob = await request('/api/auth/profile', { userId: 2, method: 'PATCH', body: { name: 'Updated Citizen', phoneNumber: '', dateOfBirth: '2099-01-01', address: '' } });
  assert.equal(futureDob.status, 400);
  db.prepare("UPDATE users SET date_of_birth_verification_status='VERIFIED' WHERE id=2").run();
  const changedDob = await request('/api/auth/profile', { userId: 2, method: 'PATCH', body: { name: 'Updated Citizen', phoneNumber: '+919876543210', dateOfBirth: '1981-01-02', address: '' } });
  assert.equal(changedDob.status, 200);
  assert.equal((await changedDob.json()).user.dateOfBirthVerificationStatus, 'NOT_VERIFIED');
});

test('profile avatar routes require authentication and cannot target another user', async () => {
  assert.equal((await request('/api/auth/profile/avatar')).status, 401);
  assert.equal((await request('/api/auth/profile/avatar', { method: 'POST' })).status, 401);
  assert.equal((await request('/api/auth/profile/avatar', { method: 'DELETE' })).status, 401);

  const removed = await request('/api/auth/profile/avatar', {
    userId: 2, method: 'DELETE', body: { userId: 3 }
  });
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).user.profileImage, { available: false });
  assert.equal(db.prepare('SELECT profile_image_key FROM users WHERE id=3').get().profile_image_key, null);
});

test('profile image replacement persists before deleting the old object and preserves it on database failure', async () => {
  const authService = await import('../src/modules/auth/auth.service.js');
  db.prepare("UPDATE users SET profile_image_key='profile-images/old.jpg',profile_image_mime_type='image/jpeg' WHERE id=2").run();
  const events = [];
  const storage = {
    async uploadProfileImage() { events.push('upload'); return 'profile-images/new.png'; },
    async createProfileImageReadUrl() { events.push('signed-url'); return 'https://signed.example/image'; },
    async deleteProfileImageObject(key) {
      events.push(`delete:${key}`);
      if (key === 'profile-images/old.jpg') {
        assert.equal(db.prepare('SELECT profile_image_key FROM users WHERE id=2').get().profile_image_key, 'profile-images/new.png');
      }
    }
  };
  const result = await authService.replaceProfileImage(2, { buffer: Buffer.from('image'), verifiedMimeType: 'image/png' }, storage);
  assert.deepEqual(events, ['upload', 'signed-url', 'delete:profile-images/old.jpg']);
  assert.equal(result.profileImageUrl, 'https://signed.example/image');
  assert.deepEqual(result.user.profileImage, { available: true });

  db.exec(`CREATE TRIGGER fail_profile_image_update BEFORE UPDATE OF profile_image_key ON users
    WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT, 'simulated persistence failure'); END`);
  const failureEvents = [];
  await assert.rejects(authService.replaceProfileImage(2, { buffer: Buffer.from('image'), verifiedMimeType: 'image/jpeg' }, {
    async uploadProfileImage() { failureEvents.push('upload'); return 'profile-images/failed.jpg'; },
    async createProfileImageReadUrl() { return 'https://signed.example/failed'; },
    async deleteProfileImageObject(key) { failureEvents.push(`delete:${key}`); }
  }));
  db.exec('DROP TRIGGER fail_profile_image_update');
  assert.deepEqual(failureEvents, ['upload', 'delete:profile-images/failed.jpg']);
  assert.equal(db.prepare('SELECT profile_image_key FROM users WHERE id=2').get().profile_image_key, 'profile-images/new.png');
});

test('notification endpoints paginate and keep read operations user-scoped for citizens and officers', async () => {
  const insert = db.prepare(`INSERT INTO notifications
    (user_id,title,message,notification_type,related_complaint_id,event_key)
    VALUES(?,?,'A civic issue has changed.','ISSUE_RESOLVED',?,?)`);
  const firstId = Number(insert.run(2, 'First update', complaintIds[0], 'test:event:first').lastInsertRowid);
  insert.run(2, 'Second update', complaintIds[1], 'test:event:second');
  const otherId = Number(insert.run(3, 'Other citizen update', complaintIds[5], 'test:event:other').lastInsertRowid);

  const officerNotifications = await request('/api/notifications', { userId: 4 });
  assert.equal(officerNotifications.status, 200);
  assert.deepEqual((await officerNotifications.json()).items, []);
  assert.equal((await request('/api/notifications')).status, 401);
  const unread = await request('/api/notifications/unread-count', { userId: 2 });
  assert.deepEqual(await unread.json(), { unreadCount: 2 });

  const page = await request('/api/notifications?limit=1&offset=0&unreadOnly=true', { userId: 2 });
  assert.equal(page.status, 200);
  const pageResult = await page.json();
  assert.equal(pageResult.items.length, 1);
  assert.equal(pageResult.pagination.hasMore, true);
  assert.equal(pageResult.items[0].isRead, false);

  assert.equal((await request(`/api/notifications/${otherId}/read`, { userId: 2, method: 'PATCH' })).status, 404);
  assert.equal((await request(`/api/notifications/${firstId}/read`, { userId: 4, method: 'PATCH' })).status, 404);
  const marked = await request(`/api/notifications/${firstId}/read`, { userId: 2, method: 'PATCH' });
  assert.equal(marked.status, 200);
  assert.equal((await marked.json()).notification.isRead, true);
  assert.deepEqual(await (await request('/api/notifications/unread-count', { userId: 2 })).json(), { unreadCount: 1 });

  const markAll = await request('/api/notifications/read-all', { userId: 2, method: 'PATCH' });
  assert.deepEqual(await markAll.json(), { updatedCount: 1 });
  assert.deepEqual(await (await request('/api/notifications/unread-count', { userId: 2 })).json(), { unreadCount: 0 });
  assert.deepEqual(await (await request('/api/notifications/unread-count', { userId: 3 })).json(), { unreadCount: 1 });
  assert.equal((await request('/api/notifications?limit=0', { userId: 2 })).status, 400);
  assert.equal((await request('/api/notifications?unreadOnly=maybe', { userId: 2 })).status, 400);
});

test('workflow notification delivery is idempotent for each user and event', async () => {
  const { notifyIssueReporters } = await import('../src/modules/notifications/notification.service.js');
  const issueId = db.prepare('SELECT civic_issue_id FROM complaints WHERE id=?').get(complaintIds[0]).civic_issue_id;
  const notification = {
    eventKey: `test:issue:${issueId}:resolution`,
    notificationType: 'ISSUE_RESOLVED',
    title: 'Your complaint has been resolved',
    message: 'A civic issue you reported has been marked resolved.'
  };

  assert.equal(notifyIssueReporters(issueId, notification), 2);
  assert.equal(notifyIssueReporters(issueId, notification), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE event_key=?')
    .get(notification.eventKey).count, 2);
});

test('support report and suggestion submissions are authenticated and return references', async () => {
  assert.equal((await request('/api/support/reports', { method: 'POST', body: {} })).status, 401);
  assert.equal((await request('/api/support/suggestions', { userId: 4, method: 'POST', body: {} })).status, 403);
  const bad = await request('/api/support/suggestions', { userId: 2, method: 'POST', body: { title: 'x', category: 'OTHER', description: 'short' } });
  assert.equal(bad.status, 400);

  const report = await request('/api/support/reports', { userId: 2, method: 'POST', body: {
    title: 'Profile page does not save', category: 'PROFILE_ISSUE', description: 'The new phone number is not saved after I submit the profile form.'
  } });
  assert.equal(report.status, 201);
  const { submission: bug } = await report.json();
  assert.match(bug.referenceId, /^NM-[A-F0-9]{16}$/);
  assert.ok(bug.submittedAt);

  const idea = await request('/api/support/suggestions', { userId: 2, method: 'POST', body: {
    title: 'Add accessible text sizing', category: 'ACCESSIBILITY', description: 'Please provide a larger text option for citizens who need it.'
  } });
  assert.equal(idea.status, 201);
  const { submission: suggestion } = await idea.json();
  assert.match(suggestion.referenceId, /^NM-[A-F0-9]{16}$/);
  const saved = db.prepare('SELECT user_id,kind FROM citizen_support_submissions WHERE reference_id=?').get(bug.referenceId);
  assert.deepEqual(saved, { user_id: 2, kind: 'BUG_REPORT' });
});

test('changing a citizen phone number preserves email verification and invalidates the existing session', async () => {
  const staleToken = tokenFor(3);
  const updated = await request('/api/auth/profile', {
    userId: 3,
    method: 'PATCH',
    body: { name: 'Other Citizen', phoneNumber: '+919876543212', dateOfBirth: null, address: '' }
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).user.emailVerified, true);

  const staleSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: `civicpulse_token=${staleToken}` }
  });
  assert.equal(staleSession.status, 401);
  assert.equal((await request('/api/auth/me', { userId: 3 })).status, 200);
});
