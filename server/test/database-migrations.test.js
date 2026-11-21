import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-migrations-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'runner.sqlite');
process.env.JWT_SECRET = 'migration-test-secret-long-enough-to-validate';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';

const { migrateDatabase, migrations } = await import('../src/database/migrate.js');
const { up: createCoreSchema } = await import('../src/database/migrations/001_core_schema.js');
import * as coreMigration from '../src/database/migrations/001_core_schema.js';
import * as civicIssueMigration from '../src/database/migrations/002_civic_issues.js';
import * as assignmentMigration from '../src/database/migrations/003_issue_assignments.js';
import * as groupingMigration from '../src/database/migrations/004_issue_grouping.js';
import * as authOtpMigration from '../src/database/migrations/019_auth_otp_purposes_and_rate_limits.js';
import * as requiredVerificationDestinationMigration from '../src/database/migrations/020_required_verification_destination.js';
import * as officerNotificationsMigration from '../src/database/migrations/031_officer_notifications.js';
const { db: defaultDb, closeDatabase } = await import('../src/config/database.js');

after(() => {
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('fresh initialization applies each migration once and creates the full schema', () => {
  const fresh = new Database(':memory:');
  fresh.pragma('foreign_keys = ON');
  assert.deepEqual(migrateDatabase(fresh), ['001_core_schema', '002_civic_issues', '003_issue_assignments', '004_issue_grouping', '005_ward_team_management', '006_issue_team_assignments', '007_officer_workflow_evidence', '008_citizen_resolution_verification', '009_announcements', '010_announcement_visibility', '011_notifications', '012_profile_images', '013_citizen_preferences', '014_profile_support_password_reset', '015_citizen_verification', '016_account_lifecycle', '017_auth_phone_and_verification', '018_verification_challenge_destination', '019_auth_otp_purposes_and_rate_limits', '020_required_verification_destination', '021_email_only_verification', '022_registration_otp_delivery_state', '023_complaint_address', '024_support_submission_status', '025_support_suggestions_workflow', '026_announcement_management', '027_officer_management', '028_officer_inspections', '029_officer_work_progress', '030_officer_resolutions', '031_officer_notifications', '032_officer_action_plans']);
  assert.deepEqual(migrateDatabase(fresh), []);
  assert.equal(fresh.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 32);
  assert.ok(fresh.prepare('PRAGMA table_info(citizen_support_submissions)').all().some((column) => column.name === 'status'));
  assert.ok(fresh.prepare('PRAGMA table_info(citizen_support_submissions)').all().some((column) => column.name === 'admin_notes'));
  assert.ok(fresh.prepare('PRAGMA table_info(citizen_support_submissions)').all().some((column) => column.name === 'updated_at'));
  assert.ok(fresh.prepare('PRAGMA table_info(citizen_support_submissions)').all().some((column) => column.name === 'closed_at'));
  assert.ok(fresh.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'date_of_birth'));
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='citizen_support_submissions'").get());
  assert.ok(fresh.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'notification_preferences'));
  assert.ok(fresh.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'profile_image_key'));
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notifications'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_announcements'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_issue_inspections'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_issue_progress_updates'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_issue_resolutions'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_issue_action_plans'").get());
  assert.ok(fresh.prepare('PRAGMA table_info(notifications)').all().some((column) => column.name === 'related_civic_issue_id'));
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_verification_challenges'").get());
  assert.ok(fresh.prepare('PRAGMA table_info(user_verification_challenges)').all().some((column) => column.name === 'purpose'));
  const userColumns = fresh.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  assert.equal(userColumns.includes('mobile_verified'), false);
  assert.equal(userColumns.includes('mobile_verified_at'), false);
  assert.ok(userColumns.includes('phone_number'));
  assert.ok(fresh.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql
    .includes('PENDING_EMAIL_VERIFICATION'));
  assert.equal(fresh.prepare('PRAGMA table_info(user_verification_challenges)').all()
    .find((column) => column.name === 'channel').dflt_value, null);
  const deliveryStatus = fresh.prepare('PRAGMA table_info(user_verification_challenges)')
    .all().find((column) => column.name === 'delivery_status');
  assert.equal(deliveryStatus.notnull, 1);
  assert.equal(deliveryStatus.dflt_value, "'UNKNOWN'");
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_request_rate_limits'").get());
  assert.ok(fresh.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'account_status'));
  assert.ok(fresh.prepare('PRAGMA table_info(civic_announcements)').all().some((column) => column.name === 'is_published'));
  assert.ok(fresh.prepare('PRAGMA table_info(civic_announcements)').all().some((column) => column.name === 'is_public'));
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wards'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ward_teams'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ward_team_memberships'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_issue_team_assignment_events'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_issue_repair_evidence'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_issue_work_events'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_issue_resolution_verifications'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='civic_issue_dispute_reviews'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'civic_issues'").get());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'civic_issue_duplicate_suggestions'").get());
  assert.ok(fresh.prepare('PRAGMA table_info(complaints)').all().some((column) => column.name === 'civic_issue_id'));
  assert.ok(fresh.prepare('PRAGMA table_info(civic_issues)').all().some((column) => column.name === 'assigned_officer_id'));
  assert.ok(fresh.prepare('PRAGMA table_info(civic_issues)').all().some((column) => column.name === 'assigned_team_id'));
  fresh.close();
});

