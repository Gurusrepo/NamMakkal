import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

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
    password: 'StrongOfficerPassword123',
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

test('Admin creates an active OFFICER with a unique employee ID, team memberships, and no OTP invitation', async () => {
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
  assert.equal(result.officer.status, 'ACTIVE');
  assert.equal(result.officer.emailVerified, true);
  assert.equal(result.invitation, undefined);
  assert.equal(result.officer.teams.length, 2);
  assert.equal(JSON.stringify(result).includes('password'), false);
  assert.deepEqual(db.prepare('SELECT role,employee_id,account_status,email_verified FROM users WHERE id=?').get(officerId), {
    role: 'OFFICER',
    employee_id: result.officer.employeeId,
    account_status: 'ACTIVE',
    email_verified: 1
  });
  assert.equal(invitationCalls.length, 0);
  assert.equal(await bcrypt.compare(createOfficerBody().password, db.prepare('SELECT password_hash FROM users WHERE id=?').get(officerId).password_hash), true);
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
  const search = await request(`/api/admin/officers?search=${encodeURIComponent(employeeId.toLowerCase())}&status=ACTIVE`);
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
  const activeCountBefore = (await (await request(`/api/admin/ward-teams/${teamA}`)).json()).team.activeMemberCount;
  const deactivated = await request(`/api/admin/officers/${officerId}/status`, {
    method: 'PATCH',
    body: { status: 'DEACTIVATED' }
  });
  assert.equal(deactivated.status, 200);
  assert.equal((await deactivated.json()).officer.status, 'DEACTIVATED');
  assert.equal(db.prepare('SELECT session_version FROM users WHERE id=?').get(officerId).session_version, previousVersion + 1);
  assert.equal((await (await request(`/api/admin/ward-teams/${teamA}`)).json()).team.activeMemberCount,
    activeCountBefore - 1);

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

test('soft delete archives an officer, revokes sessions, removes team membership and excludes the account', async () => {
  const deleteResponse = await request(`/api/admin/officers/${officerId}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await deleteResponse.json()).deleted, true);
  const archived = db.prepare(`SELECT account_status,deleted_at,session_version FROM users WHERE id=?`).get(officerId);
  assert.equal(archived.account_status, 'DEACTIVATED');
  assert.ok(archived.deleted_at);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ward_team_memberships
    WHERE officer_user_id=? AND removed_at IS NULL`).get(officerId).count, 0);
  const list = await request('/api/admin/officers');
  assert.equal((await list.json()).items.some((officer) => officer.id === officerId), false);
  const detail = await request(`/api/admin/officers/${officerId}`);
  assert.equal(detail.status, 404);
  assert.equal((await request(`/api/admin/officers/${officerId}/status`, {
    method: 'PATCH', body: { status: 'ACTIVE' }
  })).status, 409);
});

test('admin citizen management lists real complaints, deactivates, soft deletes and excludes deleted citizens', async () => {
  const citizenId = 2;
  const complaintId = Number(db.prepare(`INSERT INTO complaints
    (user_id,civic_issue_id,title,description,latitude,longitude)
    VALUES(?,?, 'Citizen complaint', 'Citizen complaint description',12.3,45.6)`)
    .run(citizenId, issueId).lastInsertRowid);

  const listResponse = await request('/api/admin/citizens?search=citizen');
  assert.equal(listResponse.status, 200);
  const listed = (await listResponse.json()).items.find((citizen) => citizen.id === citizenId);
  assert.ok(listed);
  assert.equal(listed.complaintCount, 1);

  const detailResponse = await request(`/api/admin/citizens/${citizenId}`);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.complaintCount, 1);
  assert.equal(detail.complaints[0].id, complaintId);

  const deactivate = await request(`/api/admin/citizens/${citizenId}/status`, {
    method: 'PATCH', body: { status: 'DEACTIVATED' }
  });
  assert.equal(deactivate.status, 200);
  const sessionBefore = db.prepare('SELECT session_version FROM users WHERE id=?').get(citizenId).session_version;
  assert.equal(sessionBefore, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM complaints WHERE user_id=?').get(citizenId).count, 1);

  const reactivate = await request(`/api/admin/citizens/${citizenId}/status`, {
    method: 'PATCH', body: { status: 'ACTIVE' }
  });
  assert.equal(reactivate.status, 200);

  const deleteResponse = await request(`/api/admin/citizens/${citizenId}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  assert.equal(db.prepare(`SELECT deleted_at,account_status FROM users WHERE id=?`).get(citizenId).deleted_at !== null, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM complaints WHERE user_id=?').get(citizenId).count, 1);
  const deletedList = await request('/api/admin/citizens');
  assert.equal((await deletedList.json()).items.some((citizen) => citizen.id === citizenId), false);
});

test('citizens and officers cannot use Admin officer management endpoints', async () => {
  db.prepare(`UPDATE users SET account_status='ACTIVE',deleted_at=NULL,
    deactivated_at=NULL,session_version=0 WHERE id=2 AND role='CITIZEN'`).run();
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
