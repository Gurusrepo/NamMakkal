export const version = '028_officer_inspections';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS civic_issue_inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      civic_issue_id INTEGER NOT NULL REFERENCES civic_issues(id) ON DELETE RESTRICT,
      team_id INTEGER NOT NULL REFERENCES ward_teams(id) ON DELETE RESTRICT,
      assignment_event_id INTEGER NOT NULL REFERENCES civic_issue_team_assignment_events(id) ON DELETE RESTRICT,
      officer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      findings TEXT NOT NULL CHECK (length(trim(findings)) BETWEEN 1 AND 4000),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_civic_issue_inspections_issue
      ON civic_issue_inspections(civic_issue_id,created_at,id);
    CREATE INDEX IF NOT EXISTS idx_civic_issue_inspections_assignment
      ON civic_issue_inspections(assignment_event_id,created_at,id);

    CREATE TRIGGER IF NOT EXISTS civic_issue_inspections_require_current_assignment
      BEFORE INSERT ON civic_issue_inspections
      WHEN NOT EXISTS (
        SELECT 1 FROM civic_issues i
        JOIN civic_issue_team_assignment_events a ON a.id=NEW.assignment_event_id
        JOIN ward_teams t ON t.id=NEW.team_id AND t.is_active=1
        JOIN wards w ON w.id=t.ward_id AND w.is_active=1
        JOIN ward_team_memberships m ON m.team_id=t.id
          AND m.officer_user_id=NEW.officer_user_id AND m.removed_at IS NULL
        JOIN users u ON u.id=NEW.officer_user_id
          AND u.role='OFFICER' AND u.account_status='ACTIVE'
        WHERE i.id=NEW.civic_issue_id AND i.assigned_team_id=NEW.team_id
          AND i.status IN ('OPEN','IN_PROGRESS') AND i.merged_into_issue_id IS NULL
          AND a.civic_issue_id=i.id AND a.team_id=t.id
          AND a.event_type IN ('ASSIGNED','REASSIGNED')
          AND a.id=(SELECT latest.id FROM civic_issue_team_assignment_events latest
            WHERE latest.civic_issue_id=i.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
      )
      BEGIN SELECT RAISE(ABORT,'inspection requires an authorized current team assignment'); END;
    CREATE TRIGGER IF NOT EXISTS civic_issue_inspections_no_update
      BEFORE UPDATE ON civic_issue_inspections
      BEGIN SELECT RAISE(ABORT,'inspection records are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS civic_issue_inspections_no_delete
      BEFORE DELETE ON civic_issue_inspections
      BEGIN SELECT RAISE(ABORT,'inspection records are append-only'); END;
  `);
}
