import { db } from '../../config/database.js';
import * as objectStorage from '../../services/objectStorage.js';

export class AdminIssueError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const selectIssueBase = db.prepare(`
  SELECT i.id, i.status, i.merged_into_issue_id, i.assigned_officer_id, i.assigned_team_id, i.routing_department,
         i.created_at, i.updated_at,
         officer.display_name AS officer_name,
         team.name AS team_name, team.department AS team_department, team.ward_id,
         ward.code AS ward_code, ward.name AS ward_name,
         (SELECT e.created_at FROM civic_issue_assignment_events e
          WHERE e.civic_issue_id = i.id AND e.officer_id = i.assigned_officer_id
            AND e.event_type IN ('ASSIGNED', 'REASSIGNED')
          ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS assigned_at,
         (SELECT e.created_at FROM civic_issue_team_assignment_events e
          WHERE e.civic_issue_id = i.id AND e.team_id = i.assigned_team_id
            AND e.event_type IN ('ASSIGNED','REASSIGNED')
          ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS team_assigned_at,
         (SELECT COUNT(*) FROM complaints c WHERE c.civic_issue_id = i.id) AS report_count
  FROM civic_issues i
  LEFT JOIN users officer ON officer.id = i.assigned_officer_id
  LEFT JOIN ward_teams team ON team.id = i.assigned_team_id
  LEFT JOIN wards ward ON ward.id = team.ward_id
  WHERE i.id = ?
`);

const countByCategory = db.prepare(`
  WITH latest_success AS (
    SELECT a.* FROM complaint_ai_assessments a
    WHERE a.status = 'SUCCEEDED' AND a.id = (
      SELECT candidate.id FROM complaint_ai_assessments candidate
      WHERE candidate.complaint_id = a.complaint_id AND candidate.status = 'SUCCEEDED'
      ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
    )
  )
  SELECT a.category AS value, COUNT(*) AS count
  FROM complaints c JOIN latest_success a ON a.complaint_id = c.id
  WHERE c.civic_issue_id = ? AND a.category IS NOT NULL
  GROUP BY a.category ORDER BY count DESC, value
`);
const countAssessedReports = db.prepare(`
  WITH latest_success AS (
    SELECT a.* FROM complaint_ai_assessments a
    WHERE a.status = 'SUCCEEDED' AND a.id = (
      SELECT candidate.id FROM complaint_ai_assessments candidate
      WHERE candidate.complaint_id = a.complaint_id AND candidate.status = 'SUCCEEDED'
      ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
    )
  )
  SELECT COUNT(*) AS count
  FROM complaints c JOIN latest_success a ON a.complaint_id = c.id
  WHERE c.civic_issue_id = ?
`);
const countByDepartment = db.prepare(`
  WITH latest_success AS (
    SELECT a.* FROM complaint_ai_assessments a
    WHERE a.status = 'SUCCEEDED' AND a.id = (
      SELECT candidate.id FROM complaint_ai_assessments candidate
      WHERE candidate.complaint_id = a.complaint_id AND candidate.status = 'SUCCEEDED'
      ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
    )
  )
  SELECT a.department AS value, COUNT(*) AS count
  FROM complaints c JOIN latest_success a ON a.complaint_id = c.id
  WHERE c.civic_issue_id = ? AND a.department IS NOT NULL
  GROUP BY a.department ORDER BY count DESC, value
`);
const countBySeverity = db.prepare(`
  WITH latest_success AS (
    SELECT a.* FROM complaint_ai_assessments a
    WHERE a.status = 'SUCCEEDED' AND a.id = (
      SELECT candidate.id FROM complaint_ai_assessments candidate
      WHERE candidate.complaint_id = a.complaint_id AND candidate.status = 'SUCCEEDED'
      ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
    )
  )
  SELECT a.severity AS value, COUNT(*) AS count
  FROM complaints c JOIN latest_success a ON a.complaint_id = c.id
  WHERE c.civic_issue_id = ? AND a.severity IS NOT NULL
  GROUP BY a.severity ORDER BY count DESC, value
`);
const latestSuccessfulAssessment = db.prepare(`
  SELECT a.complaint_id, a.category, a.department, a.severity, a.confidence,
         a.human_review_required, a.created_at
  FROM complaints c JOIN complaint_ai_assessments a ON a.complaint_id = c.id
  WHERE c.civic_issue_id = ? AND a.status = 'SUCCEEDED'
  ORDER BY a.created_at DESC, a.id DESC LIMIT 1
`);
const countReviewed = db.prepare(`
  WITH latest_success AS (
    SELECT a.* FROM complaint_ai_assessments a
    WHERE a.status = 'SUCCEEDED' AND a.id = (
      SELECT candidate.id FROM complaint_ai_assessments candidate
      WHERE candidate.complaint_id = a.complaint_id AND candidate.status = 'SUCCEEDED'
      ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
    )
  )
  SELECT COUNT(*) AS count
  FROM complaints c JOIN latest_success a ON a.complaint_id = c.id
  WHERE c.civic_issue_id = ? AND a.human_review_required = 1
`);

