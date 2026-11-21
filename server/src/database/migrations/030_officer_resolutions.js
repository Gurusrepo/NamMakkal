export const version = '030_officer_resolutions';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS civic_issue_resolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      civic_issue_id INTEGER NOT NULL REFERENCES civic_issues(id) ON DELETE RESTRICT,
      team_id INTEGER NOT NULL REFERENCES ward_teams(id) ON DELETE RESTRICT,
      assignment_event_id INTEGER NOT NULL REFERENCES civic_issue_team_assignment_events(id) ON DELETE RESTRICT,
      officer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      completion_event_id INTEGER NOT NULL UNIQUE REFERENCES civic_issue_work_events(id) ON DELETE RESTRICT,
      before_evidence_id INTEGER NOT NULL UNIQUE REFERENCES civic_issue_repair_evidence(id) ON DELETE RESTRICT,
      after_evidence_id INTEGER NOT NULL UNIQUE REFERENCES civic_issue_repair_evidence(id) ON DELETE RESTRICT,
      summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 2000),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(civic_issue_id,assignment_event_id),
      CHECK (before_evidence_id<>after_evidence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_civic_issue_resolutions_issue
      ON civic_issue_resolutions(civic_issue_id,created_at,id);

    CREATE TRIGGER IF NOT EXISTS civic_issue_resolutions_require_valid_completion
      BEFORE INSERT ON civic_issue_resolutions
      WHEN NOT EXISTS (
        SELECT 1 FROM civic_issues i
        JOIN civic_issue_team_assignment_events a ON a.id=NEW.assignment_event_id
        JOIN civic_issue_work_events completed ON completed.id=NEW.completion_event_id
        JOIN civic_issue_repair_evidence before_photo ON before_photo.id=NEW.before_evidence_id
        JOIN civic_issue_repair_evidence after_photo ON after_photo.id=NEW.after_evidence_id
        JOIN ward_teams t ON t.id=NEW.team_id AND t.is_active=1
        JOIN wards w ON w.id=t.ward_id AND w.is_active=1
        JOIN ward_team_memberships m ON m.team_id=t.id
          AND m.officer_user_id=NEW.officer_user_id AND m.removed_at IS NULL
        JOIN users u ON u.id=NEW.officer_user_id
          AND u.role='OFFICER' AND u.account_status='ACTIVE'
        WHERE i.id=NEW.civic_issue_id AND i.status='RESOLVED'
          AND i.assigned_team_id=NEW.team_id AND i.merged_into_issue_id IS NULL
          AND a.civic_issue_id=i.id AND a.team_id=t.id
          AND a.event_type IN ('ASSIGNED','REASSIGNED')
          AND a.id=(SELECT latest.id FROM civic_issue_team_assignment_events latest
            WHERE latest.civic_issue_id=i.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
          AND completed.civic_issue_id=i.id AND completed.event_type='COMPLETED'
          AND completed.team_id=t.id AND completed.assignment_event_id=a.id
          AND completed.officer_user_id=NEW.officer_user_id
          AND completed.status_before='IN_PROGRESS' AND completed.status_after='RESOLVED'
          AND before_photo.civic_issue_id=i.id AND before_photo.team_id=t.id
          AND before_photo.assignment_event_id=a.id AND before_photo.stage='BEFORE'
          AND after_photo.civic_issue_id=i.id AND after_photo.team_id=t.id
          AND after_photo.assignment_event_id=a.id AND after_photo.stage='AFTER'
      )
      BEGIN SELECT RAISE(ABORT,'resolution requires a valid completion and current assignment evidence'); END;
    CREATE TRIGGER IF NOT EXISTS civic_issue_resolutions_no_update
      BEFORE UPDATE ON civic_issue_resolutions
      BEGIN SELECT RAISE(ABORT,'resolution submissions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS civic_issue_resolutions_no_delete
      BEFORE DELETE ON civic_issue_resolutions
      BEGIN SELECT RAISE(ABORT,'resolution submissions are append-only'); END;
  `);
}