test('migration 026 preserves announcements and enforces priority and UTC scheduling', () => {
  const announcementsDb = new Database(':memory:');
  announcementsDb.pragma('foreign_keys = ON');
  announcementsDb.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL)');
  announcementsDb.prepare('INSERT INTO users (id, role) VALUES (1, ?)').run('ADMIN');

  for (const version of ['009_announcements', '010_announcement_visibility']) {
    const migration = migrations.find((candidate) => candidate.version === version);
    assert.ok(migration, `Expected migration ${version} to be registered`);
    migration.up(announcementsDb);
  }

  announcementsDb.prepare(`INSERT INTO civic_announcements
    (id,title,description,published_by_admin_id,published_at,created_at,is_published,is_public)
    VALUES
      (1,'Published notice','Existing public content',1,'2026-01-02T03:04:05.000Z',
       '2026-01-01T00:00:00.000Z',1,1),
      (2,'Unpublished notice','Existing unpublished content',1,'2026-01-04T03:04:05.000Z',
       '2026-01-03T00:00:00.000Z',0,0)`).run();

  const originalRows = announcementsDb.prepare(`SELECT id,title,description,published_by_admin_id,
    published_at,created_at,is_published,is_public
    FROM civic_announcements ORDER BY id`).all();
  const migration = migrations.find((candidate) => candidate.version === '026_announcement_management');
  assert.ok(migration, 'Expected migration 026 to be registered');
  migration.up(announcementsDb);

  const migratedRows = announcementsDb.prepare(`SELECT id,title,description,published_by_admin_id,
    published_at,created_at,is_published,is_public,priority,starts_at,expires_at
    FROM civic_announcements ORDER BY id`).all();
  assert.deepEqual(migratedRows.map(({ priority, starts_at, expires_at, ...row }) => row), originalRows);
  assert.deepEqual(migratedRows.map(({ priority, starts_at, expires_at }) =>
    ({ priority, starts_at, expires_at })), [
    { priority: 'NORMAL', starts_at: null, expires_at: null },
    { priority: 'NORMAL', starts_at: null, expires_at: null }
  ]);
  assert.deepEqual(migratedRows.map((row) => row.is_published), [1, 0]);

  const insertAnnouncement = announcementsDb.prepare(`INSERT INTO civic_announcements
    (title,description,published_by_admin_id,priority,starts_at,expires_at)
    VALUES (?,'Test content',1,?,?,?)`);
  for (const priority of ['LOW', 'NORMAL', 'HIGH']) {
    insertAnnouncement.run(`Priority ${priority}`, priority, null, null);
  }
  announcementsDb.prepare(`INSERT INTO civic_announcements
    (title,description,published_by_admin_id)
    VALUES ('Default priority','Test content',1)`).run();
  assert.equal(announcementsDb.prepare(`SELECT priority FROM civic_announcements
    WHERE title='Default priority'`).get().priority, 'NORMAL');
  assert.throws(() => insertAnnouncement.run('Invalid priority', 'URGENT', null, null), {
    code: 'SQLITE_CONSTRAINT_CHECK'
  });

  insertAnnouncement.run('Start only', 'NORMAL', '2026-01-01T00:00:00.000Z', null);
  insertAnnouncement.run('Expiry only', 'NORMAL', null, '2026-01-02T00:00:00.000Z');
  insertAnnouncement.run(
    'Scheduled',
    'HIGH',
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z'
  );
  assert.throws(() => insertAnnouncement.run(
    'Same instant',
    'NORMAL',
    '2026-01-02T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z'
  ), { code: 'SQLITE_CONSTRAINT_CHECK' });
  assert.throws(() => insertAnnouncement.run(
    'Earlier expiry',
    'NORMAL',
    '2026-01-02T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z'
  ), { code: 'SQLITE_CONSTRAINT_CHECK' });
  assert.throws(() => insertAnnouncement.run(
    'Non-UTC schedule',
    'NORMAL',
    '2026-01-01T00:00:00+01:00',
    null
  ), { code: 'SQLITE_CONSTRAINT_CHECK' });

  announcementsDb.close();
});