function mapAssessmentSummary(issueId) {
  const latest = latestSuccessfulAssessment.get(issueId);
  if (!latest) return null;
  return {
    assessedReportCount: countAssessedReports.get(issueId).count,
    categoryCounts: countByCategory.all(issueId).map(({ value, count }) => ({ category: value, count })),
    departmentCounts: countByDepartment.all(issueId).map(({ value, count }) => ({ department: value, count })),
    severityCounts: countBySeverity.all(issueId).map(({ value, count }) => ({ severity: value, count })),
    humanReviewRequiredCount: countReviewed.get(issueId).count,
    latestSuccessfulComplaintAssessment: {
      complaintId: latest.complaint_id,
      category: latest.category,
      department: latest.department,
      severity: latest.severity,
      confidence: latest.confidence,
      humanReviewRequired: Boolean(latest.human_review_required),
      assessedAt: latest.created_at
    }
  };
}

function mapIssue(row) {
  return {
    id: row.id,
    status: row.status,
    canonicalIssueId: row.status === 'MERGED'
      ? (findCanonicalIssue.get(row.id)?.id ?? row.merged_into_issue_id)
      : null,
    reportCount: row.report_count,
    currentAssignment: row.assigned_officer_id === null ? null : {
      officerId: row.assigned_officer_id,
      officerName: row.officer_name,
      assignedAt: row.assigned_at
    },
    currentTeamAssignment: row.assigned_team_id === null ? null : {
      teamId: row.assigned_team_id, teamName: row.team_name, department: row.routing_department,
      ward: { id: row.ward_id, code: row.ward_code, name: row.ward_name }, assignedAt: row.team_assigned_at
    },
    aiAssessmentSummary: mapAssessmentSummary(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function listCivicIssues({ limit, offset, status, department, category, wardId, teamId, search }) {
  const conditions = [];
  const params = [];
  if (status && status !== 'ALL') {
    conditions.push('i.status = ?');
    params.push(status);
  } else if (!status) {
    conditions.push("i.status <> 'MERGED'");
  }
  if (department) {
    conditions.push(`(i.routing_department = ? OR EXISTS (
      SELECT 1 FROM complaints c JOIN complaint_ai_assessments a ON a.complaint_id=c.id
      WHERE c.civic_issue_id=i.id AND a.status='SUCCEEDED' AND a.department=?
        AND a.id=(SELECT latest.id FROM complaint_ai_assessments latest
          WHERE latest.complaint_id=c.id AND latest.status='SUCCEEDED'
          ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
    ))`);
    params.push(department, department);
  }
  if (category) {
    conditions.push(`EXISTS (
      SELECT 1 FROM complaints c JOIN complaint_ai_assessments a ON a.complaint_id=c.id
      WHERE c.civic_issue_id=i.id AND a.status='SUCCEEDED' AND a.category=?
        AND a.id=(SELECT latest.id FROM complaint_ai_assessments latest
          WHERE latest.complaint_id=c.id AND latest.status='SUCCEEDED'
          ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
    )`);
    params.push(category);
  }
  if (wardId !== undefined) {
    conditions.push('EXISTS (SELECT 1 FROM ward_teams filter_team WHERE filter_team.id=i.assigned_team_id AND filter_team.ward_id=?)');
    params.push(wardId);
  }
  if (teamId !== undefined) {
    conditions.push('i.assigned_team_id=?');
    params.push(teamId);
  }
  if (search) {
    const searchPattern = `%${escapeLike(search)}%`;
    conditions.push(`EXISTS (
      SELECT 1 FROM complaints c WHERE c.civic_issue_id=i.id
        AND (c.title LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')
    )`);
    params.push(searchPattern, searchPattern);
  }
  params.push(limit + 1, offset);
  const whereClause = conditions.length ? conditions.join(' AND ') : '1=1';
  const rows = db.prepare(`
    SELECT i.id, i.status, i.merged_into_issue_id, i.assigned_officer_id, i.assigned_team_id, i.routing_department,
           i.created_at, i.updated_at,
           officer.display_name AS officer_name,
           team.name AS team_name, team.department AS team_department, team.ward_id,
           ward.code AS ward_code, ward.name AS ward_name,
           (SELECT e.created_at FROM civic_issue_assignment_events e
            WHERE e.civic_issue_id = i.id AND e.officer_id = i.assigned_officer_id
              AND e.event_type IN ('ASSIGNED', 'REASSIGNED')
            ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS assigned_at,
           (SELECT e.created_at FROM civic_issue_team_assignment_events e
            WHERE e.civic_issue_id = i.id AND e.team_id = i.assigned_team_id
              AND e.event_type IN ('ASSIGNED','REASSIGNED')
            ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS team_assigned_at,
           (SELECT COUNT(*) FROM complaints c WHERE c.civic_issue_id = i.id) AS report_count
    FROM civic_issues i
    LEFT JOIN users officer ON officer.id = i.assigned_officer_id
    LEFT JOIN ward_teams team ON team.id = i.assigned_team_id
    LEFT JOIN wards ward ON ward.id = team.ward_id
    WHERE ${whereClause}
    ORDER BY i.updated_at DESC, i.id DESC
    LIMIT ? OFFSET ?
  `).all(...params);
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map(mapIssue),
    pagination: { limit, offset, hasMore }
  };
}

export async function getCivicIssueReviewDetails(issueId, storage = objectStorage) {
  const issue = getCivicIssue(issueId);
  if (!issue) return null;

  const reports = db.prepare(`
    SELECT c.id,c.status,c.title,c.description,c.address,c.latitude,c.longitude,
           c.location_accuracy_meters,c.created_at,
           a.status AS assessment_status,a.category,a.department,a.severity,a.severity_reason,
           a.risk_factors,a.confidence,a.human_review_required,a.human_review_reason,
           a.created_at AS assessed_at
    FROM complaints c
    LEFT JOIN complaint_ai_assessments a ON a.id=(
      SELECT latest.id FROM complaint_ai_assessments latest
      WHERE latest.complaint_id=c.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1
    )
    WHERE c.civic_issue_id=?
    ORDER BY c.created_at DESC,c.id DESC
  `).all(issueId);
  const mediaRows = reports.length
    ? db.prepare(`SELECT id,complaint_id,object_key,media_type,mime_type,byte_size,created_at
        FROM complaint_media WHERE complaint_id IN (${reports.map(() => '?').join(',')})
        ORDER BY created_at,id`).all(...reports.map((report) => report.id))
    : [];
  const mediaByComplaint = new Map();
  for (const media of mediaRows) {
    const existing = mediaByComplaint.get(media.complaint_id) ?? [];
    existing.push(media);
    mediaByComplaint.set(media.complaint_id, existing);
  }

  issue.linkedComplaints = await Promise.all(reports.map(async (report) => ({
    complaintId: report.id,
    status: report.status,
    title: report.title,
    description: report.description,
    address: report.address,
    location: {
      latitude: report.latitude,
      longitude: report.longitude,
      accuracyMeters: report.location_accuracy_meters
    },
    createdAt: report.created_at,
    media: await Promise.all((mediaByComplaint.get(report.id) ?? []).map(async (item) => ({
      id: item.id,
      mediaType: item.media_type,
      mimeType: item.mime_type,
      byteSize: item.byte_size,
      createdAt: item.created_at,
      url: await storage.createComplaintReadUrl(item.object_key, item.mime_type)
    }))),
    aiAssessment: report.assessment_status === null ? null : {
      status: report.assessment_status,
      category: report.category,
      department: report.department,
      severity: report.severity,
      severityReason: report.severity_reason,
      riskFactors: report.risk_factors,
      confidence: report.confidence,
      humanReviewRequired: report.human_review_required === null ? null : Boolean(report.human_review_required),
      humanReviewReason: report.human_review_reason,
      assessedAt: report.assessed_at
    }
  })));
  return issue;
}

const findCanonicalIssue = db.prepare(`
  WITH RECURSIVE issue_chain(id, status, merged_into_issue_id) AS (
    SELECT id, status, merged_into_issue_id FROM civic_issues WHERE id = ?
    UNION
    SELECT next.id, next.status, next.merged_into_issue_id
    FROM civic_issues next JOIN issue_chain current ON next.id = current.merged_into_issue_id
  )
  SELECT id, status FROM issue_chain WHERE merged_into_issue_id IS NULL LIMIT 1
`);

export function getCivicIssue(issueId) {
  const row = selectIssueBase.get(issueId);
  if (!row) return null;
  const issue = mapIssue(row);
  if (row.status === 'MERGED') {
    issue.canonicalIssue = findCanonicalIssue.get(issueId) ?? null;
  }
  issue.linkedComplaints = db.prepare(`
    SELECT c.id AS complaint_id, c.status, c.created_at,
           a.status AS assessment_status, a.category, a.department, a.severity,
           a.human_review_required
    FROM complaints c
    LEFT JOIN complaint_ai_assessments a ON a.id = (
      SELECT latest.id FROM complaint_ai_assessments latest
      WHERE latest.complaint_id = c.id
      ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
    )
    WHERE c.civic_issue_id = ?
    ORDER BY c.created_at DESC, c.id DESC
  `).all(issueId).map((report) => ({
    complaintId: report.complaint_id,
    status: report.status,
    createdAt: report.created_at,
    aiAssessment: report.assessment_status === null ? null : {
      status: report.assessment_status,
      category: report.category,
      department: report.department,
      severity: report.severity,
      humanReviewRequired: report.human_review_required === null ? null : Boolean(report.human_review_required)
    }
  }));
  issue.assignmentHistory = db.prepare(`
    SELECT e.id, e.event_type, e.previous_officer_id, previous.display_name AS previous_officer_name,
           e.officer_id, officer.display_name AS officer_name,
           e.admin_user_id, admin.display_name AS admin_name, e.created_at
    FROM civic_issue_assignment_events e
    LEFT JOIN users previous ON previous.id = e.previous_officer_id
    LEFT JOIN users officer ON officer.id = e.officer_id
    JOIN users admin ON admin.id = e.admin_user_id
    WHERE e.civic_issue_id = ?
    ORDER BY e.created_at, e.id
  `).all(issueId).map((event) => ({
    id: event.id,
    eventType: event.event_type,
    previousOfficer: event.previous_officer_id === null ? null : {
      id: event.previous_officer_id,
      name: event.previous_officer_name
    },
    officer: event.officer_id === null ? null : { id: event.officer_id, name: event.officer_name },
    admin: { id: event.admin_user_id, name: event.admin_name },
    createdAt: event.created_at
  }));
  issue.teamAssignmentHistory = db.prepare(`
    SELECT e.id,e.event_type,e.previous_team_id,previous.name AS previous_team_name,
           e.team_id,team.name AS team_name,e.approved_department,e.admin_user_id,
           admin.display_name AS admin_name,e.created_at
    FROM civic_issue_team_assignment_events e
    LEFT JOIN ward_teams previous ON previous.id=e.previous_team_id
    LEFT JOIN ward_teams team ON team.id=e.team_id
    JOIN users admin ON admin.id=e.admin_user_id
    WHERE e.civic_issue_id=? ORDER BY e.created_at,e.id
  `).all(issueId).map(event => ({
    id:event.id,eventType:event.event_type,approvedDepartment:event.approved_department,
    previousTeam:event.previous_team_id===null?null:{id:event.previous_team_id,name:event.previous_team_name},
    team:event.team_id===null?null:{id:event.team_id,name:event.team_name},
    admin:{id:event.admin_user_id,name:event.admin_name},createdAt:event.created_at
  }));
  issue.repairEvidence = db.prepare(`
    SELECT r.id,r.stage,r.uploaded_by_officer_id,u.display_name AS officer_name,
           r.team_id,t.name AS team_name,r.assignment_event_id,r.mime_type,r.byte_size,r.created_at
    FROM civic_issue_repair_evidence r
    JOIN users u ON u.id=r.uploaded_by_officer_id
    JOIN ward_teams t ON t.id=r.team_id
    WHERE r.civic_issue_id=? ORDER BY r.created_at,r.id
  `).all(issueId).map(row => ({ id: row.id, stage: row.stage,
    officer: { id: row.uploaded_by_officer_id, name: row.officer_name },
    team: { id: row.team_id, name: row.team_name }, assignmentEventId: row.assignment_event_id,
    mimeType: row.mime_type, byteSize: row.byte_size, createdAt: row.created_at }));
  issue.workHistory = db.prepare(`
    SELECT e.id,e.event_type,e.team_id,t.name AS team_name,e.assignment_event_id,
           e.officer_user_id,u.display_name AS officer_name,e.evidence_id,
           e.status_before,e.status_after,e.created_at
    FROM civic_issue_work_events e JOIN users u ON u.id=e.officer_user_id
    JOIN ward_teams t ON t.id=e.team_id WHERE e.civic_issue_id=? ORDER BY e.created_at,e.id
  `).all(issueId).map(event => ({ id: event.id, eventType: event.event_type,
    team: { id: event.team_id, name: event.team_name }, assignmentEventId: event.assignment_event_id,
    officer: { id: event.officer_user_id, name: event.officer_name }, evidenceId: event.evidence_id,
    statusBefore: event.status_before, statusAfter: event.status_after, createdAt: event.created_at }));
  return issue;
}

const findAdmin = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'ADMIN'");
const findIssueForAssignment = db.prepare(`
  SELECT id, status, merged_into_issue_id, assigned_officer_id
  FROM civic_issues WHERE id = ?
`);
const findOfficer = db.prepare("SELECT id, display_name FROM users WHERE id = ? AND role = 'OFFICER'");
const updateAssignment = db.prepare(`
  UPDATE civic_issues SET assigned_officer_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ? AND status <> 'MERGED' AND merged_into_issue_id IS NULL
`);
const insertAssignmentEvent = db.prepare(`
  INSERT INTO civic_issue_assignment_events
    (civic_issue_id, event_type, previous_officer_id, officer_id, admin_user_id)
  VALUES (@issueId, @eventType, @previousOfficerId, @officerId, @adminId)
`);

function assignmentTransaction(operation) {
  const transaction = db.transaction((issueId, officerId, adminId) => {
    if (!findAdmin.get(adminId)) throw new AdminIssueError('Admin authorization is required', 403);
    const issue = findIssueForAssignment.get(issueId);
    if (!issue) throw new AdminIssueError('Civic issue not found', 404);
    if (operation !== 'UNASSIGNED') {
      throw new AdminIssueError('New individual assignments are disabled; route the issue to a ward team', 409);
    }
    if (issue.status === 'MERGED' || issue.merged_into_issue_id !== null) {
      throw new AdminIssueError('Merged civic issues cannot be assigned', 409);
    }

    const priorOfficerId = issue.assigned_officer_id;
    if (operation === 'ASSIGNED' && priorOfficerId !== null) {
      throw new AdminIssueError('Civic issue already has an assigned officer', 409);
    }
    if (operation !== 'ASSIGNED' && priorOfficerId === null) {
      throw new AdminIssueError('Civic issue has no assigned officer', 409);
    }

    let officer = null;
    if (operation !== 'UNASSIGNED') {
      officer = findOfficer.get(officerId);
      if (!officer) throw new AdminIssueError('Target user is not an active officer', 400);
      if (operation === 'REASSIGNED' && priorOfficerId === officer.id) {
        throw new AdminIssueError('Civic issue is already assigned to that officer', 409);
      }
    }

    const nextOfficerId = operation === 'UNASSIGNED' ? null : officer.id;
    const update = updateAssignment.run(nextOfficerId, issue.id);
    if (update.changes !== 1) throw new AdminIssueError('Civic issue assignment changed; retry the request', 409);
    const event = insertAssignmentEvent.run({
      issueId: issue.id,
      eventType: operation,
      previousOfficerId: operation === 'ASSIGNED' ? null : priorOfficerId,
      officerId: nextOfficerId,
      adminId
    });
    return {
      id: Number(event.lastInsertRowid),
      civicIssueId: issue.id,
      eventType: operation,
      previousOfficer: priorOfficerId === null ? null : { id: priorOfficerId },
      officer: officer ? { id: officer.id, name: officer.display_name } : null,
      assignedOfficerId: nextOfficerId,
      assignedByAdminId: adminId
    };
  });
  return (issueId, officerId, adminId) => transaction.immediate(issueId, officerId, adminId);
}

export function assignOfficer(issueId, officerId, adminId) {
  return assignmentTransaction('ASSIGNED')(issueId, officerId, adminId);
}

export function reassignOfficer(issueId, officerId, adminId) {
  return assignmentTransaction('REASSIGNED')(issueId, officerId, adminId);
}

export function unassignOfficer(issueId, adminId) {
  return assignmentTransaction('UNASSIGNED')(issueId, null, adminId);
}
