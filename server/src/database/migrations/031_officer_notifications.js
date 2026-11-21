export const version = '031_officer_notifications';

export function up(db) {
  db.exec(`
    ALTER TABLE notifications RENAME TO notifications_before_officer_support;

    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
      message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 2000),
      notification_type TEXT NOT NULL CHECK (notification_type IN (
        'ISSUE_RESOLVED','DISPUTE_REVIEWED','ISSUE_ASSIGNED'
      )),
      related_complaint_id INTEGER REFERENCES complaints(id) ON DELETE CASCADE,
      related_civic_issue_id INTEGER REFERENCES civic_issues(id) ON DELETE CASCADE,
      event_key TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (user_id,event_key),
      CHECK (
        (notification_type='ISSUE_ASSIGNED' AND related_civic_issue_id IS NOT NULL
          AND related_complaint_id IS NULL) OR
        (notification_type IN ('ISSUE_RESOLVED','DISPUTE_REVIEWED')
          AND related_civic_issue_id IS NULL)
      )
    );

    INSERT INTO notifications
      (id,user_id,title,message,notification_type,related_complaint_id,event_key,is_read,created_at)
    SELECT id,user_id,title,message,notification_type,related_complaint_id,event_key,is_read,created_at
      FROM notifications_before_officer_support;
    DROP TABLE notifications_before_officer_support;

    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread
      ON notifications(user_id,is_read,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_civic_issue
      ON notifications(related_civic_issue_id,created_at DESC,id DESC)
      WHERE related_civic_issue_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS officer_assignment_notification_valid
      BEFORE INSERT ON notifications
      WHEN NEW.notification_type='ISSUE_ASSIGNED' AND NOT EXISTS (
        SELECT 1 FROM civic_issues i
        JOIN ward_teams t ON t.id=i.assigned_team_id AND t.is_active=1
        JOIN wards w ON w.id=t.ward_id AND w.is_active=1
        JOIN ward_team_memberships m ON m.team_id=t.id AND m.officer_user_id=NEW.user_id
          AND m.removed_at IS NULL
        JOIN users u ON u.id=NEW.user_id AND u.role='OFFICER' AND u.account_status='ACTIVE'
        WHERE i.id=NEW.related_civic_issue_id AND i.status<>'MERGED'
          AND i.merged_into_issue_id IS NULL
          AND EXISTS (
            SELECT 1 FROM civic_issue_team_assignment_events a
            WHERE a.civic_issue_id=i.id AND a.team_id=i.assigned_team_id
              AND a.event_type IN ('ASSIGNED','REASSIGNED')
              AND NEW.event_key='issue:'||i.id||':assignment:'||a.id
              AND a.id=(SELECT latest.id FROM civic_issue_team_assignment_events latest
                WHERE latest.civic_issue_id=i.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
          )
      )
      BEGIN SELECT RAISE(ABORT,'assignment notification requires a current active team member'); END;
  `);
}