test('existing complaint, media, user and AI assessment data survive issue backfill', () => {
  const existing = new Database(':memory:');
  existing.pragma('foreign_keys = ON');
  createCoreSchema(existing);
  existing.prepare(`INSERT INTO users (id, display_name, email, password_hash, role)
    VALUES (1, 'Existing Citizen', 'citizen@example.test', 'hash', 'CITIZEN')`).run();
  existing.prepare(`INSERT INTO complaints (id, user_id, title, description, latitude, longitude, status)
    VALUES (11, 1, 'Pothole', 'A pothole near a crossing.', 1, 2, 'SUBMITTED')`).run();
  existing.prepare(`INSERT INTO complaint_media
    (id, complaint_id, uploader_id, object_key, media_type, mime_type, byte_size)
    VALUES (21, 11, 1, 'complaints/existing.jpg', 'IMAGE', 'image/jpeg', 100)`).run();
  existing.prepare(`INSERT INTO complaint_ai_assessments
    (id, complaint_id, status, category, department, severity, severity_reason, risk_factors,
     confidence, human_review_required, human_review_reason)
    VALUES (31, 11, 'SUCCEEDED', 'ROAD_DAMAGE', 'Roads & Infrastructure', 'MEDIUM',
      'A reported road defect.', '[]', 0.8, 0, '')`).run();

  assert.deepEqual(migrateDatabase(existing), ['001_core_schema', '002_civic_issues', '003_issue_assignments', '004_issue_grouping', '005_ward_team_management', '006_issue_team_assignments', '007_officer_workflow_evidence', '008_citizen_resolution_verification', '009_announcements', '010_announcement_visibility', '011_notifications', '012_profile_images', '013_citizen_preferences', '014_profile_support_password_reset', '015_citizen_verification', '016_account_lifecycle', '017_auth_phone_and_verification', '018_verification_challenge_destination', '019_auth_otp_purposes_and_rate_limits', '020_required_verification_destination', '021_email_only_verification', '022_registration_otp_delivery_state', '023_complaint_address', '024_support_submission_status', '025_support_suggestions_workflow', '026_announcement_management', '027_officer_management', '028_officer_inspections', '029_officer_work_progress', '030_officer_resolutions', '031_officer_notifications', '032_officer_action_plans']);
  assert.equal(existing.prepare('SELECT account_status FROM users WHERE id=1').get().account_status, 'ACTIVE');
  const linked = existing.prepare(`SELECT c.id, c.user_id, c.status, c.civic_issue_id, i.status AS issue_status
    FROM complaints c JOIN civic_issues i ON i.id = c.civic_issue_id WHERE c.id = 11`).get();
  assert.equal(linked.id, 11);
  assert.equal(linked.user_id, 1);
  assert.equal(linked.status, 'SUBMITTED');
  assert.equal(linked.issue_status, 'OPEN');
  assert.ok(linked.civic_issue_id > 0);
  assert.equal(existing.prepare('SELECT COUNT(*) AS count FROM complaint_media WHERE id = 21').get().count, 1);
  assert.equal(existing.prepare('SELECT COUNT(*) AS count FROM complaint_ai_assessments WHERE id = 31').get().count, 1);
  assert.equal(existing.prepare('PRAGMA foreign_key_check').all().length, 0);

  const issueCount = existing.prepare('SELECT COUNT(*) AS count FROM civic_issues').get().count;
  assert.deepEqual(migrateDatabase(existing), []);
  assert.equal(existing.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 32);
  assert.equal(existing.prepare('SELECT COUNT(*) AS count FROM civic_issues').get().count, issueCount);
  assert.throws(() => existing.prepare('UPDATE complaints SET civic_issue_id = 999 WHERE id = 11').run());
  existing.close();
});

