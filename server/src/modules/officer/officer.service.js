import { db } from '../../config/database.js';
import * as objectStorage from '../../services/objectStorage.js';
import { notifyIssueReporters } from '../notifications/notification.service.js';

export class OfficerWorkflowError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

const currentAccess = db.prepare(`
  SELECT i.id,i.status,i.merged_into_issue_id,i.assigned_team_id,t.name AS team_name,t.department,
         w.id AS ward_id,w.name AS ward_name,w.code AS ward_code,
         i.created_at,i.updated_at,a.id AS assignment_event_id,a.created_at AS assigned_at
  FROM civic_issues i
  JOIN ward_teams t ON t.id=i.assigned_team_id AND t.is_active=1
  JOIN wards w ON w.id=t.ward_id AND w.is_active=1
  JOIN ward_team_memberships m ON m.team_id=t.id AND m.officer_user_id=? AND m.removed_at IS NULL
  JOIN users u ON u.id=m.officer_user_id AND u.role='OFFICER' AND u.account_status='ACTIVE'
  JOIN civic_issue_team_assignment_events a ON a.id=(
    SELECT latest.id FROM civic_issue_team_assignment_events latest
    WHERE latest.civic_issue_id=i.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1
  ) AND a.team_id=i.assigned_team_id AND a.event_type IN ('ASSIGNED','REASSIGNED')
  WHERE i.id=? AND i.status<>'MERGED' AND i.merged_into_issue_id IS NULL
`);

const activeAssignmentScope = `
  i.status IN ('OPEN','IN_PROGRESS','RESOLVED') AND i.merged_into_issue_id IS NULL
  AND EXISTS (
    SELECT 1 FROM ward_team_memberships m
    JOIN ward_teams t ON t.id=m.team_id AND t.is_active=1
    JOIN wards w ON w.id=t.ward_id AND w.is_active=1
    JOIN users u ON u.id=m.officer_user_id AND u.role='OFFICER' AND u.account_status='ACTIVE'
    JOIN civic_issue_team_assignment_events a ON a.id=(
      SELECT latest.id FROM civic_issue_team_assignment_events latest
      WHERE latest.civic_issue_id=i.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1
    ) AND a.team_id=i.assigned_team_id AND a.event_type IN ('ASSIGNED','REASSIGNED')
    WHERE m.team_id=i.assigned_team_id AND m.officer_user_id=? AND m.removed_at IS NULL
  )
`;

function requireAccess(issueId, officerId) {
  const access = currentAccess.get(officerId, issueId);
  if (!access) throw new OfficerWorkflowError('Civic issue not found', 404);
  return access;
}

const insertWorkEvent = db.prepare(`INSERT INTO civic_issue_work_events
  (civic_issue_id,event_type,team_id,assignment_event_id,officer_user_id,evidence_id,status_before,status_after)
  VALUES(@issueId,@eventType,@teamId,@assignmentEventId,@officerId,@evidenceId,@statusBefore,@statusAfter)`);

const startTx = db.transaction((issueId, officerId) => {
  const access = requireAccess(issueId, officerId);
  if (access.status !== 'OPEN') throw new OfficerWorkflowError('Only OPEN issues can be started');
  const update = db.prepare(`UPDATE civic_issues SET status='IN_PROGRESS',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND status='OPEN' AND assigned_team_id=? AND merged_into_issue_id IS NULL`).run(issueId, access.assigned_team_id);
  if (update.changes !== 1) throw new OfficerWorkflowError('Issue state changed; refresh and retry');
  const event = insertWorkEvent.run({ issueId, eventType: 'STARTED', teamId: access.assigned_team_id,
    assignmentEventId: access.assignment_event_id, officerId, evidenceId: null,
    statusBefore: 'OPEN', statusAfter: 'IN_PROGRESS' });
  return { id: Number(event.lastInsertRowid), civicIssueId: issueId, eventType: 'STARTED', status: 'IN_PROGRESS' };
});

const submitActionPlanTx = db.transaction((issueId, officerId, description, steps) => {
  const access = requireAccess(issueId, officerId);
  if (!['OPEN', 'IN_PROGRESS'].includes(access.status)) {
    throw new OfficerWorkflowError('Action plans can only be submitted for OPEN or IN_PROGRESS issues');
  }
  const result = db.prepare(`INSERT INTO civic_issue_action_plans
    (civic_issue_id,team_id,assignment_event_id,officer_user_id,description,steps_json)
    VALUES(?,?,?,?,?,?)`).run(issueId, access.assigned_team_id, access.assignment_event_id,
    officerId, description, JSON.stringify(steps));
  return {
    id: Number(result.lastInsertRowid),
    description,
    steps,
    officerName: db.prepare('SELECT display_name FROM users WHERE id=?').get(officerId).display_name,
    createdAt: db.prepare('SELECT created_at FROM civic_issue_action_plans WHERE id=?')
      .get(result.lastInsertRowid).created_at
  };
});

