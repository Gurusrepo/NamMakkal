import { createHash } from 'node:crypto';
import { db } from '../../config/database.js';

const mapNotification = (row) => ({
  id: row.id,
  title: row.title,
  message: row.message,
  notificationType: row.notification_type,
  relatedComplaintId: row.related_complaint_id,
  relatedCivicIssueId: row.related_civic_issue_id,
  relatedSupportReference: row.related_support_reference,
  isRead: Boolean(row.is_read),
  createdAt: row.created_at
});

function issueReporters(issueId) {
  return db.prepare(`SELECT c.user_id,MIN(c.id) AS complaint_id
    FROM complaints c JOIN users u ON u.id=c.user_id AND u.role='CITIZEN'
    WHERE c.civic_issue_id=? GROUP BY c.user_id`).all(issueId);
}

function issueDisputers(issueId) {
  return db.prepare(`SELECT c.user_id,MIN(c.id) AS complaint_id
    FROM civic_issue_resolution_verifications v
    JOIN complaints c ON c.id=v.complaint_id
    JOIN users u ON u.id=c.user_id AND u.role='CITIZEN'
    WHERE v.civic_issue_id=? AND v.decision='DISPUTE'
    GROUP BY c.user_id`).all(issueId);
}

function assignedTeamOfficers(issueId, assignmentEventId) {
  return db.prepare(`SELECT u.id AS user_id,i.id AS civic_issue_id
    FROM civic_issues i
    JOIN civic_issue_team_assignment_events a ON a.id=? AND a.civic_issue_id=i.id
      AND a.team_id=i.assigned_team_id AND a.event_type IN ('ASSIGNED','REASSIGNED')
    JOIN ward_teams t ON t.id=i.assigned_team_id AND t.is_active=1
    JOIN wards w ON w.id=t.ward_id AND w.is_active=1
    JOIN ward_team_memberships m ON m.team_id=t.id AND m.removed_at IS NULL
    JOIN users u ON u.id=m.officer_user_id AND u.role='OFFICER' AND u.account_status='ACTIVE'
    WHERE i.id=? AND i.status<>'MERGED' AND i.merged_into_issue_id IS NULL`)
    .all(assignmentEventId, issueId);
}

function createForRecipients(recipients, { eventKey, notificationType, title, message }) {
  const insert = db.prepare(`INSERT INTO notifications
    (user_id,title,message,notification_type,related_complaint_id,related_civic_issue_id,event_key)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,event_key) DO NOTHING`);
  const getPreference = db.prepare('SELECT notification_preferences FROM users WHERE id=?');
  let created = 0;
  for (const recipient of recipients) {
    const preferences = JSON.parse(getPreference.get(recipient.user_id)?.notification_preferences ?? '{"inApp":true}');
    if (preferences.inApp === false) continue;
    created += insert.run(recipient.user_id, title, message, notificationType,
      recipient.complaint_id ?? null, recipient.civic_issue_id ?? null, eventKey).changes;
  }
  return created;
}

export function createSupportUpdateNotification({
  userId,
  kind,
  referenceId,
  status,
  adminNotes,
  rejectionReason
}) {
  if (!adminNotes) return 0;
  const note = adminNotes.trim();
  if (!note) return 0;

  const digest = createHash('sha256')
    .update(JSON.stringify({ kind, referenceId, status, note, rejectionReason: rejectionReason ?? null }))
    .digest('hex');
  const insert = db.prepare(`INSERT INTO notifications
    (user_id,title,message,notification_type,related_support_reference,event_key)
    VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,event_key) DO NOTHING`);
  const subject = kind === 'SUGGESTION' ? 'suggestion' : 'reported problem';
  const title = `Update for ${subject} ${referenceId}`;
  const statusText = status.replaceAll('_', ' ').toLowerCase();
  const message = `Status: ${statusText}\n\nAdmin note:\n${note}`;
  return insert.run(userId, title, message, 'SUPPORT_UPDATE', referenceId,
    `support:${kind}:${referenceId}:${digest}`).changes;
}

export function notifyIssueReporters(issueId, notification) {
  return createForRecipients(issueReporters(issueId), notification);
}

export function notifyDisputingReporters(issueId, notification) {
  return createForRecipients(issueDisputers(issueId), notification);
}

export function notifyAssignedTeam(issueId, assignmentEventId) {
  return createForRecipients(assignedTeamOfficers(issueId, assignmentEventId), {
    eventKey: `issue:${issueId}:assignment:${assignmentEventId}`,
    notificationType: 'ISSUE_ASSIGNED',
    title: 'A civic issue has been assigned to your team',
    message: `Civic issue #${issueId} is now assigned to your team. Review the complaint details and location.`
  });
}

export function listNotifications(userId, { limit, offset, unreadOnly }) {
  const where = unreadOnly ? 'user_id=? AND is_read=0' : 'user_id=?';
  const rows = db.prepare(`SELECT id,title,message,notification_type,related_complaint_id,
      related_civic_issue_id,related_support_reference,is_read,created_at
    FROM notifications WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
    .all(userId, limit + 1, offset);
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map(mapNotification),
    pagination: { limit, offset, hasMore }
  };
}

export function getUnreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND is_read=0')
    .get(userId).count;
}

export function markNotificationRead(userId, notificationId) {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?')
    .run(notificationId, userId);
  const row = db.prepare(`SELECT id,title,message,notification_type,related_complaint_id,
      related_civic_issue_id,related_support_reference,is_read,created_at
    FROM notifications WHERE id=? AND user_id=?`).get(notificationId, userId);
  return row ? mapNotification(row) : null;
}

export function markAllNotificationsRead(userId) {
  return db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0')
    .run(userId).changes;
}