test('ward migration preserves existing individual assignment and append-only history', () => {
  const legacy = new Database(':memory:');
  legacy.pragma('foreign_keys = ON');
  for (const migration of [coreMigration, civicIssueMigration, assignmentMigration, groupingMigration]) migration.up(legacy);
  legacy.prepare(`INSERT INTO users(id,display_name,email,password_hash,role) VALUES
    (1,'Legacy Admin','legacy-admin@example.test','hash','ADMIN'),
    (2,'Legacy Officer','legacy-officer@example.test','hash','OFFICER')`).run();
  const issueId = Number(legacy.prepare('INSERT INTO civic_issues DEFAULT VALUES').run().lastInsertRowid);
  legacy.prepare('UPDATE civic_issues SET assigned_officer_id=? WHERE id=?').run(2, issueId);
  legacy.prepare(`INSERT INTO civic_issue_assignment_events
    (civic_issue_id,event_type,previous_officer_id,officer_id,admin_user_id)
    VALUES(?,'ASSIGNED',NULL,2,1)`).run(issueId);
  legacy.exec(`CREATE TABLE schema_migrations (
    version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  for (const version of ['001_core_schema','002_civic_issues','003_issue_assignments','004_issue_grouping']) {
    legacy.prepare('INSERT INTO schema_migrations(version) VALUES(?)').run(version);
  }

  assert.deepEqual(migrateDatabase(legacy), ['005_ward_team_management', '006_issue_team_assignments', '007_officer_workflow_evidence', '008_citizen_resolution_verification', '009_announcements', '010_announcement_visibility', '011_notifications', '012_profile_images', '013_citizen_preferences', '014_profile_support_password_reset', '015_citizen_verification', '016_account_lifecycle', '017_auth_phone_and_verification', '018_verification_challenge_destination', '019_auth_otp_purposes_and_rate_limits', '020_required_verification_destination', '021_email_only_verification', '022_registration_otp_delivery_state', '023_complaint_address', '024_support_submission_status', '025_support_suggestions_workflow', '026_announcement_management', '027_officer_management', '028_officer_inspections', '029_officer_work_progress', '030_officer_resolutions', '031_officer_notifications', '032_officer_action_plans']);
  assert.equal(legacy.prepare('SELECT assigned_officer_id FROM civic_issues WHERE id=?').get(issueId).assigned_officer_id, 2);
  assert.deepEqual(legacy.prepare(`SELECT event_type,officer_id,admin_user_id
    FROM civic_issue_assignment_events WHERE civic_issue_id=?`).get(issueId), {
    event_type: 'ASSIGNED', officer_id: 2, admin_user_id: 1
  });
  legacy.close();
});

test('OTP purpose migration preserves challenge data while assigning safe purposes', () => {
  const legacy = new Database(':memory:');
  legacy.pragma('foreign_keys = ON');
  legacy.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, account_status TEXT NOT NULL);
    CREATE TABLE user_verification_challenges (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      destination TEXT NOT NULL DEFAULT '',
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resend_after TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      consumed_at TEXT,
      PRIMARY KEY (user_id,channel)
    );`);
  legacy.prepare('INSERT INTO users(id,account_status) VALUES(1,?),(2,?)')
    .run('PENDING_MOBILE_VERIFICATION', 'ACTIVE');
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  legacy.prepare(`INSERT INTO user_verification_challenges
    (user_id,channel,destination,code_hash,expires_at,resend_after,attempt_count,consumed_at)
    VALUES(1,'EMAIL','pending@example.test','hash1',?,?,2,NULL),
          (2,'EMAIL','active@example.test','hash2',?,?,1,NULL)`)
    .run(expiresAt, expiresAt, expiresAt, expiresAt);

  authOtpMigration.up(legacy);
  requiredVerificationDestinationMigration.up(legacy);
  const challenges = legacy.prepare(`SELECT user_id,channel,purpose,destination,code_hash,attempt_count
    FROM user_verification_challenges ORDER BY user_id`).all();
  assert.deepEqual(challenges, [
    { user_id: 1, channel: 'EMAIL', purpose: 'REGISTRATION', destination: 'pending@example.test', code_hash: 'hash1', attempt_count: 2 },
    { user_id: 2, channel: 'EMAIL', purpose: 'PROFILE_VERIFICATION', destination: 'active@example.test', code_hash: 'hash2', attempt_count: 1 }
  ]);
  const requiredDestinationColumn = legacy.prepare('PRAGMA table_info(user_verification_challenges)')
    .all().find((column) => column.name === 'destination');
  assert.equal(requiredDestinationColumn.notnull, 1);
  assert.equal(requiredDestinationColumn.dflt_value, null);
  assert.throws(() => legacy.prepare(`INSERT INTO user_verification_challenges
    (user_id,channel,purpose,code_hash,expires_at,resend_after)
    VALUES(1,'EMAIL','LOGIN','hash3',?,?)`).run(expiresAt, expiresAt), {
    code: 'SQLITE_CONSTRAINT_NOTNULL'
  });
  assert.equal(legacy.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.ok(legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_request_rate_limits'").get());
  legacy.close();
});

test('email-only migration preserves user records, phone data and email challenges', () => {
  const legacy = new Database(':memory:');
  legacy.pragma('foreign_keys = ON');
  const emailOnlyMigrationIndex = migrations.findIndex(
    ({ version }) => version === '021_email_only_verification'
  );
  assert.notEqual(emailOnlyMigrationIndex, -1);
  const migrationsBeforeEmailOnly = migrations.slice(0, emailOnlyMigrationIndex);
  for (const migration of migrationsBeforeEmailOnly) migration.up(legacy);
  legacy.exec(`CREATE TABLE schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const recordMigration = legacy.prepare('INSERT INTO schema_migrations(version) VALUES(?)');
  for (const migration of migrationsBeforeEmailOnly) recordMigration.run(migration.version);

  legacy.prepare(`INSERT INTO users
    (id,display_name,email,password_hash,role,phone_number,date_of_birth,address,email_verified,
      mobile_verified,mobile_verified_at,account_status)
    VALUES (1,'Pending Citizen','pending@example.test','hash','CITIZEN','+919876543210',
      '1990-01-02','12 Main Road',0,1,'2026-11-18T12:00:00.000Z','PENDING_MOBILE_VERIFICATION'),
      (2,'Verified Pending Citizen','verified@example.test','hash','CITIZEN','+919876543211',
      '1980-01-02','14 Main Road',1,1,'2026-11-18T12:00:00.000Z','PENDING_MOBILE_VERIFICATION'),
      (3,'Legacy Citizen','legacy@example.test','hash','CITIZEN','+919876543212',
      '1970-01-02','16 Main Road',0,0,NULL,'ACTIVE'),
      (900,'Sequence Marker','sequence@example.test','hash','CITIZEN','+919876543299',
      NULL,NULL,1,1,'2026-11-18T12:00:00.000Z','ACTIVE')`).run();
  legacy.prepare('DELETE FROM users WHERE id=900').run();
  legacy.prepare(`INSERT INTO complaints(user_id,title,description,latitude,longitude)
    VALUES(1,'Preserved complaint','A sufficiently detailed existing complaint.',1,2)`).run();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  legacy.prepare(`INSERT INTO user_verification_challenges
    (user_id,channel,purpose,destination,code_hash,expires_at,resend_after)
    VALUES (1,'EMAIL','REGISTRATION','pending@example.test','email-hash',?,?),
      (1,'MOBILE','PROFILE_VERIFICATION','+919876543210','mobile-hash',?,?)`)
    .run(expiresAt, expiresAt, expiresAt, expiresAt);

  assert.deepEqual(migrateDatabase(legacy), [
    '021_email_only_verification',
    '022_registration_otp_delivery_state',
    '023_complaint_address',
    '024_support_submission_status',
    '025_support_suggestions_workflow',
    '026_announcement_management',
    '027_officer_management',
    '028_officer_inspections',
    '029_officer_work_progress',
    '030_officer_resolutions',
    '031_officer_notifications',
    '032_officer_action_plans'
  ]);
  assert.deepEqual(legacy.prepare(`SELECT id,display_name,email,phone_number,email_verified,account_status
    FROM users ORDER BY id`).all(), [
    { id: 1, display_name: 'Pending Citizen', email: 'pending@example.test', phone_number: '+919876543210', email_verified: 0, account_status: 'PENDING_EMAIL_VERIFICATION' },
    { id: 2, display_name: 'Verified Pending Citizen', email: 'verified@example.test', phone_number: '+919876543211', email_verified: 1, account_status: 'ACTIVE' },
    { id: 3, display_name: 'Legacy Citizen', email: 'legacy@example.test', phone_number: '+919876543212', email_verified: 0, account_status: 'ACTIVE' }
  ]);
  const userColumns = legacy.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  assert.equal(userColumns.includes('mobile_verified'), false);
  assert.equal(userColumns.includes('mobile_verified_at'), false);
  assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM complaints WHERE user_id=1').get().count, 1);
  assert.ok(legacy.prepare('PRAGMA table_info(complaints)').all()
    .some((column) => column.name === 'address'));
  assert.equal(legacy.prepare('SELECT address FROM complaints WHERE user_id=1').get().address, null);
  assert.deepEqual(legacy.prepare(`SELECT channel,purpose,destination,code_hash
    FROM user_verification_challenges`).all(), [
    { channel: 'EMAIL', purpose: 'REGISTRATION', destination: 'pending@example.test', code_hash: 'email-hash' }
  ]);
  assert.equal(legacy.prepare(`SELECT delivery_status FROM user_verification_challenges
    WHERE user_id=1 AND purpose='REGISTRATION'`).get().delivery_status, 'UNKNOWN');
  assert.equal(legacy.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(legacy.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(legacy.pragma('legacy_alter_table', { simple: true }), 0);
  assert.ok(legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_users_phone_number'").get());
  assert.ok(legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='officer_membership_requires_officer_role'").get());
  assert.ok(legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='assigned_officer_role_cannot_be_changed'").get());
  const nextUser = legacy.prepare(`INSERT INTO users(display_name,email,password_hash,role)
    VALUES('Next Citizen','next@example.test','hash','CITIZEN')`).run();
  assert.ok(Number(nextUser.lastInsertRowid) > 900);
  legacy.close();
});

test('migration 025 resets legacy suggestion statuses and preserves bug report data', () => {
  const db025 = new Database(':memory:');
  db025.pragma('foreign_keys = ON');

  // Apply migrations 001-024 via migrateDatabase (stops before 025 by temporarily removing it)
  // We do this by running fresh migrateDatabase which applies all migrations including 025.
  // Instead, we use a custom approach: apply each migration in the correct order.
  // migrateDatabase handles the requiresForeignKeysDisabled migrations correctly.
  // We seed data AFTER migrations 024 but BEFORE 025 runs.

  // Step 1: Apply migrations 001-024 manually but using the same pragma approach as migrateDatabase
  // We know migration 021 and 025 requiresForeignKeysDisabled.
  // Run ALL required-FK-disabled migrations together (021 is in 1-24 slice).
  const migrationIndex024 = migrations.findIndex(({ version }) => version === '024_support_submission_status');
  const migrations024 = migrations.slice(0, migrationIndex024 + 1);

  // Build schema_migrations table first
  db025.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);

  // Apply with FK and legacy_alter_table handling (mimics migrateDatabase behavior for 1-24)
  const needsFKDisable = migrations024.some((m) => m.requiresForeignKeysDisabled);
  if (needsFKDisable) {
    db025.pragma('foreign_keys = OFF');
    db025.pragma('legacy_alter_table = ON');
  }
  try {
    const applyTx = db025.transaction(() => {
      const isApplied = db025.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
      const recordApplied = db025.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
      for (const migration of migrations024) {
        if (isApplied.get(migration.version)) continue;
        migration.up(db025);
        recordApplied.run(migration.version);
      }
    });
    applyTx.immediate();
  } finally {
    if (needsFKDisable) {
      db025.pragma('legacy_alter_table = OFF');
      db025.pragma('foreign_keys = ON');
    }
  }

  // Step 2: Seed pre-migration data
  db025.prepare(`INSERT INTO users (id, display_name, email, password_hash, role, email_verified, account_status)
    VALUES (1, 'Seed Citizen', 'seed@example.test', 'hash', 'CITIZEN', 1, 'ACTIVE')`).run();

  db025.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description, status, closed_at)
    VALUES ('NM-SUGG-RES', 1, 'SUGGESTION', 'Legacy resolved suggestion', 'USER_EXPERIENCE',
      'Please add dark mode to the app.', 'RESOLVED', '2026-11-20T01:00:00.000Z')`).run();
  db025.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description, status, closed_at)
    VALUES ('NM-SUGG-REJ', 1, 'SUGGESTION', 'Legacy rejected suggestion', 'NEW_FEATURE',
      'Add calendar integration.', 'REJECTED', '2026-11-20T01:00:00.000Z')`).run();
  db025.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description, status, closed_at)
    VALUES ('NM-SUGG-NEW', 1, 'SUGGESTION', 'Legacy new suggestion', 'ACCESSIBILITY',
      'Improve font size settings.', 'NEW', NULL)`).run();
  db025.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description, status, closed_at)
    VALUES ('NM-BUG-RES', 1, 'BUG_REPORT', 'Login fails on android', 'LOGIN_ISSUE',
      'OTP not received on android devices.', 'RESOLVED', '2026-11-20T01:00:00.000Z')`).run();
  db025.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description, status, closed_at)
    VALUES ('NM-BUG-REJ', 1, 'BUG_REPORT', 'Profile image bug', 'PROFILE_ISSUE',
      'Uploading profile image fails with 500.', 'REJECTED', '2026-11-20T01:00:00.000Z')`).run();

  // Step 3: Apply pending migrations 025-031 via migrateDatabase
  const applied = migrateDatabase(db025);
  assert.deepEqual(applied, ['025_support_suggestions_workflow', '026_announcement_management',
    '027_officer_management', '028_officer_inspections', '029_officer_work_progress',
    '030_officer_resolutions', '031_officer_notifications', '032_officer_action_plans']);

  // Assert: Legacy RESOLVED suggestion → status=NEW, closed_at=null, rejection_reason=null
  const resolvedSugg = db025.prepare('SELECT status, closed_at, rejection_reason FROM citizen_support_submissions WHERE reference_id=?').get('NM-SUGG-RES');
  assert.equal(resolvedSugg.status, 'NEW');
  assert.equal(resolvedSugg.closed_at, null);
  assert.equal(resolvedSugg.rejection_reason, null);

  // Assert: Legacy REJECTED suggestion → status=NEW, closed_at=null, rejection_reason=null
  const rejectedSugg = db025.prepare('SELECT status, closed_at, rejection_reason FROM citizen_support_submissions WHERE reference_id=?').get('NM-SUGG-REJ');
  assert.equal(rejectedSugg.status, 'NEW');
  assert.equal(rejectedSugg.closed_at, null);
  assert.equal(rejectedSugg.rejection_reason, null);

  // Assert: Legacy NEW suggestion stays NEW, closed_at stays null
  const newSugg = db025.prepare('SELECT status, closed_at FROM citizen_support_submissions WHERE reference_id=?').get('NM-SUGG-NEW');
  assert.equal(newSugg.status, 'NEW');
  assert.equal(newSugg.closed_at, null);

  // Assert: BUG_REPORT RESOLVED → still RESOLVED with closed_at preserved
  const resolvedBug = db025.prepare('SELECT status, closed_at FROM citizen_support_submissions WHERE reference_id=?').get('NM-BUG-RES');
  assert.equal(resolvedBug.status, 'RESOLVED');
  assert.equal(resolvedBug.closed_at, '2026-11-20T01:00:00.000Z');

  // Assert: BUG_REPORT REJECTED → still REJECTED with closed_at preserved
  const rejectedBug = db025.prepare('SELECT status, closed_at FROM citizen_support_submissions WHERE reference_id=?').get('NM-BUG-REJ');
  assert.equal(rejectedBug.status, 'REJECTED');
  assert.equal(rejectedBug.closed_at, '2026-11-20T01:00:00.000Z');

  // Assert: INSERT SUGGESTION with REJECTED + rejection_reason=null → SQLITE_CONSTRAINT_CHECK
  assert.throws(() => db025.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description, status, rejection_reason)
    VALUES ('NM-SUGG-BAD', 1, 'SUGGESTION', 'Bad suggestion', 'OTHER',
      'No rejection reason provided.', 'REJECTED', NULL)`).run(), (err) => {
    return err.code === 'SQLITE_CONSTRAINT_CHECK';
  });

  // Assert: INSERT BUG_REPORT with UNDER_REVIEW → SQLITE_CONSTRAINT_CHECK
  assert.throws(() => db025.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description, status)
    VALUES ('NM-BUG-BAD', 1, 'BUG_REPORT', 'Bad bug report', 'OTHER',
      'Under review is not valid for bug reports.', 'UNDER_REVIEW')`).run(), (err) => {
    return err.code === 'SQLITE_CONSTRAINT_CHECK';
  });

  // Assert: INSERT SUGGESTION with IN_PROGRESS → SQLITE_CONSTRAINT_CHECK
  assert.throws(() => db025.prepare(`INSERT INTO citizen_support_submissions
    (reference_id, user_id, kind, title, category, description, status)
    VALUES ('NM-SUGG-BAD2', 1, 'SUGGESTION', 'In progress suggestion', 'OTHER',
      'In progress is not valid for suggestions.', 'IN_PROGRESS')`).run(), (err) => {
    return err.code === 'SQLITE_CONSTRAINT_CHECK';
  });

  // Assert: PRAGMA foreign_key_check → 0 violations
  assert.equal(db025.pragma('foreign_key_check').length, 0);

  // Assert: Both indexes exist
  assert.ok(db025.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_citizen_support_user_created'").get());
  assert.ok(db025.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_citizen_support_kind_status_created'").get());

  // Assert: user_id FK REFERENCES users(id) ON DELETE RESTRICT preserved
  assert.throws(() => db025.prepare('DELETE FROM users WHERE id=1').run(), (err) => {
    return err.code === 'SQLITE_CONSTRAINT_TRIGGER' || err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || err.message.includes('FOREIGN KEY');
  });

  db025.close();
});

