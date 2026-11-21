import { db } from '../../config/database.js';
import { departments } from '../intelligence/intelligence.taxonomy.js';
import { notifyAssignedTeam } from '../notifications/notification.service.js';

export class TeamAssignmentError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

const findAdmin = db.prepare("SELECT id FROM users WHERE id=? AND role='ADMIN'");
const findIssue = db.prepare(`SELECT id,status,merged_into_issue_id,assigned_officer_id,assigned_team_id,routing_department
  FROM civic_issues WHERE id=?`);
const findTeam = db.prepare(`SELECT t.id,t.name,t.department,t.is_active,w.id AS ward_id,w.code AS ward_code,w.name AS ward_name,w.is_active AS ward_is_active,
  (SELECT COUNT(*) FROM ward_team_memberships m JOIN users u ON u.id=m.officer_user_id
    WHERE m.team_id=t.id AND m.removed_at IS NULL
      AND u.role='OFFICER' AND u.account_status='ACTIVE') AS active_member_count
  FROM ward_teams t JOIN wards w ON w.id=t.ward_id WHERE t.id=?`);

function requireAdmin(adminId) {
  if (!findAdmin.get(adminId)) throw new TeamAssignmentError('Admin authorization is required', 403);
}
function requireRoutableIssue(issue) {
  if (!issue) throw new TeamAssignmentError('Civic issue not found', 404);
  if (issue.status === 'MERGED' || issue.merged_into_issue_id !== null) {
    throw new TeamAssignmentError('Merged civic issues cannot be routed', 409);
  }
}
function requireTeam(teamId, routingDepartment) {
  if (!departments.includes(routingDepartment)) throw new TeamAssignmentError('Invalid routing department', 400);
  const team = findTeam.get(teamId);
  if (!team) throw new TeamAssignmentError('Ward team not found', 404);
  if (!team.is_active || !team.ward_is_active) throw new TeamAssignmentError('Selected team and ward must be active', 409);
  if (team.department !== routingDepartment) throw new TeamAssignmentError('Team department must match the approved routing department', 409);
  if (team.active_member_count < 1) throw new TeamAssignmentError('Selected team must have at least one active OFFICER member', 409);
  return team;
}
function assignmentResult({ eventId, issueId, eventType, previousTeam, team, routingDepartment, adminId }) {
  return {
    id: eventId, civicIssueId: issueId, eventType, approvedDepartment: routingDepartment,
    previousTeam: previousTeam ? { id: previousTeam.id, name: previousTeam.name } : null,
    team: team ? { id: team.id, name: team.name, department: team.department,
      ward: { id: team.ward_id, code: team.ward_code, name: team.ward_name } } : null,
    assignedByAdminId: adminId
  };
}

const assignTx = db.transaction((issueId, teamId, routingDepartment, adminId) => {
  requireAdmin(adminId);
  const issue = findIssue.get(issueId);
  requireRoutableIssue(issue);
  if (issue.assigned_team_id !== null) throw new TeamAssignmentError('Civic issue already has an assigned ward team', 409);
  if (issue.assigned_officer_id !== null) throw new TeamAssignmentError('Unassign the existing individual officer before routing this issue to a team', 409);
  const team = requireTeam(teamId, routingDepartment);
  const update = db.prepare(`UPDATE civic_issues SET assigned_team_id=?,routing_department=?,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND assigned_team_id IS NULL AND assigned_officer_id IS NULL AND status<>'MERGED' AND merged_into_issue_id IS NULL`)
    .run(team.id, routingDepartment, issueId);
  if (update.changes !== 1) throw new TeamAssignmentError('Civic issue routing changed; retry the request', 409);
  const event = db.prepare(`INSERT INTO civic_issue_team_assignment_events
    (civic_issue_id,event_type,previous_team_id,team_id,approved_department,admin_user_id)
    VALUES(?,'ASSIGNED',NULL,?,?,?)`).run(issueId, team.id, routingDepartment, adminId);
  notifyAssignedTeam(issueId, Number(event.lastInsertRowid));
  return assignmentResult({ eventId: Number(event.lastInsertRowid), issueId, eventType: 'ASSIGNED', team, routingDepartment, adminId });
});
export const assignIssueToTeam = (issueId, teamId, department, adminId) => assignTx.immediate(issueId, teamId, department, adminId);