const completeTx = db.transaction((issueId, officerId, summary) => {
  const access = requireAccess(issueId, officerId);
  if (access.status !== 'IN_PROGRESS') throw new OfficerWorkflowError('Only IN_PROGRESS issues can be completed');
  const evidenceByStage = db.prepare(`SELECT stage,id FROM civic_issue_repair_evidence
    WHERE civic_issue_id=? AND team_id=? AND assignment_event_id=?
    ORDER BY created_at DESC,id DESC`).all(issueId, access.assigned_team_id, access.assignment_event_id);
  const beforeEvidenceId = evidenceByStage.find(item => item.stage === 'BEFORE')?.id;
  const afterEvidenceId = evidenceByStage.find(item => item.stage === 'AFTER')?.id;
  if (!beforeEvidenceId || !afterEvidenceId) {
    throw new OfficerWorkflowError('At least one BEFORE and one AFTER evidence photo are required');
  }
  const update = db.prepare(`UPDATE civic_issues SET status='RESOLVED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND status='IN_PROGRESS' AND assigned_team_id=? AND merged_into_issue_id IS NULL`)
    .run(issueId, access.assigned_team_id);
  if (update.changes !== 1) throw new OfficerWorkflowError('Issue state changed; refresh and retry');
  const event = insertWorkEvent.run({ issueId, eventType: 'COMPLETED', teamId: access.assigned_team_id,
    assignmentEventId: access.assignment_event_id, officerId, evidenceId: null,
    statusBefore: 'IN_PROGRESS', statusAfter: 'RESOLVED' });
  const resolutionResult = db.prepare(`INSERT INTO civic_issue_resolutions
    (civic_issue_id,team_id,assignment_event_id,officer_user_id,completion_event_id,
      before_evidence_id,after_evidence_id,summary)
    VALUES(?,?,?,?,?,?,?,?)`).run(issueId, access.assigned_team_id, access.assignment_event_id,
    officerId, Number(event.lastInsertRowid), beforeEvidenceId, afterEvidenceId, summary);
  const resolutionId = Number(resolutionResult.lastInsertRowid);
  const resolution = db.prepare('SELECT created_at FROM civic_issue_resolutions WHERE id=?').get(resolutionId);
  notifyIssueReporters(issueId, {
    eventKey: `issue:${issueId}:work:${Number(event.lastInsertRowid)}`,
    notificationType: 'ISSUE_RESOLVED',
    title: 'Your complaint has been resolved',
    message: 'A civic issue you reported has been marked resolved. Review the repair evidence and respond from your complaint details.'
  });
  return {
    event: { id: Number(event.lastInsertRowid), civicIssueId: issueId, eventType: 'COMPLETED', status: 'RESOLVED' },
    resolution: { id: resolutionId, summary, beforeEvidenceId, afterEvidenceId, createdAt: resolution.created_at }
  };
});

const recordInspectionTx = db.transaction((issueId, officerId, findings) => {
  const access = requireAccess(issueId, officerId);
  if (!['OPEN', 'IN_PROGRESS'].includes(access.status)) {
    throw new OfficerWorkflowError('Inspections can only be recorded for OPEN or IN_PROGRESS issues');
  }
  const result = db.prepare(`INSERT INTO civic_issue_inspections
    (civic_issue_id,team_id,assignment_event_id,officer_user_id,findings)
    VALUES(?,?,?,?,?)`).run(issueId, access.assigned_team_id, access.assignment_event_id, officerId, findings);
  const inspection = db.prepare(`SELECT inspection.id,inspection.findings,inspection.created_at,
      actor.display_name AS officer_name
    FROM civic_issue_inspections inspection
    JOIN users actor ON actor.id=inspection.officer_user_id
    WHERE inspection.id=?`).get(Number(result.lastInsertRowid));
  return { id: inspection.id, findings: inspection.findings,
    officerName: inspection.officer_name, createdAt: inspection.created_at };
});

