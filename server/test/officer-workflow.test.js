import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-officer-workflow-'));
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_PATH: path.join(tempDirectory, 'officer-workflow.sqlite'),
  JWT_SECRET: 'officer-workflow-test-secret-long-enough', CORS_ORIGINS: 'http://localhost:3000',
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'test-key',
  GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3.5-flash-lite'
});

const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');
migrateDatabase(db);
const { createOfficerRouter } = await import('../src/modules/officer/officer.routes.js');
const notificationRouter = (await import('../src/modules/notifications/notification.routes.js')).default;
const { assignIssueToTeam, reassignIssueTeam, unassignIssueTeam } = await import('../src/modules/admin/team-assignment.service.js');

const uploaded = new Map();
let uploadNumber = 0;
const fakeStorage = {
  async uploadRepairEvidenceImage(file) {
    const key = `repair-evidence/test-${++uploadNumber}.png`;
    uploaded.set(key, Buffer.from(file.buffer));
    return key;
  },
  async deleteRepairEvidenceObject(key) { uploaded.delete(key); },
  async createRepairEvidenceReadUrl(key) { return `https://private.test/${encodeURIComponent(key)}`; },
  async createComplaintReadUrl(key) { return `https://private.test/${encodeURIComponent(key)}`; }
};
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/officer', createOfficerRouter(fakeStorage));
app.use('/api/notifications', notificationRouter);

let server;
let baseUrl;
let ids;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');