const reassignTx = db.transaction((issueId, teamId, routingDepartment, adminId) => {
  requireAdmin(adminId);
  const issue = findIssue.get(issueId);
  requireRoutableIssue(issue);
  if (issue.assigned_officer_id !== null) throw new TeamAssignmentError('Clear the legacy individual assignment before team reassignment', 409);
  if (issue.status === 'IN_PROGRESS') throw new TeamAssignmentError('Team assignment cannot change while work is in progress', 409);
  if (issue.assigned_team_id === null) throw new TeamAssignmentError('Civic issue has no assigned ward team', 409);
  if (issue.assigned_team_id === teamId) throw new TeamAssignmentError('Civic issue is already assigned to that team', 409);
  const team = requireTeam(teamId, routingDepartment);
  const previousTeam = findTeam.get(issue.assigned_team_id);
  if (!previousTeam) throw new TeamAssignmentError('Previously assigned team not found', 409);
  const update = db.prepare(`UPDATE civic_issues SET assigned_team_id=?,routing_department=?,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND assigned_team_id=? AND status<>'MERGED' AND merged_into_issue_id IS NULL`)
    .run(team.id, routingDepartment, issueId, previousTeam.id);
  if (update.changes !== 1) throw new TeamAssignmentError('Civic issue routing changed; retry the request', 409);
  const event = db.prepare(`INSERT INTO civic_issue_team_assignment_events
    (civic_issue_id,event_type,previous_team_id,team_id,approved_department,admin_user_id)
    VALUES(?,'REASSIGNED',?,?,?,?)`).run(issueId, previousTeam.id, team.id, routingDepartment, adminId);
  notifyAssignedTeam(issueId, Number(event.lastInsertRowid));
  return assignmentResult({ eventId: Number(event.lastInsertRowid), issueId, eventType: 'REASSIGNED', previousTeam, team, routingDepartment, adminId });
});
export const reassignIssueTeam = (issueId, teamId, department, adminId) => reassignTx.immediate(issueId, teamId, department, adminId);

const unassignTx = db.transaction((issueId, adminId) => {
  requireAdmin(adminId);
  const issue = findIssue.get(issueId);
  requireRoutableIssue(issue);
  if (issue.assigned_team_id === null) throw new TeamAssignmentError('Civic issue has no assigned ward team', 409);
  if (issue.status === 'IN_PROGRESS') throw new TeamAssignmentError('Team assignment cannot change while work is in progress', 409);
  const previousTeam = findTeam.get(issue.assigned_team_id);
  if (!previousTeam) throw new TeamAssignmentError('Previously assigned team not found', 409);
  const approvedDepartment = issue.routing_department;
  const update = db.prepare(`UPDATE civic_issues SET assigned_team_id=NULL,routing_department=NULL,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND assigned_team_id=?`)
    .run(issueId, previousTeam.id);
  if (update.changes !== 1) throw new TeamAssignmentError('Civic issue routing changed; retry the request', 409);
  const event = db.prepare(`INSERT INTO civic_issue_team_assignment_events
    (civic_issue_id,event_type,previous_team_id,team_id,approved_department,admin_user_id)
    VALUES(?,'UNASSIGNED',?,NULL,?,?)`).run(issueId, previousTeam.id, approvedDepartment, adminId);
  return assignmentResult({ eventId: Number(event.lastInsertRowid), issueId, eventType: 'UNASSIGNED', previousTeam, team: null, routingDepartment: approvedDepartment, adminId });
});
export const unassignIssueTeam = (issueId, adminId) => unassignTx.immediate(issueId, adminId);