const recordProgressUpdateTx = db.transaction((issueId, officerId, message) => {
  const access = requireAccess(issueId, officerId);
  if (access.status !== 'IN_PROGRESS') {
    throw new OfficerWorkflowError('Progress updates are only available while work is IN_PROGRESS');
  }
  const result = db.prepare(`INSERT INTO civic_issue_progress_updates
    (civic_issue_id,team_id,assignment_event_id,officer_user_id,message)
    VALUES(?,?,?,?,?)`).run(issueId, access.assigned_team_id, access.assignment_event_id, officerId, message);
  const update = db.prepare(`SELECT progress.id,progress.message,progress.created_at,
      actor.display_name AS officer_name
    FROM civic_issue_progress_updates progress
    JOIN users actor ON actor.id=progress.officer_user_id
    WHERE progress.id=?`).get(Number(result.lastInsertRowid));
  return { id: update.id, message: update.message,
    officerName: update.officer_name, createdAt: update.created_at };
});

export function createOfficerService(storage = objectStorage) {
  function getProfile(officerId) {
    const officer = db.prepare(`SELECT id,display_name,email,employee_id FROM users
      WHERE id=? AND role='OFFICER' AND account_status='ACTIVE'`).get(officerId);
    if (!officer) throw new OfficerWorkflowError('Officer not found', 404);
    const teams = db.prepare(`SELECT t.id,t.name,t.department,w.id AS ward_id,w.code AS ward_code,w.name AS ward_name
      FROM ward_team_memberships membership
      JOIN ward_teams t ON t.id=membership.team_id AND t.is_active=1
      JOIN wards w ON w.id=t.ward_id AND w.is_active=1
      WHERE membership.officer_user_id=? AND membership.removed_at IS NULL
      ORDER BY w.name,t.name,t.id`).all(officerId).map(team => ({
        id: team.id,
        name: team.name,
        department: team.department,
        ward: { id: team.ward_id, code: team.ward_code, name: team.ward_name }
      }));
    return {
      id: officer.id,
      name: officer.display_name,
      email: officer.email,
      employeeId: officer.employee_id,
      teams
    };
  }

  function listIssues(officerId, {
    limit, offset, status, department, category, severity, teamId, wardId,
    assignedFrom, assignedTo, search, sort
  }) {
    const filters = [activeAssignmentScope];
    const params = [officerId];
    if (status) { filters.push('i.status=?'); params.push(status); }
    if (department) {
      filters.push(`(i.routing_department=? OR EXISTS (
        SELECT 1 FROM complaints c JOIN complaint_ai_assessments a ON a.complaint_id=c.id
        WHERE c.civic_issue_id=i.id AND a.status='SUCCEEDED' AND a.department=?
          AND a.id=(SELECT latest.id FROM complaint_ai_assessments latest
            WHERE latest.complaint_id=c.id AND latest.status='SUCCEEDED'
            ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
      ))`);
      params.push(department, department);
    }
    if (category) {
      filters.push(`EXISTS (
        SELECT 1 FROM complaints c JOIN complaint_ai_assessments a ON a.complaint_id=c.id
        WHERE c.civic_issue_id=i.id AND a.status='SUCCEEDED' AND a.category=?
          AND a.id=(SELECT latest.id FROM complaint_ai_assessments latest
            WHERE latest.complaint_id=c.id AND latest.status='SUCCEEDED'
            ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
      )`);
      params.push(category);
    }
    if (severity) {
      filters.push(`EXISTS (
        SELECT 1 FROM complaints c JOIN complaint_ai_assessments a ON a.complaint_id=c.id
        WHERE c.civic_issue_id=i.id AND a.status='SUCCEEDED' AND a.severity=?
          AND a.id=(SELECT latest.id FROM complaint_ai_assessments latest
            WHERE latest.complaint_id=c.id AND latest.status='SUCCEEDED'
            ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
      )`);
      params.push(severity);
    }
    if (teamId !== undefined) { filters.push('i.assigned_team_id=?'); params.push(teamId); }
    if (wardId !== undefined) {
      filters.push(`EXISTS (SELECT 1 FROM ward_teams filter_team
        WHERE filter_team.id=i.assigned_team_id AND filter_team.ward_id=?)`);
      params.push(wardId);
    }
    const assignmentDate = `(SELECT event.created_at FROM civic_issue_team_assignment_events event
      WHERE event.civic_issue_id=i.id ORDER BY event.created_at DESC,event.id DESC LIMIT 1)`;
    if (assignedFrom) {
      filters.push(`${assignmentDate}>=?`);
      params.push(`${assignedFrom}T00:00:00.000Z`);
    }
    if (assignedTo) {
      const exclusiveEnd = new Date(`${assignedTo}T00:00:00.000Z`);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      filters.push(`${assignmentDate}<?`);
      params.push(exclusiveEnd.toISOString());
    }
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      const issueId = /^#?(\d+)$/.exec(search)?.[1];
      filters.push(`(${issueId === undefined ? '' : 'CAST(i.id AS TEXT)=? OR '}EXISTS (
        SELECT 1 FROM complaints c WHERE c.civic_issue_id=i.id
          AND (c.title LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')
      ))`);
      if (issueId !== undefined) params.push(issueId);
      params.push(pattern, pattern);
    }
    params.push(limit + 1, offset);
    const orderBy = sort === 'OLDEST' ? 'i.created_at ASC,i.id ASC' : 'i.created_at DESC,i.id DESC';
    const rows = db.prepare(`SELECT i.id,i.status,i.routing_department,i.created_at,i.updated_at,
        t.name AS team_name,w.code AS ward_code,w.name AS ward_name,
        (SELECT c.title FROM complaints c WHERE c.civic_issue_id=i.id
          ORDER BY c.created_at DESC,c.id DESC LIMIT 1) AS title,
        (SELECT substr(c.description,1,180) FROM complaints c WHERE c.civic_issue_id=i.id
          ORDER BY c.created_at DESC,c.id DESC LIMIT 1) AS description_preview,
        (SELECT a.category FROM complaints c JOIN complaint_ai_assessments a ON a.complaint_id=c.id
          WHERE c.civic_issue_id=i.id AND a.status='SUCCEEDED'
          ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS category,
        (SELECT a.severity FROM complaints c JOIN complaint_ai_assessments a ON a.complaint_id=c.id
          WHERE c.civic_issue_id=i.id AND a.status='SUCCEEDED'
          ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS severity,
        (SELECT event.created_at FROM civic_issue_team_assignment_events event
          WHERE event.civic_issue_id=i.id ORDER BY event.created_at DESC,event.id DESC LIMIT 1) AS assigned_at,
        (SELECT COUNT(*) FROM complaints c WHERE c.civic_issue_id=i.id) AS report_count
      FROM civic_issues i JOIN ward_teams t ON t.id=i.assigned_team_id AND t.is_active=1
      JOIN wards w ON w.id=t.ward_id AND w.is_active=1
      WHERE ${filters.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params);
    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit).map(row => ({ id: row.id, status: row.status,
      title: row.title, descriptionPreview: row.description_preview,
      category: row.category, severity: row.severity,
      department: row.routing_department, teamName: row.team_name,
      ward: { code: row.ward_code, name: row.ward_name }, reportCount: row.report_count,
      assignedAt: row.assigned_at, createdAt: row.created_at, updatedAt: row.updated_at })),
      pagination: { limit, offset, hasMore } };
  }

  function getDashboard(officerId) {
    const counts = db.prepare(`SELECT COUNT(*) AS total_assigned,
        COALESCE(SUM(CASE WHEN i.status='OPEN' THEN 1 ELSE 0 END),0) AS open,
        COALESCE(SUM(CASE WHEN i.status='IN_PROGRESS' THEN 1 ELSE 0 END),0) AS in_progress,
        COALESCE(SUM(CASE WHEN i.status='RESOLVED' THEN 1 ELSE 0 END),0) AS resolved
      FROM civic_issues i WHERE ${activeAssignmentScope}`).get(officerId);
    const teams = db.prepare(`SELECT t.id,t.name,t.department,w.id AS ward_id,w.code AS ward_code,w.name AS ward_name,
        COUNT(DISTINCT CASE WHEN i.status='OPEN' THEN i.id END) AS open,
        COUNT(DISTINCT CASE WHEN i.status='IN_PROGRESS' THEN i.id END) AS in_progress,
        COUNT(DISTINCT CASE WHEN i.status='RESOLVED' THEN i.id END) AS resolved,
        (SELECT COUNT(*) FROM ward_team_memberships active_members
          JOIN users active_officers ON active_officers.id=active_members.officer_user_id
          WHERE active_members.team_id=t.id AND active_members.removed_at IS NULL
            AND active_officers.role='OFFICER' AND active_officers.account_status='ACTIVE') AS active_member_count
      FROM ward_team_memberships membership
      JOIN users officer ON officer.id=membership.officer_user_id
        AND officer.role='OFFICER' AND officer.account_status='ACTIVE'
      JOIN ward_teams t ON t.id=membership.team_id AND t.is_active=1
      JOIN wards w ON w.id=t.ward_id AND w.is_active=1
      LEFT JOIN civic_issues i ON i.assigned_team_id=t.id
        AND i.status IN ('OPEN','IN_PROGRESS','RESOLVED') AND i.merged_into_issue_id IS NULL
      WHERE membership.officer_user_id=? AND membership.removed_at IS NULL
      GROUP BY t.id ORDER BY w.name,t.name`).all(officerId).map(team => ({
        id: team.id,
        name: team.name,
        department: team.department,
        ward: { id: team.ward_id, code: team.ward_code, name: team.ward_name },
        activeMemberCount: team.active_member_count,
        workload: { open: team.open, inProgress: team.in_progress, resolved: team.resolved }
      }));
    const recentAssignments = db.prepare(`SELECT i.id,i.status,t.name AS team_name,w.code AS ward_code,w.name AS ward_name,
        assignment.created_at AS assigned_at,
        (SELECT c.title FROM complaints c WHERE c.civic_issue_id=i.id
          ORDER BY c.created_at DESC,c.id DESC LIMIT 1) AS title
      FROM civic_issues i
      JOIN ward_teams t ON t.id=i.assigned_team_id
      JOIN wards w ON w.id=t.ward_id
      JOIN civic_issue_team_assignment_events assignment ON assignment.id=(
        SELECT latest.id FROM civic_issue_team_assignment_events latest
        WHERE latest.civic_issue_id=i.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1
      )
      WHERE ${activeAssignmentScope}
      ORDER BY assignment.created_at DESC,assignment.id DESC LIMIT 5`).all(officerId).map(issue => ({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        teamName: issue.team_name,
        ward: { code: issue.ward_code, name: issue.ward_name },
        assignedAt: issue.assigned_at
      }));
    const recentActivity = db.prepare(`SELECT event.id,event.event_type,event.status_after,event.created_at,
        i.id AS issue_id,actor.display_name AS officer_name,evidence.stage AS evidence_stage
      FROM civic_issue_work_events event
      JOIN civic_issues i ON i.id=event.civic_issue_id
      JOIN users actor ON actor.id=event.officer_user_id
      LEFT JOIN civic_issue_repair_evidence evidence ON evidence.id=event.evidence_id
      WHERE ${activeAssignmentScope}
      ORDER BY event.created_at DESC,event.id DESC LIMIT 8`).all(officerId).map(event => ({
        id: event.id,
        civicIssueId: event.issue_id,
        eventType: event.event_type,
        status: event.status_after,
        evidenceStage: event.evidence_stage,
        officerName: event.officer_name,
        createdAt: event.created_at
      }));
    const activeIssues = [
      ...listIssues(officerId, { limit: 5, offset: 0, status: 'OPEN', sort: 'NEWEST' }).items,
      ...listIssues(officerId, { limit: 5, offset: 0, status: 'IN_PROGRESS', sort: 'NEWEST' }).items
    ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id - left.id)
      .slice(0, 5);
    return {
      summary: {
        totalAssigned: counts.total_assigned,
        open: counts.open,
        inProgress: counts.in_progress,
        resolved: counts.resolved
      },
      teams,
      recentAssignments,
      activeIssues,
      recentActivity
    };
  }

  async function getIssue(issueId, officerId) {
    const row = requireAccess(issueId, officerId);
    const reports = db.prepare(`SELECT c.id,c.status,c.title,c.description,c.address,c.latitude,c.longitude,
        c.location_accuracy_meters,c.created_at,
        a.status AS assessment_status,a.category,a.department,a.severity,a.severity_reason,
        a.risk_factors,a.confidence,a.human_review_required,a.human_review_reason,a.created_at AS assessed_at
      FROM complaints c
      LEFT JOIN complaint_ai_assessments a ON a.id=(
        SELECT latest.id FROM complaint_ai_assessments latest
        WHERE latest.complaint_id=c.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1
      )
      WHERE c.civic_issue_id=? ORDER BY c.created_at DESC,c.id DESC`).all(issueId);
    const mediaRows = reports.length
      ? db.prepare(`SELECT id,complaint_id,object_key,media_type,mime_type,byte_size,created_at
          FROM complaint_media WHERE complaint_id IN (${reports.map(() => '?').join(',')})
          ORDER BY created_at,id`).all(...reports.map(report => report.id))
      : [];
    const mediaByComplaint = new Map();
    for (const media of mediaRows) {
      const items = mediaByComplaint.get(media.complaint_id) ?? [];
      items.push(media);
      mediaByComplaint.set(media.complaint_id, items);
    }
    const linkedReports = await Promise.all(reports.map(async report => ({
      id: report.id,
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
      media: await Promise.all((mediaByComplaint.get(report.id) ?? []).map(async media => ({
        id: media.id,
        mediaType: media.media_type,
        mimeType: media.mime_type,
        byteSize: media.byte_size,
        createdAt: media.created_at,
        url: await storage.createComplaintReadUrl(media.object_key, media.mime_type)
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
    const evidence = db.prepare(`SELECT id,stage,mime_type,byte_size,created_at FROM civic_issue_repair_evidence
      WHERE civic_issue_id=? ORDER BY created_at,id`).all(issueId).map(item => ({ id: item.id, stage: item.stage,
        mimeType: item.mime_type, byteSize: item.byte_size, createdAt: item.created_at }));
    const history = db.prepare(`SELECT id,event_type,status_before,status_after,created_at FROM civic_issue_work_events
      WHERE civic_issue_id=? ORDER BY created_at,id`).all(issueId).map(event => ({ id: event.id,
        eventType: event.event_type, statusBefore: event.status_before, statusAfter: event.status_after, createdAt: event.created_at }));
    const inspections = db.prepare(`SELECT inspection.id,inspection.findings,inspection.created_at,
        actor.display_name AS officer_name
      FROM civic_issue_inspections inspection
      JOIN users actor ON actor.id=inspection.officer_user_id
      WHERE inspection.civic_issue_id=? ORDER BY inspection.created_at,inspection.id`).all(issueId)
      .map(inspection => ({ id: inspection.id, findings: inspection.findings,
        officerName: inspection.officer_name, createdAt: inspection.created_at }));
    const progressUpdates = db.prepare(`SELECT progress.id,progress.message,progress.created_at,
        actor.display_name AS officer_name
      FROM civic_issue_progress_updates progress
      JOIN users actor ON actor.id=progress.officer_user_id
      WHERE progress.civic_issue_id=? ORDER BY progress.created_at,progress.id`).all(issueId)
      .map(update => ({ id: update.id, message: update.message,
        officerName: update.officer_name, createdAt: update.created_at }));
    const actionPlans = db.prepare(`SELECT plan.id,plan.description,plan.steps_json,plan.created_at,
        actor.display_name AS officer_name
      FROM civic_issue_action_plans plan
      JOIN users actor ON actor.id=plan.officer_user_id
      WHERE plan.civic_issue_id=? AND plan.assignment_event_id=?
      ORDER BY plan.created_at,plan.id`).all(issueId, row.assignment_event_id)
      .map(plan => ({ id: plan.id, description: plan.description, steps: JSON.parse(plan.steps_json),
        officerName: plan.officer_name, createdAt: plan.created_at }));
    const resolutions = db.prepare(`SELECT resolution.id,resolution.summary,
        resolution.before_evidence_id,resolution.after_evidence_id,resolution.created_at,
        actor.display_name AS officer_name
      FROM civic_issue_resolutions resolution
      JOIN users actor ON actor.id=resolution.officer_user_id
      WHERE resolution.civic_issue_id=? ORDER BY resolution.created_at,resolution.id`).all(issueId)
      .map(resolution => ({ id: resolution.id, summary: resolution.summary,
        beforeEvidenceId: resolution.before_evidence_id, afterEvidenceId: resolution.after_evidence_id,
        officerName: resolution.officer_name, createdAt: resolution.created_at }));
    const assignmentHistory = db.prepare(`SELECT e.id,e.event_type,e.previous_team_id,previous.name AS previous_team_name,
        e.team_id,team.name AS team_name,e.approved_department,e.admin_user_id,admin.display_name AS admin_name,e.created_at
      FROM civic_issue_team_assignment_events e
      LEFT JOIN ward_teams previous ON previous.id=e.previous_team_id
      LEFT JOIN ward_teams team ON team.id=e.team_id
      JOIN users admin ON admin.id=e.admin_user_id
      WHERE e.civic_issue_id=? ORDER BY e.created_at,e.id`).all(issueId).map(event => ({
        id: event.id,
        eventType: event.event_type,
        previousTeam: event.previous_team_id === null ? null : { id: event.previous_team_id, name: event.previous_team_name },
        team: event.team_id === null ? null : { id: event.team_id, name: event.team_name },
        department: event.approved_department,
        assignedBy: event.admin_name,
        createdAt: event.created_at
      }));
    return {
      id: row.id,
      status: row.status,
      department: row.department,
      team: { id: row.assigned_team_id, name: row.team_name },
      ward: { id: row.ward_id, code: row.ward_code, name: row.ward_name },
      assignedAt: row.assigned_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reports: linkedReports,
      assignmentHistory,
      inspections,
      actionPlans,
      progressUpdates,
      resolutions,
      evidence,
      workHistory: history
    };
  }

  function getIssueTimeline(issueId, officerId) {
    const access = requireAccess(issueId, officerId);
    const items = [];
    for (const report of db.prepare(`SELECT id,title,created_at FROM complaints
      WHERE civic_issue_id=? ORDER BY created_at,id`).all(issueId)) {
      items.push({
        id: `report-${report.id}`,
        eventType: 'REPORT_SUBMITTED',
        actorType: 'CITIZEN',
        reportId: report.id,
        title: report.title,
        createdAt: report.created_at
      });
    }
    for (const event of db.prepare(`SELECT e.id,e.event_type,e.approved_department,e.created_at,
        previous.name AS previous_team_name,current.name AS team_name,admin.display_name AS admin_name
      FROM civic_issue_team_assignment_events e
      LEFT JOIN ward_teams previous ON previous.id=e.previous_team_id
      LEFT JOIN ward_teams current ON current.id=e.team_id
      JOIN users admin ON admin.id=e.admin_user_id
      WHERE e.civic_issue_id=? ORDER BY e.created_at,e.id`).all(issueId)) {
      items.push({
        id: `team-assignment-${event.id}`,
        eventType: `TEAM_${event.event_type}`,
        actorType: 'ADMIN',
        previousTeam: event.previous_team_name,
        team: event.team_name,
        department: event.approved_department,
        actorName: event.admin_name,
        createdAt: event.created_at
      });
    }
    for (const event of db.prepare(`SELECT e.id,e.event_type,e.status_before,e.status_after,e.created_at,
        actor.display_name AS officer_name,evidence.stage AS evidence_stage,
        resolution.summary AS resolution_summary
      FROM civic_issue_work_events e
      JOIN users actor ON actor.id=e.officer_user_id
      LEFT JOIN civic_issue_repair_evidence evidence ON evidence.id=e.evidence_id
      LEFT JOIN civic_issue_resolutions resolution ON resolution.completion_event_id=e.id
      WHERE e.civic_issue_id=? ORDER BY e.created_at,e.id`).all(issueId)) {
      items.push({
        id: `work-${event.id}`,
        eventType: event.event_type,
        actorType: 'OFFICER',
        statusBefore: event.status_before,
        statusAfter: event.status_after,
        evidenceStage: event.evidence_stage,
        actorName: event.officer_name,
        reason: event.resolution_summary,
        createdAt: event.created_at
      });
    }
    for (const inspection of db.prepare(`SELECT inspection.id,inspection.findings,inspection.created_at,
        actor.display_name AS officer_name
      FROM civic_issue_inspections inspection
      JOIN users actor ON actor.id=inspection.officer_user_id
      WHERE inspection.civic_issue_id=? ORDER BY inspection.created_at,inspection.id`).all(issueId)) {
      items.push({
        id: `inspection-${inspection.id}`,
        eventType: 'INSPECTION_RECORDED',
        actorType: 'OFFICER',
        reason: inspection.findings,
        actorName: inspection.officer_name,
        createdAt: inspection.created_at
      });
    }
    for (const update of db.prepare(`SELECT progress.id,progress.message,progress.created_at,
        actor.display_name AS officer_name
      FROM civic_issue_progress_updates progress
      JOIN users actor ON actor.id=progress.officer_user_id
      WHERE progress.civic_issue_id=? ORDER BY progress.created_at,progress.id`).all(issueId)) {
      items.push({
        id: `progress-${update.id}`,
        eventType: 'PROGRESS_UPDATED',
        actorType: 'OFFICER',
        reason: update.message,
        actorName: update.officer_name,
        createdAt: update.created_at
      });
    }
    for (const plan of db.prepare(`SELECT plan.id,plan.description,plan.created_at,
        actor.display_name AS officer_name
      FROM civic_issue_action_plans plan
      JOIN users actor ON actor.id=plan.officer_user_id
      WHERE plan.civic_issue_id=? AND plan.assignment_event_id=?
      ORDER BY plan.created_at,plan.id`).all(issueId, access.assignment_event_id)) {
      items.push({
        id: `action-plan-${plan.id}`,
        eventType: 'ACTION_PLAN_SUBMITTED',
        actorType: 'OFFICER',
        reason: plan.description,
        actorName: plan.officer_name,
        createdAt: plan.created_at
      });
    }
    for (const verification of db.prepare(`SELECT id,decision,reason,created_at
      FROM civic_issue_resolution_verifications WHERE civic_issue_id=? ORDER BY created_at,id`).all(issueId)) {
      items.push({
        id: `verification-${verification.id}`,
        eventType: verification.decision === 'CONFIRM' ? 'RESOLUTION_CONFIRMED' : 'RESOLUTION_DISPUTED',
        actorType: 'CITIZEN',
        reason: verification.reason,
        createdAt: verification.created_at
      });
    }
    const review = db.prepare(`SELECT id,decision,reason,status_before,status_after,reviewed_at
      FROM civic_issue_dispute_reviews WHERE civic_issue_id=?`).get(issueId);
    if (review) {
      items.push({
        id: `dispute-review-${review.id}`,
        eventType: 'DISPUTE_REVIEWED',
        actorType: 'ADMIN',
        decision: review.decision,
        reason: review.reason,
        statusBefore: review.status_before,
        statusAfter: review.status_after,
        createdAt: review.reviewed_at
      });
    }
    items.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      left.id.localeCompare(right.id));
    return { items };
  }

  async function uploadEvidence(issueId, officerId, stage, file) {
    const beforeUpload = requireAccess(issueId, officerId);
    validateEvidenceStage(beforeUpload, stage);
    const objectKey = await storage.uploadRepairEvidenceImage({ buffer: file.buffer, size: file.size, mimeType: file.verifiedMimeType });
    try {
      return recordEvidenceTx.immediate(issueId, officerId, stage, file, objectKey);
    } catch (error) {
      try { await storage.deleteRepairEvidenceObject(objectKey); }
      catch { console.error('Repair evidence rollback cleanup failed'); }
      throw error;
    }
  }

  const recordEvidenceTx = db.transaction((issueId, officerId, stage, file, objectKey) => {
    const access = requireAccess(issueId, officerId);
    validateEvidenceStage(access, stage);
    const result = db.prepare(`INSERT INTO civic_issue_repair_evidence
      (civic_issue_id,team_id,assignment_event_id,uploaded_by_officer_id,stage,object_key,mime_type,byte_size)
      VALUES(?,?,?,?,?,?,?,?)`).run(issueId, access.assigned_team_id, access.assignment_event_id,
      officerId, stage, objectKey, file.verifiedMimeType, file.size);
    const evidenceId = Number(result.lastInsertRowid);
    const event = insertWorkEvent.run({ issueId, eventType: 'EVIDENCE_UPLOADED', teamId: access.assigned_team_id,
      assignmentEventId: access.assignment_event_id, officerId, evidenceId,
      statusBefore: access.status, statusAfter: access.status });
    return { id: evidenceId, civicIssueId: issueId, stage, mimeType: file.verifiedMimeType,
      byteSize: file.size, eventId: Number(event.lastInsertRowid) };
  });

  function validateEvidenceStage(access, stage) {
    if (!['BEFORE', 'AFTER'].includes(stage)) throw new OfficerWorkflowError('Evidence stage must be BEFORE or AFTER', 400);
    if (stage === 'BEFORE' && !['OPEN', 'IN_PROGRESS'].includes(access.status)) throw new OfficerWorkflowError('BEFORE evidence can only be added to OPEN or IN_PROGRESS issues');
    if (stage === 'AFTER' && access.status !== 'IN_PROGRESS') throw new OfficerWorkflowError('AFTER evidence can only be added to IN_PROGRESS issues');
  }

  async function listEvidence(issueId, officerId) {
    const access = requireAccess(issueId, officerId);
    const rows = db.prepare(`SELECT id,stage,mime_type,byte_size,object_key,created_at FROM civic_issue_repair_evidence
      WHERE civic_issue_id=? AND team_id=? AND assignment_event_id=?
      ORDER BY created_at,id`).all(issueId, access.assigned_team_id, access.assignment_event_id);
    return Promise.all(rows.map(async row => ({ id: row.id, stage: row.stage, mimeType: row.mime_type,
      byteSize: row.byte_size, createdAt: row.created_at,
      url: await storage.createRepairEvidenceReadUrl(row.object_key, row.mime_type) })));
  }

  return { getProfile, getDashboard, listIssues, getIssue, getIssueTimeline,
    recordInspection: (issueId, officerId, findings) => recordInspectionTx.immediate(issueId, officerId, findings),
    submitActionPlan: (issueId, officerId, description, steps) =>
      submitActionPlanTx.immediate(issueId, officerId, description, steps),
    recordProgressUpdate: (issueId, officerId, message) => recordProgressUpdateTx.immediate(issueId, officerId, message),
    startWork: (issueId, officerId) => startTx.immediate(issueId, officerId),
    uploadEvidence, listEvidence,
    completeWork: (issueId, officerId, summary) => completeTx.immediate(issueId, officerId, summary) };
}