test('migration 031 preserves citizen notifications and validates Officer assignment notifications', () => {
  const notificationsDb = new Database(':memory:');
  notificationsDb.pragma('foreign_keys = ON');
  notificationsDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      account_status TEXT NOT NULL,
      notification_preferences TEXT NOT NULL DEFAULT '{"inApp":true}'
    );
    CREATE TABLE complaints (id INTEGER PRIMARY KEY);
    CREATE TABLE civic_issues (
      id INTEGER PRIMARY KEY,
      assigned_team_id INTEGER,
      status TEXT NOT NULL,
      merged_into_issue_id INTEGER
    );
    CREATE TABLE wards (id INTEGER PRIMARY KEY, is_active INTEGER NOT NULL);
    CREATE TABLE ward_teams (id INTEGER PRIMARY KEY, ward_id INTEGER NOT NULL, is_active INTEGER NOT NULL);
    CREATE TABLE ward_team_memberships (
      team_id INTEGER NOT NULL, officer_user_id INTEGER NOT NULL, removed_at TEXT
    );
    CREATE TABLE civic_issue_team_assignment_events (
      id INTEGER PRIMARY KEY, civic_issue_id INTEGER NOT NULL, team_id INTEGER,
      event_type TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
      message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 2000),
      notification_type TEXT NOT NULL CHECK (notification_type IN ('ISSUE_RESOLVED','DISPUTE_REVIEWED')),
      related_complaint_id INTEGER REFERENCES complaints(id) ON DELETE CASCADE,
      event_key TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(user_id,event_key)
    );
    CREATE INDEX idx_notifications_user_created ON notifications(user_id,created_at DESC,id DESC);
    CREATE INDEX idx_notifications_unread ON notifications(user_id,is_read,created_at DESC,id DESC);
    INSERT INTO users(id,role,account_status) VALUES(1,'CITIZEN','ACTIVE'),(2,'OFFICER','ACTIVE');
    INSERT INTO complaints(id) VALUES(10);
    INSERT INTO civic_issues(id,assigned_team_id,status) VALUES(20,5,'OPEN');
    INSERT INTO wards(id,is_active) VALUES(1,1);
    INSERT INTO ward_teams(id,ward_id,is_active) VALUES(5,1,1);
    INSERT INTO ward_team_memberships(team_id,officer_user_id) VALUES(5,2);
    INSERT INTO civic_issue_team_assignment_events(id,civic_issue_id,team_id,event_type,created_at)
      VALUES(30,20,5,'ASSIGNED','2026-01-01T00:00:00.000Z');
    INSERT INTO notifications(id,user_id,title,message,notification_type,related_complaint_id,event_key,is_read,created_at)
      VALUES(7,1,'Resolved','Your report was resolved.','ISSUE_RESOLVED',10,'legacy-event',1,'2026-01-02T00:00:00.000Z');
  `);

  officerNotificationsMigration.up(notificationsDb);
  assert.deepEqual(notificationsDb.prepare(`SELECT id,user_id,title,message,notification_type,
      related_complaint_id,related_civic_issue_id,event_key,is_read,created_at
    FROM notifications`).get(), {
    id: 7, user_id: 1, title: 'Resolved', message: 'Your report was resolved.',
    notification_type: 'ISSUE_RESOLVED', related_complaint_id: 10,
    related_civic_issue_id: null, event_key: 'legacy-event', is_read: 1,
    created_at: '2026-01-02T00:00:00.000Z'
  });
  notificationsDb.prepare(`INSERT INTO notifications
    (user_id,title,message,notification_type,related_civic_issue_id,event_key)
    VALUES(2,'Assigned','Review issue 20.','ISSUE_ASSIGNED',20,'issue:20:assignment:30')`).run();
  assert.throws(() => notificationsDb.prepare(`INSERT INTO notifications
    (user_id,title,message,notification_type,related_civic_issue_id,event_key)
    VALUES(1,'Invalid','Not an Officer','ISSUE_ASSIGNED',20,'invalid-event')`).run(),
  /current active team member/);
  assert.equal(notificationsDb.pragma('foreign_key_check').length, 0);
  notificationsDb.close();
});

test('the shared startup database can be initialized repeatedly without reapplying migrations', () => {
  assert.deepEqual(migrateDatabase(defaultDb), ['001_core_schema', '002_civic_issues', '003_issue_assignments', '004_issue_grouping', '005_ward_team_management', '006_issue_team_assignments', '007_officer_workflow_evidence', '008_citizen_resolution_verification', '009_announcements', '010_announcement_visibility', '011_notifications', '012_profile_images', '013_citizen_preferences', '014_profile_support_password_reset', '015_citizen_verification', '016_account_lifecycle', '017_auth_phone_and_verification', '018_verification_challenge_destination', '019_auth_otp_purposes_and_rate_limits', '020_required_verification_destination', '021_email_only_verification', '022_registration_otp_delivery_state', '023_complaint_address', '024_support_submission_status', '025_support_suggestions_workflow', '026_announcement_management', '027_officer_management', '028_officer_inspections', '029_officer_work_progress', '030_officer_resolutions', '031_officer_notifications', '032_officer_action_plans']);
  assert.deepEqual(migrateDatabase(defaultDb), []);
  assert.equal(defaultDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 32);
});