function addUser(id, role) {
  db.prepare(`INSERT INTO users(id,display_name,email,password_hash,role,email_verified) VALUES(?,?,?,'hash',?,?)`)
    .run(id, `Workflow User ${id}`, `workflow-${id}@example.test`, role,
      role === 'CITIZEN' ? 1 : 0);
}
function token(userId) {
  return jwt.sign({}, process.env.JWT_SECRET, { algorithm: 'HS256', subject: String(userId),
    issuer: 'civicpulse-api', audience: 'civicpulse-client' });
}
async function request(pathname, { userId = 3, method = 'GET', body, multipart = false } = {}) {
  const headers = { cookie: `civicpulse_token=${token(userId)}` };
  if (body !== undefined && !multipart) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${pathname}`, { method, headers,
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
}
function createIssue(teamId = ids.team) {
  const issueId = Number(db.prepare('INSERT INTO civic_issues DEFAULT VALUES').run().lastInsertRowid);
  db.prepare(`UPDATE civic_issues SET assigned_team_id=?,routing_department='Roads & Infrastructure' WHERE id=?`).run(teamId, issueId);
  const event = db.prepare(`INSERT INTO civic_issue_team_assignment_events
    (civic_issue_id,event_type,team_id,approved_department,admin_user_id)
    VALUES(?,'ASSIGNED',?,'Roads & Infrastructure',1)`).run(issueId, teamId);
  return { issueId, assignmentEventId: Number(event.lastInsertRowid) };
}
async function upload(issueId, stage, userId = 3) {
  const form = new FormData();
  form.set('stage', stage);
  form.set('photo', new Blob([png], { type: 'image/png' }), 'repair.png');
  return request(`/api/officer/civic-issues/${issueId}/repair-evidence`, { userId, method: 'POST', body: form, multipart: true });
}

before(async () => {
  addUser(1, 'ADMIN'); addUser(2, 'CITIZEN'); addUser(3, 'OFFICER'); addUser(4, 'OFFICER'); addUser(5, 'OFFICER');
  ids = {};
  ids.ward = Number(db.prepare("INSERT INTO wards(code,name) VALUES('TEST','Test Ward')").run().lastInsertRowid);
  ids.team = Number(db.prepare("INSERT INTO ward_teams(ward_id,name,department) VALUES(?,'Road Team','Roads & Infrastructure')").run(ids.ward).lastInsertRowid);
  ids.otherTeam = Number(db.prepare("INSERT INTO ward_teams(ward_id,name,department) VALUES(?,'Other Road Team','Roads & Infrastructure')").run(ids.ward).lastInsertRowid);
  db.prepare('INSERT INTO ward_team_memberships(team_id,officer_user_id,added_by_admin_id) VALUES(?,3,1)').run(ids.team);
  db.prepare('INSERT INTO ward_team_memberships(team_id,officer_user_id,added_by_admin_id) VALUES(?,5,1)').run(ids.team);
  db.prepare('INSERT INTO ward_team_memberships(team_id,officer_user_id,added_by_admin_id) VALUES(?,4,1)').run(ids.otherTeam);
  ids.issue = createIssue();
  ids.unassignedIssue = Number(db.prepare('INSERT INTO civic_issues DEFAULT VALUES').run().lastInsertRowid);
  ids.secondIssue = createIssue();
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('officer APIs enforce role and membership while listing only authorized reports without reporter coordinates', async () => {
  db.prepare(`INSERT INTO complaints(user_id,civic_issue_id,title,description,latitude,longitude)
    VALUES(2,?,'Citizen secret title','Private complaint description sentinel',23.123456,72.654321)`).run(ids.issue.issueId);
  assert.equal((await request('/api/officer/civic-issues', { userId: 2 })).status, 403);
  assert.equal((await request('/api/officer/civic-issues', { userId: 1 })).status, 403);
  assert.equal((await request(`/api/officer/civic-issues/${ids.issue.issueId}`, { userId: 4 })).status, 404);
  const response = await request('/api/officer/civic-issues');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.items.length, 2);
  const serialized = JSON.stringify(result);
  assert.ok(result.items.some(item => item.title === 'Citizen secret title'));
  assert.ok(result.items.some(item => item.descriptionPreview?.includes('Private complaint description sentinel')));
  for (const field of ['latitude', 'longitude', 'userId', 'citizenUserId']) assert.equal(serialized.includes(field), false);
  for (const privateValue of ['23.123456', '72.654321']) {
    assert.equal(serialized.includes(privateValue), false);
  }
  const storedBefore = uploaded.size;
  assert.equal((await upload(ids.issue.issueId, 'BEFORE', 2)).status, 403);
  assert.equal(uploaded.size, storedBefore);
  assert.equal((await upload(ids.issue.issueId, 'NOPE')).status, 400);
  assert.equal(uploaded.size, storedBefore);
});

test('officer dashboard reports only the authorized teams and their current workload', async () => {
  const response = await request('/api/officer/dashboard');
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.deepEqual(dashboard.summary, { totalAssigned: 2, open: 2, inProgress: 0, resolved: 0 });
  assert.equal(dashboard.teams.length, 1);
  assert.equal(dashboard.teams[0].id, ids.team);
  assert.deepEqual(dashboard.teams[0].workload, { open: 2, inProgress: 0, resolved: 0 });
  assert.equal(dashboard.recentAssignments.length, 2);
  assert.deepEqual(dashboard.activeIssues.map(issue => issue.status), ['OPEN', 'OPEN']);
  assert.equal((await request('/api/officer/dashboard', { userId: 2 })).status, 403);
  assert.equal((await request('/api/officer/dashboard', { userId: 1 })).status, 403);
});

test('deactivated officers cannot use Officer APIs even while a membership record remains', async () => {
  db.prepare("UPDATE users SET account_status='DEACTIVATED' WHERE id=5").run();
  assert.equal((await request('/api/officer/dashboard', { userId: 5 })).status, 401);
  assert.equal((await request('/api/officer/civic-issues', { userId: 5 })).status, 401);
});

test('officer complaint filters paginate safely and details expose only authorized report data', async () => {
  const first = createIssue();
  const second = createIssue();
  const insertReport = db.prepare(`INSERT INTO complaints
    (user_id,civic_issue_id,title,description,address,latitude,longitude)
    VALUES(2,?,?,?,'Relevant location',12.34,56.78)`);
  const firstReportId = Number(insertReport.run(first.issueId, 'Searchable road report one',
    'A sufficiently detailed searchable road complaint.').lastInsertRowid);
  const secondReportId = Number(insertReport.run(second.issueId, 'Searchable road report two',
    'Another sufficiently detailed searchable road complaint.').lastInsertRowid);
  const insertAssessment = db.prepare(`INSERT INTO complaint_ai_assessments
    (complaint_id,status,category,department,severity,confidence,human_review_required)
    VALUES(?,'SUCCEEDED','ROAD_DAMAGE','Roads & Infrastructure','HIGH',0.9,0)`);
  insertAssessment.run(firstReportId);
  insertAssessment.run(secondReportId);
  db.prepare(`INSERT INTO complaint_media
    (complaint_id,uploader_id,object_key,media_type,mime_type,byte_size)
    VALUES(?,2,'complaints/officer-detail.jpg','IMAGE','image/jpeg',128)`).run(firstReportId);

  const query = new URLSearchParams({
    search: 'Searchable road',
    department: 'Roads & Infrastructure',
    category: 'ROAD_DAMAGE',
    severity: 'HIGH',
    teamId: String(ids.team),
    wardId: String(ids.ward),
    assignedFrom: '2000-01-01',
    assignedTo: '2099-12-31',
    limit: '1',
    sort: 'OLDEST'
  });
  const firstPageResponse = await request(`/api/officer/civic-issues?${query}`);
  assert.equal(firstPageResponse.status, 200);
  const firstPage = await firstPageResponse.json();
  assert.deepEqual(firstPage.items.map(issue => issue.id), [first.issueId]);
  assert.equal(firstPage.items[0].category, 'ROAD_DAMAGE');
  assert.equal(firstPage.items[0].severity, 'HIGH');
  assert.equal(firstPage.pagination.hasMore, true);

  query.set('offset', '1');
  const secondPage = await (await request(`/api/officer/civic-issues?${query}`)).json();
  assert.deepEqual(secondPage.items.map(issue => issue.id), [second.issueId]);
  assert.equal(secondPage.pagination.hasMore, false);

  query.set('offset', '0');
  query.set('search', `#${first.issueId}`);
  const idSearch = await (await request(`/api/officer/civic-issues?${query}`)).json();
  assert.deepEqual(idSearch.items.map(issue => issue.id), [first.issueId]);

  const detailResponse = await request(`/api/officer/civic-issues/${first.issueId}`);
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()).issue;
  assert.equal(detail.reports[0].title, 'Searchable road report one');
  assert.equal(detail.reports[0].location.latitude, 12.34);
  assert.equal(detail.reports[0].aiAssessment.severity, 'HIGH');
  assert.match(detail.reports[0].media[0].url, /^https:\/\/private\.test\//);
  assert.equal(detail.assignmentHistory[0].eventType, 'ASSIGNED');
  assert.equal(JSON.stringify(detail).includes('userId'), false);
  assert.equal(JSON.stringify(detail).includes('email'), false);
  assert.equal((await request(`/api/officer/civic-issues/${first.issueId}`, { userId: 4 })).status, 404);

  const timeline = await (await request(`/api/officer/civic-issues/${first.issueId}/timeline`)).json();
  assert.equal(timeline.items.find(event => event.eventType === 'REPORT_SUBMITTED').actorType, 'CITIZEN');
  assert.equal(timeline.items.find(event => event.eventType === 'TEAM_ASSIGNED').actorType, 'ADMIN');
  assert.equal((await request(`/api/officer/civic-issues/${first.issueId}/timeline`, { userId: 4 })).status, 404);
  assert.equal((await request('/api/officer/civic-issues/999999')).status, 404);
  assert.equal((await request('/api/officer/civic-issues?status=UNKNOWN')).status, 400);
  assert.equal((await request('/api/officer/civic-issues?department=Unknown')).status, 400);
  assert.equal((await request('/api/officer/civic-issues?sort=PRIORITY')).status, 400);
  assert.equal((await request('/api/officer/civic-issues?limit=100')).status, 400);
  assert.equal((await request('/api/officer/civic-issues?assignedFrom=2026-02-01&assignedTo=2026-01-01')).status, 400);

  const otherTeam = await (await request(`/api/officer/civic-issues?teamId=${ids.otherTeam}`)).json();
  assert.deepEqual(otherTeam.items, []);
});

