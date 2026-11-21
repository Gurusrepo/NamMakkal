import { db as defaultDatabase } from '../config/database.js';
import * as coreSchema from './migrations/001_core_schema.js';
import * as civicIssues from './migrations/002_civic_issues.js';
import * as issueAssignments from './migrations/003_issue_assignments.js';
import * as issueGrouping from './migrations/004_issue_grouping.js';
import * as wardTeamManagement from './migrations/005_ward_team_management.js';
import * as issueTeamAssignments from './migrations/006_issue_team_assignments.js';
import * as officerWorkflowEvidence from './migrations/007_officer_workflow_evidence.js';
import * as citizenResolutionVerification from './migrations/008_citizen_resolution_verification.js';
import * as announcements from './migrations/009_announcements.js';
import * as announcementVisibility from './migrations/010_announcement_visibility.js';
import * as notifications from './migrations/011_notifications.js';
import * as profileImages from './migrations/012_profile_images.js';
import * as citizenPreferences from './migrations/013_citizen_preferences.js';
import * as profileSupportPasswordReset from './migrations/014_profile_support_password_reset.js';
import * as citizenVerification from './migrations/015_citizen_verification.js';
import * as accountLifecycle from './migrations/016_account_lifecycle.js';
import * as authPhoneAndVerification from './migrations/017_auth_phone_and_verification.js';
import * as verificationChallengeDestination from './migrations/018_verification_challenge_destination.js';
import * as authOtpPurposesAndRateLimits from './migrations/019_auth_otp_purposes_and_rate_limits.js';
import * as requiredVerificationDestination from './migrations/020_required_verification_destination.js';
import * as emailOnlyVerification from './migrations/021_email_only_verification.js';
import * as registrationOtpDeliveryState from './migrations/022_registration_otp_delivery_state.js';
import * as complaintAddress from './migrations/023_complaint_address.js';
import * as supportSubmissionStatus from './migrations/024_support_submission_status.js';
import * as supportSuggestionsWorkflow from './migrations/025_support_suggestions_workflow.js';
import * as announcementManagement from './migrations/026_announcement_management.js';
import * as officerManagement from './migrations/027_officer_management.js';
import * as officerInspections from './migrations/028_officer_inspections.js';
import * as officerWorkProgress from './migrations/029_officer_work_progress.js';
import * as officerResolutions from './migrations/030_officer_resolutions.js';
import * as officerNotifications from './migrations/031_officer_notifications.js';
import * as officerActionPlans from './migrations/032_officer_action_plans.js';

export const migrations = [
  coreSchema,
  civicIssues,
  issueAssignments,
  issueGrouping,
  wardTeamManagement,
  issueTeamAssignments,
  officerWorkflowEvidence,
  citizenResolutionVerification,
  announcements,
  announcementVisibility,
  notifications,
  profileImages,
  citizenPreferences,
  profileSupportPasswordReset,
  citizenVerification,
  accountLifecycle,
  authPhoneAndVerification,
  verificationChallengeDestination,
  authOtpPurposesAndRateLimits,
  requiredVerificationDestination,
  emailOnlyVerification,
  registrationOtpDeliveryState,
  complaintAddress,
  supportSubmissionStatus,
  supportSuggestionsWorkflow,
  announcementManagement,
  officerManagement,
  officerInspections,
  officerWorkProgress,
  officerResolutions,
  officerNotifications,
  officerActionPlans
];

export function migrateDatabase(database = defaultDatabase) {
  const schemaMigrationsExists = Boolean(database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='schema_migrations'`).get());
  const isApplied = schemaMigrationsExists
    ? database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    : null;
  const requiresForeignKeysDisabled = migrations.some((migration) =>
    migration.requiresForeignKeysDisabled && !isApplied?.get(migration.version));
  if (requiresForeignKeysDisabled && database.inTransaction) {
    throw new Error('The email-only verification migration must run outside an existing transaction');
  }

  const applyPendingMigrations = database.transaction(() => {
    database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    const isApplied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    const recordApplied = database.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
    const applied = [];

    for (const migration of migrations) {
      if (isApplied.get(migration.version)) continue;
      migration.up(database);
      recordApplied.run(migration.version);
      applied.push(migration.version);
    }
    if (requiresForeignKeysDisabled && database.pragma('foreign_key_check').length > 0) {
      throw new Error('Migration produced foreign key violations');
    }
    return applied;
  });

  if (requiresForeignKeysDisabled) {
    database.pragma('foreign_keys = OFF');
    database.pragma('legacy_alter_table = ON');
  }
  try {
    return applyPendingMigrations.immediate();
  } finally {
    if (requiresForeignKeysDisabled) {
      database.pragma('legacy_alter_table = OFF');
      database.pragma('foreign_keys = ON');
    }
  }
}