test('inspection records are validated, assignment-scoped, immutable, and do not gate work', async () => {
  const issueId = createIssue().issueId;
  const pathname = `/api/officer/civic-issues/${issueId}/inspections`;
  assert.equal((await request(pathname, { userId: 2, method: 'POST', body: { findings: 'Citizen' } })).status, 403);
  assert.equal((await request(pathname, { userId: 1, method: 'POST', body: { findings: 'Admin' } })).status, 403);
  assert.equal((await request(pathname, { userId: 4, method: 'POST', body: { findings: 'Other team' } })).status, 404);
  assert.equal((await request('/api/officer/civic-issues/999999/inspections', {
    method: 'POST', body: { findings: 'Missing issue' }
  })).status, 404);
  assert.equal((await request(pathname, { method: 'POST', body: { findings: '   ' } })).status, 400);
  assert.equal((await request(pathname, {
    method: 'POST', body: { findings: 'Valid findings', status: 'RESOLVED' }
  })).status, 400);

  const response = await request(pathname, {
    method: 'POST', body: { findings: 'The drain is blocked by accumulated debris.' }
  });
  assert.equal(response.status, 201);
  const inspection = (await response.json()).inspection;
  assert.equal(inspection.findings, 'The drain is blocked by accumulated debris.');
  assert.equal(db.prepare('SELECT status FROM civic_issues WHERE id=?').get(issueId).status, 'OPEN');
  const detail = (await (await request(`/api/officer/civic-issues/${issueId}`)).json()).issue;
  assert.equal(detail.inspections[0].id, inspection.id);
  assert.equal(detail.inspections[0].officerName, 'Workflow User 3');
  const timeline = await (await request(`/api/officer/civic-issues/${issueId}/timeline`)).json();
  assert.ok(timeline.items.some(event =>
    event.eventType === 'INSPECTION_RECORDED' && event.reason === inspection.findings));
  assert.throws(() => db.prepare("UPDATE civic_issue_inspections SET findings='changed' WHERE id=?").run(inspection.id),
    /append-only/);
  assert.throws(() => db.prepare('DELETE FROM civic_issue_inspections WHERE id=?').run(inspection.id), /append-only/);

  assert.equal((await request(`/api/officer/civic-issues/${issueId}/start`, {
    method: 'POST', body: {}
  })).status, 200);
  assert.equal((await request(pathname, {
    method: 'POST', body: { findings: 'The issue persists after work begins.' }
  })).status, 201);
});

test('action plans preserve assignment-scoped history without gating work', async () => {
  const issueId = createIssue().issueId;
  const pathname = `/api/officer/civic-issues/${issueId}/action-plans`;
  assert.equal((await request(pathname, { userId: 2, method: 'POST', body: { description: 'Citizen plan' } })).status, 403);
  assert.equal((await request(pathname, { userId: 1, method: 'POST', body: { description: 'Admin plan' } })).status, 403);
  assert.equal((await request(pathname, { userId: 4, method: 'POST', body: { description: 'Other team' } })).status, 404);
  assert.equal((await request('/api/officer/civic-issues/999999/action-plans', {
    method: 'POST', body: { description: 'Missing issue' }
  })).status, 404);
  assert.equal((await request(pathname, { method: 'POST', body: { description: '   ' } })).status, 400);
  assert.equal((await request(pathname, {
    method: 'POST', body: { description: 'Plan', steps: Array(11).fill('Step') }
  })).status, 400);
  assert.equal((await request(pathname, {
    method: 'POST', body: { description: 'Plan', unexpected: true }
  })).status, 400);

  const firstResponse = await request(pathname, {
    method: 'POST',
    body: { description: 'Inspect the drain, then remove the debris.', steps: ['Inspect the affected drain', 'Clear the obstruction'] }
  });
  assert.equal(firstResponse.status, 201);
  const firstPlan = (await firstResponse.json()).actionPlan;
  assert.deepEqual(firstPlan.steps, ['Inspect the affected drain', 'Clear the obstruction']);
  const secondResponse = await request(pathname, {
    method: 'POST', body: { description: 'Verify the drain flow after clearing.' }
  });
  assert.equal(secondResponse.status, 201);
  const secondPlan = (await secondResponse.json()).actionPlan;

  const detail = (await (await request(`/api/officer/civic-issues/${issueId}`)).json()).issue;
  assert.deepEqual(detail.actionPlans.map(plan => plan.id), [firstPlan.id, secondPlan.id]);
  assert.equal(detail.actionPlans[0].officerName, 'Workflow User 3');
  const timeline = await (await request(`/api/officer/civic-issues/${issueId}/timeline`)).json();
  assert.ok(timeline.items.some(event =>
    event.eventType === 'ACTION_PLAN_SUBMITTED' && event.reason === firstPlan.description));
  assert.equal(db.prepare('SELECT status FROM civic_issues WHERE id=?').get(issueId).status, 'OPEN');
  assert.throws(() => db.prepare("UPDATE civic_issue_action_plans SET description='changed' WHERE id=?").run(firstPlan.id),
    /append-only/);
  assert.throws(() => db.prepare('DELETE FROM civic_issue_action_plans WHERE id=?').run(firstPlan.id), /append-only/);

  reassignIssueTeam(issueId, ids.otherTeam, 'Roads & Infrastructure', 1);
  assert.equal((await request(`/api/officer/civic-issues/${issueId}`, { userId: 3 })).status, 404);
  assert.equal((await request(pathname, {
    method: 'POST', body: { description: 'Old assignment plan' }
  })).status, 404);
  const reassignedIssue = (await (await request(`/api/officer/civic-issues/${issueId}`, { userId: 4 })).json()).issue;
  assert.deepEqual(reassignedIssue.actionPlans, []);
  const newAssignmentPlan = await request(pathname, {
    userId: 4, method: 'POST', body: { description: 'Plan for the current assignment' }
  });
  assert.equal(newAssignmentPlan.status, 201);
  const currentPlans = (await (await request(`/api/officer/civic-issues/${issueId}`, { userId: 4 })).json()).issue.actionPlans;
  assert.deepEqual(currentPlans.map(plan => plan.description), ['Plan for the current assignment']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM civic_issue_action_plans WHERE civic_issue_id=?')
    .get(issueId).count, 3);

  const issueWithoutPlan = createIssue().issueId;
  assert.equal((await request(`/api/officer/civic-issues/${issueWithoutPlan}/start`, {
    method: 'POST', body: {}
  })).status, 200);
});

test('progress updates require active work and remain append-only audit entries', async () => {
  const issueId = createIssue().issueId;
  const pathname = `/api/officer/civic-issues/${issueId}/progress-updates`;
  assert.equal((await request(pathname, {
    method: 'POST', body: { message: 'Work has not started yet.' }
  })).status, 409);
  assert.equal((await request(`/api/officer/civic-issues/999999/progress-updates`, {
    method: 'POST', body: { message: 'Missing issue.' }
  })).status, 404);
  assert.equal((await request(pathname, { userId: 2, method: 'POST', body: { message: 'Citizen' } })).status, 403);
  assert.equal((await request(pathname, { userId: 1, method: 'POST', body: { message: 'Admin' } })).status, 403);
  assert.equal((await request(pathname, { userId: 4, method: 'POST', body: { message: 'Other team' } })).status, 404);
  assert.equal((await request(pathname, { method: 'POST', body: { message: '   ' } })).status, 400);
  assert.equal((await request(pathname, {
    method: 'POST', body: { message: 'Valid update', status: 'RESOLVED' }
  })).status, 400);

  assert.equal((await request(`/api/officer/civic-issues/${issueId}/start`, {
    method: 'POST', body: {}
  })).status, 200);
  const response = await request(pathname, {
    method: 'POST', body: { message: 'Cleared debris from the drain inlet.' }
  });
  assert.equal(response.status, 201);
  const update = (await response.json()).update;
  assert.equal(update.message, 'Cleared debris from the drain inlet.');
  assert.equal(db.prepare('SELECT status FROM civic_issues WHERE id=?').get(issueId).status, 'IN_PROGRESS');
  const detail = (await (await request(`/api/officer/civic-issues/${issueId}`)).json()).issue;
  assert.equal(detail.progressUpdates[0].id, update.id);
  const timeline = await (await request(`/api/officer/civic-issues/${issueId}/timeline`)).json();
  assert.ok(timeline.items.some(event =>
    event.eventType === 'PROGRESS_UPDATED' && event.reason === update.message));
  assert.throws(() => db.prepare("UPDATE civic_issue_progress_updates SET message='changed' WHERE id=?").run(update.id),
    /append-only/);
  assert.throws(() => db.prepare('DELETE FROM civic_issue_progress_updates WHERE id=?').run(update.id), /append-only/);
});

test('work starts once and assignment changes are blocked during IN_PROGRESS', async () => {
  const started = await request(`/api/officer/civic-issues/${ids.issue.issueId}/start`, { method: 'POST', body: {} });
  assert.equal(started.status, 200);
  assert.equal((await started.json()).event.status, 'IN_PROGRESS');
  const dashboard = await (await request('/api/officer/dashboard')).json();
  assert.ok(dashboard.recentActivity.some(event =>
    event.civicIssueId === ids.issue.issueId && event.eventType === 'STARTED'));
  assert.equal((await request(`/api/officer/civic-issues/${ids.issue.issueId}/start`, { method: 'POST', body: {} })).status, 409);
  assert.throws(() => reassignIssueTeam(ids.issue.issueId, ids.otherTeam, 'Roads & Infrastructure', 1), { status: 409 });
  assert.throws(() => unassignIssueTeam(ids.issue.issueId, 1), { status: 409 });
  assert.throws(() => db.prepare(`UPDATE civic_issues SET assigned_team_id=? WHERE id=?`).run(ids.otherTeam, ids.issue.issueId), /team assignment cannot change/);
  assert.throws(() => db.prepare(`UPDATE civic_issues SET assigned_team_id=NULL,routing_department=NULL WHERE id=?`).run(ids.issue.issueId), /team assignment cannot change/);
  assert.equal(db.prepare('SELECT assigned_team_id FROM civic_issues WHERE id=?').get(ids.issue.issueId).assigned_team_id, ids.team);
});

test('BEFORE evidence is allowed before or during work; AFTER evidence only during work; evidence records bind to assignment events', async () => {
  const beforeIssue = ids.secondIssue.issueId;
  const before = await upload(beforeIssue, 'BEFORE');
  assert.equal(before.status, 201);
  const beforeEvidence = (await before.json()).evidence;
  const boundBefore = db.prepare('SELECT assignment_event_id,team_id,uploaded_by_officer_id FROM civic_issue_repair_evidence WHERE id=?').get(beforeEvidence.id);
  assert.deepEqual(boundBefore, { assignment_event_id: ids.secondIssue.assignmentEventId, team_id: ids.team, uploaded_by_officer_id: 3 });
  assert.equal((await upload(beforeIssue, 'AFTER')).status, 409);
  assert.equal((await request(`/api/officer/civic-issues/${beforeIssue}/start`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await upload(beforeIssue, 'BEFORE')).status, 201);
  assert.equal((await upload(beforeIssue, 'AFTER')).status, 201);
  const listed = await (await request(`/api/officer/civic-issues/${beforeIssue}/repair-evidence`)).json();
  assert.equal(listed.items.length, 3);
  assert.ok(listed.items.every(item => item.url.startsWith('https://private.test/')));
  assert.equal(JSON.stringify(listed).includes('objectKey'), false);
});

test('completion requires both stages, then conditionally resolves and records history', async () => {
  const issueId = ids.unassignedIssue;
  assert.equal((await request(`/api/officer/civic-issues/${issueId}/complete`, {
    method: 'POST', body: { summary: 'Resolution details.' }
  })).status, 404);
  const noEvidenceIssue = createIssue().issueId;
  await request(`/api/officer/civic-issues/${noEvidenceIssue}/start`, { method: 'POST', body: {} });
  const noEvidencePath = `/api/officer/civic-issues/${noEvidenceIssue}/complete`;
  assert.equal((await request(noEvidencePath, { method: 'POST', body: {} })).status, 400);
  assert.equal((await request(noEvidencePath, { userId: 2, method: 'POST', body: { summary: 'Citizen' } })).status, 403);
  assert.equal((await request(noEvidencePath, { userId: 1, method: 'POST', body: { summary: 'Admin' } })).status, 403);
  assert.equal((await request(noEvidencePath, { userId: 4, method: 'POST', body: { summary: 'Other team' } })).status, 404);
  assert.equal((await request(noEvidencePath, {
    method: 'POST', body: { summary: '   ' }
  })).status, 400);
  assert.equal((await request(noEvidencePath, {
    method: 'POST', body: { summary: 'Resolution details.', status: 'RESOLVED' }
  })).status, 400);
  assert.equal((await request(noEvidencePath, {
    method: 'POST', body: { summary: 'Resolution details.' }
  })).status, 409);
  const afterOnlyIssue = createIssue().issueId;
  await request(`/api/officer/civic-issues/${afterOnlyIssue}/start`, { method: 'POST', body: {} });
  assert.equal((await upload(afterOnlyIssue, 'AFTER')).status, 201);
  const missingBefore = await request(`/api/officer/civic-issues/${afterOnlyIssue}/complete`, {
    method: 'POST', body: { summary: 'Attempted resolution.' }
  });
  assert.equal(missingBefore.status, 409);

  const completeIssue = createIssue().issueId;
  const complaintId = Number(db.prepare(`INSERT INTO complaints
    (user_id,civic_issue_id,title,description,latitude,longitude)
    VALUES(2,?,'Reported street issue','A sufficiently detailed report of this street issue.',1,2)`)
    .run(completeIssue).lastInsertRowid);
  await upload(completeIssue, 'BEFORE');
  await request(`/api/officer/civic-issues/${completeIssue}/start`, { method: 'POST', body: {} });
  await upload(completeIssue, 'AFTER');
  const completed = await request(`/api/officer/civic-issues/${completeIssue}/complete`, {
    method: 'POST', body: { summary: 'Repaired the damaged road surface.' }
  });
  assert.equal(completed.status, 200);
  const completionResult = await completed.json();
  assert.equal(completionResult.event.status, 'RESOLVED');
  assert.equal(completionResult.resolution.summary, 'Repaired the damaged road surface.');
  const savedResolution = db.prepare(`SELECT summary,before_evidence_id,after_evidence_id
    FROM civic_issue_resolutions WHERE id=?`).get(completionResult.resolution.id);
  assert.deepEqual(savedResolution, {
    summary: 'Repaired the damaged road surface.',
    before_evidence_id: completionResult.resolution.beforeEvidenceId,
    after_evidence_id: completionResult.resolution.afterEvidenceId
  });
  assert.throws(() => db.prepare("UPDATE civic_issue_resolutions SET summary='changed' WHERE id=?")
    .run(completionResult.resolution.id), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM civic_issue_resolutions WHERE id=?')
    .run(completionResult.resolution.id), /append-only/);
  const detail = (await (await request(`/api/officer/civic-issues/${completeIssue}`)).json()).issue;
  assert.equal(detail.resolutions[0].summary, 'Repaired the damaged road surface.');
  assert.equal(db.prepare('SELECT status FROM civic_issues WHERE id=?').get(completeIssue).status, 'RESOLVED');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM civic_issue_work_events WHERE civic_issue_id=? AND event_type='COMPLETED'").get(completeIssue).count, 1);
  const notification = db.prepare(`SELECT user_id,title,notification_type,related_complaint_id,event_key
    FROM notifications WHERE related_complaint_id=?`).get(complaintId);
  assert.ok(notification);
  assert.deepEqual({
    user_id: notification.user_id,
    title: notification.title,
    notification_type: notification.notification_type,
    related_complaint_id: notification.related_complaint_id
  }, {
    user_id: 2,
    title: 'Your complaint has been resolved',
    notification_type: 'ISSUE_RESOLVED',
    related_complaint_id: complaintId
  });
  assert.match(notification.event_key, new RegExp(`^issue:${completeIssue}:work:\\d+$`));
  assert.equal((await request(`/api/officer/civic-issues/${completeIssue}/complete`, {
    method: 'POST', body: { summary: 'Another resolution.' }
  })).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE related_complaint_id=?').get(complaintId).count, 1);
  db.prepare(`INSERT INTO civic_issue_resolution_verifications
    (civic_issue_id,complaint_id,citizen_user_id,decision,reason)
    VALUES(?,?,2,'DISPUTE','The repair needs another visit')`).run(completeIssue, complaintId);
  const timeline = await (await request(`/api/officer/civic-issues/${completeIssue}/timeline`)).json();
  assert.ok(timeline.items.some(event =>
    event.eventType === 'COMPLETED' && event.statusAfter === 'RESOLVED'
      && event.reason === 'Repaired the damaged road surface.'));
  assert.ok(timeline.items.some(event =>
    event.eventType === 'RESOLUTION_DISPUTED' && event.reason === 'The repair needs another visit'));
});

test('failed start, evidence persistence, and completion transactions leave no partial state', async () => {
  const startIssue = createIssue().issueId;
  db.exec(`CREATE TRIGGER fail_start_audit BEFORE INSERT ON civic_issue_work_events
    WHEN NEW.civic_issue_id=${startIssue} AND NEW.event_type='STARTED' BEGIN SELECT RAISE(ABORT,'forced'); END`);
  assert.equal((await request(`/api/officer/civic-issues/${startIssue}/start`, { method: 'POST', body: {} })).status, 500);
  assert.equal(db.prepare('SELECT status FROM civic_issues WHERE id=?').get(startIssue).status, 'OPEN');
  db.exec('DROP TRIGGER fail_start_audit');

  const evidenceIssue = createIssue().issueId;
  const previousUploadCount = uploaded.size;
  db.exec(`CREATE TRIGGER fail_evidence_audit BEFORE INSERT ON civic_issue_work_events
    WHEN NEW.civic_issue_id=${evidenceIssue} AND NEW.event_type='EVIDENCE_UPLOADED' BEGIN SELECT RAISE(ABORT,'forced'); END`);
  assert.equal((await upload(evidenceIssue, 'BEFORE')).status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM civic_issue_repair_evidence WHERE civic_issue_id=?').get(evidenceIssue).count, 0);
  assert.equal(uploaded.size, previousUploadCount);
  db.exec('DROP TRIGGER fail_evidence_audit');

  const completeIssue = createIssue().issueId;
  await upload(completeIssue, 'BEFORE');
  await request(`/api/officer/civic-issues/${completeIssue}/start`, { method: 'POST', body: {} });
  await upload(completeIssue, 'AFTER');
  db.exec(`CREATE TRIGGER fail_complete_audit BEFORE INSERT ON civic_issue_work_events
    WHEN NEW.civic_issue_id=${completeIssue} AND NEW.event_type='COMPLETED' BEGIN SELECT RAISE(ABORT,'forced'); END`);
  assert.equal((await request(`/api/officer/civic-issues/${completeIssue}/complete`, {
    method: 'POST', body: { summary: 'A transaction failure must roll back.' }
  })).status, 500);
  assert.equal(db.prepare('SELECT status FROM civic_issues WHERE id=?').get(completeIssue).status, 'IN_PROGRESS');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM civic_issue_work_events WHERE civic_issue_id=? AND event_type='COMPLETED'").get(completeIssue).count, 0);
  db.exec('DROP TRIGGER fail_complete_audit');
});

test('removed team members lose access; admin issue detail retains evidence and work audit', async () => {
  const issueId = createIssue().issueId;
  await upload(issueId, 'BEFORE');
  db.prepare(`UPDATE ward_team_memberships SET removed_by_admin_id=1,removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE team_id=? AND officer_user_id=3 AND removed_at IS NULL`).run(ids.team);
  assert.equal((await request(`/api/officer/civic-issues/${issueId}`)).status, 404);
  db.prepare(`INSERT INTO ward_team_memberships(team_id,officer_user_id,added_by_admin_id) VALUES(?,3,1)`).run(ids.team);
  const { getCivicIssue } = await import('../src/modules/admin/admin.service.js');
  const detail = getCivicIssue(issueId);
  assert.equal(detail.repairEvidence.length, 1);
  assert.equal(detail.repairEvidence[0].assignmentEventId, db.prepare('SELECT id FROM civic_issue_team_assignment_events WHERE civic_issue_id=?').get(issueId).id);
  assert.ok(Array.isArray(detail.workHistory));
});

test('evidence and workflow audit tables reject edits and deletes', async () => {
  const issueId = createIssue().issueId;
  const uploadedResponse = await upload(issueId, 'BEFORE');
  assert.equal(uploadedResponse.status, 201);
  const evidenceId = db.prepare('SELECT id FROM civic_issue_repair_evidence WHERE civic_issue_id=?').get(issueId).id;
  const eventId = db.prepare("SELECT id FROM civic_issue_work_events WHERE civic_issue_id=? AND event_type='EVIDENCE_UPLOADED'").get(issueId).id;
  assert.throws(() => db.prepare("UPDATE civic_issue_repair_evidence SET stage='AFTER' WHERE id=?").run(evidenceId), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM civic_issue_repair_evidence WHERE id=?').run(evidenceId));
  assert.throws(() => db.prepare("UPDATE civic_issue_work_events SET event_type='STARTED' WHERE id=?").run(eventId), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM civic_issue_work_events WHERE id=?').run(eventId), /append-only/);
});

test('officers can access assignments through each active team membership', async () => {
  db.prepare(`INSERT INTO ward_team_memberships(team_id,officer_user_id,added_by_admin_id)
    VALUES(?,3,1)`).run(ids.otherTeam);
  const secondTeamIssue = createIssue(ids.otherTeam).issueId;
  const result = await (await request(`/api/officer/civic-issues?teamId=${ids.otherTeam}`)).json();
  assert.ok(result.items.some(issue => issue.id === secondTeamIssue));
  const dashboard = await (await request('/api/officer/dashboard')).json();
  assert.deepEqual(dashboard.teams.map(team => team.id).sort(), [ids.team, ids.otherTeam].sort());
});

test('officer profile exposes only the signed-in officer and active team details', async () => {
  db.prepare("UPDATE users SET employee_id='EMP-003' WHERE id=3").run();
  const response = await request('/api/officer/profile');
  assert.equal(response.status, 200);
  const profile = (await response.json()).profile;
  assert.deepEqual({
    id: profile.id,
    name: profile.name,
    email: profile.email,
    employeeId: profile.employeeId
  }, {
    id: 3,
    name: 'Workflow User 3',
    email: 'workflow-3@example.test',
    employeeId: 'EMP-003'
  });
  assert.deepEqual(profile.teams.map(team => team.id).sort(), [ids.team, ids.otherTeam].sort());
  assert.equal(JSON.stringify(profile).includes('password'), false);
  assert.equal(JSON.stringify(profile).includes('accountStatus'), false);
  assert.equal((await request('/api/officer/profile', { userId: 2 })).status, 403);
  assert.equal((await request('/api/officer/profile', { userId: 1 })).status, 403);
});

test('team assignment notifications target active officers and keep notification access user-scoped', async () => {
  const issueId = Number(db.prepare('INSERT INTO civic_issues DEFAULT VALUES').run().lastInsertRowid);
  const assignment = assignIssueToTeam(issueId, ids.team, 'Roads & Infrastructure', 1);
  const originalNotifications = db.prepare(`SELECT user_id,notification_type,related_complaint_id,
      related_civic_issue_id,event_key
    FROM notifications WHERE related_civic_issue_id=? ORDER BY user_id`).all(issueId);
  assert.deepEqual(originalNotifications, [
    { user_id: 3, notification_type: 'ISSUE_ASSIGNED', related_complaint_id: null,
      related_civic_issue_id: issueId, event_key: `issue:${issueId}:assignment:${assignment.id}` }
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE related_civic_issue_id=? AND user_id IN (1,2,4,5)')
    .get(issueId).count, 0);

  const listed = await request('/api/notifications');
  assert.equal(listed.status, 200);
  const officerNotification = (await listed.json()).items.find(item => item.relatedCivicIssueId === issueId);
  assert.ok(officerNotification);
  assert.equal(officerNotification.notificationType, 'ISSUE_ASSIGNED');
  assert.equal((await request('/api/notifications', { userId: 1 })).status, 403);
  const citizenNotifications = await (await request('/api/notifications', { userId: 2 })).json();
  assert.equal(citizenNotifications.items.some(item => item.relatedCivicIssueId === issueId), false);
  assert.equal((await request(`/api/notifications/${officerNotification.id}/read`, {
    userId: 4, method: 'PATCH'
  })).status, 404);
  const marked = await request(`/api/notifications/${officerNotification.id}/read`, { method: 'PATCH' });
  assert.equal(marked.status, 200);
  assert.equal((await marked.json()).notification.isRead, true);

  const reassignment = reassignIssueTeam(issueId, ids.otherTeam, 'Roads & Infrastructure', 1);
  const reassignedNotification = db.prepare(`SELECT user_id,notification_type,related_civic_issue_id,event_key
    FROM notifications WHERE user_id=4 AND related_civic_issue_id=?`).get(issueId);
  assert.deepEqual(reassignedNotification, {
    user_id: 4, notification_type: 'ISSUE_ASSIGNED', related_civic_issue_id: issueId,
    event_key: `issue:${issueId}:assignment:${reassignment.id}`
  });
  assert.throws(() => db.prepare(`INSERT INTO notifications
    (user_id,title,message,notification_type,related_civic_issue_id,event_key)
    VALUES(1,'Invalid assignment','Not an officer','ISSUE_ASSIGNED',?,'invalid-assignment')`).run(issueId),
  /current active team member/);
});

test('repair evidence URLs are limited to the current assignment event', async () => {
  db.prepare(`INSERT OR IGNORE INTO ward_team_memberships(team_id,officer_user_id,added_by_admin_id)
    VALUES(?,3,1)`).run(ids.otherTeam);
  const issueId = createIssue(ids.team).issueId;
  assert.equal((await upload(issueId, 'BEFORE')).status, 201);

  reassignIssueTeam(issueId, ids.otherTeam, 'Roads & Infrastructure', 1);
  const response = await request(`/api/officer/civic-issues/${issueId}/repair-evidence`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, []);
});
