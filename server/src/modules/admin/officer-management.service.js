import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../../config/database.js';
import { sendVerificationCode, VerificationError } from '../auth/verification.service.js';

export class OfficerManagementError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
    if (status >= 500) this.expose = true;
  }
}

const requireAdmin = (adminId) => {
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND role='ADMIN'").get(adminId)) {
    throw new OfficerManagementError('Admin authorization is required', 403);
  }
};

function mapOfficer(row) {
  return {
    id: row.id,
    name: row.display_name,
    email: row.email,
    employeeId: row.employee_id,
    status: row.account_status,
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listOfficerTeams(officerId) {
  return db.prepare(`SELECT m.id,m.team_id,t.name AS team_name,t.department,t.is_active AS team_active,
      w.id AS ward_id,w.code AS ward_code,w.name AS ward_name,w.is_active AS ward_active,
      m.added_by_admin_id,added.display_name AS added_by_name,m.added_at,
      m.removed_by_admin_id,removed.display_name AS removed_by_name,m.removed_at
    FROM ward_team_memberships m
    JOIN ward_teams t ON t.id=m.team_id
    JOIN wards w ON w.id=t.ward_id
    JOIN users added ON added.id=m.added_by_admin_id
    LEFT JOIN users removed ON removed.id=m.removed_by_admin_id
    WHERE m.officer_user_id=?
    ORDER BY m.added_at DESC,m.id DESC`).all(officerId).map((row) => ({
    membershipId: row.id,
    team: { id: row.team_id, name: row.team_name, department: row.department, active: Boolean(row.team_active) },
    ward: { id: row.ward_id, code: row.ward_code, name: row.ward_name, active: Boolean(row.ward_active) },
    addedBy: { id: row.added_by_admin_id, name: row.added_by_name },
    addedAt: row.added_at,
    active: row.removed_at === null,
    removedBy: row.removed_by_admin_id === null ? null : { id: row.removed_by_admin_id, name: row.removed_by_name },
    removedAt: row.removed_at
  }));
}

export function listOfficers({ limit, offset, status, teamId, search }) {
  const conditions = ["u.role='OFFICER'"];
  const params = [];
  if (status) {
    conditions.push('u.account_status=?');
    params.push(status);
  }
  if (teamId !== undefined) {
    conditions.push(`EXISTS (
      SELECT 1 FROM ward_team_memberships m
      WHERE m.officer_user_id=u.id AND m.team_id=? AND m.removed_at IS NULL
    )`);
    params.push(teamId);
  }
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(`(u.display_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\'
      OR u.employee_id LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern);
  }
  params.push(limit + 1, offset);
  const rows = db.prepare(`SELECT u.id,u.display_name,u.email,u.employee_id,u.account_status,
      u.email_verified,u.created_at,u.updated_at
    FROM users u WHERE ${conditions.join(' AND ')}
    ORDER BY u.created_at DESC,u.id DESC LIMIT ? OFFSET ?`).all(...params);
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((row) => ({
      ...mapOfficer(row),
      teams: listOfficerTeams(row.id).filter((membership) => membership.active)
    })),
    pagination: { limit, offset, hasMore }
  };
}

export function getOfficer(officerId) {
  const row = db.prepare(`SELECT id,display_name,email,employee_id,account_status,email_verified,created_at,updated_at
    FROM users WHERE id=? AND role='OFFICER'`).get(officerId);
  if (!row) return null;
  const events = db.prepare(`SELECT e.id,e.event_type,e.previous_status,e.next_status,e.created_at,
      e.admin_user_id,u.display_name AS admin_name
    FROM officer_account_events e JOIN users u ON u.id=e.admin_user_id
    WHERE e.officer_user_id=? ORDER BY e.created_at,e.id`).all(officerId).map((event) => ({
    id: event.id,
    eventType: event.event_type,
    previousStatus: event.previous_status,
    nextStatus: event.next_status,
    admin: { id: event.admin_user_id, name: event.admin_name },
    createdAt: event.created_at
  }));
  return { ...mapOfficer(row), teams: listOfficerTeams(officerId), accountHistory: events };
}

function ensureValidTeams(wardId, teamIds) {
  const ward = db.prepare('SELECT is_active FROM wards WHERE id=?').get(wardId);
  if (!ward) throw new OfficerManagementError('Ward was not found', 404);
  if (!ward.is_active) throw new OfficerManagementError('The selected ward must be active', 409);

  const placeholders = teamIds.map(() => '?').join(',');
  const teams = db.prepare(`SELECT t.id,t.ward_id,t.is_active,w.is_active AS ward_active FROM ward_teams t
    JOIN wards w ON w.id=t.ward_id WHERE t.id IN (${placeholders})`).all(...teamIds);
  if (teams.length !== teamIds.length) throw new OfficerManagementError('One or more ward teams were not found', 404);
  if (teams.some((team) => !team.is_active || !team.ward_active)) {
    throw new OfficerManagementError('All selected teams and wards must be active', 409);
  }
  if (teams.some((team) => team.ward_id !== wardId)) {
    throw new OfficerManagementError('All selected teams must belong to the selected ward', 409);
  }
}

function insertOfficerWithGeneratedId(input, passwordHash) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const employeeId = `EMP-${randomBytes(6).toString('hex').toUpperCase()}`;
    try {
      const result = db.prepare(`INSERT INTO users
        (display_name,email,password_hash,role,employee_id,email_verified,account_status)
        VALUES(?,?,?,'OFFICER',?,0,'PENDING_EMAIL_VERIFICATION')`)
        .run(input.displayName, input.email, passwordHash, employeeId);
      return { officerId: Number(result.lastInsertRowid), employeeId };
    } catch (error) {
      const idAlreadyExists = error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
        && db.prepare('SELECT 1 FROM users WHERE employee_id=? COLLATE NOCASE').get(employeeId);
      if (!idAlreadyExists) throw error;
    }
  }
  throw new OfficerManagementError('A unique employee ID could not be generated. Please try again.', 503);
}

const createOfficerTransaction = db.transaction((input, adminId, passwordHash) => {
  requireAdmin(adminId);
  if (db.prepare('SELECT 1 FROM users WHERE email=? COLLATE NOCASE').get(input.email)) {
    throw new OfficerManagementError('An account already uses that email', 409);
  }
  ensureValidTeams(input.wardId, input.teamIds);
  const { officerId } = insertOfficerWithGeneratedId(input, passwordHash);
  const addMembership = db.prepare(`INSERT INTO ward_team_memberships
    (team_id,officer_user_id,added_by_admin_id) VALUES(?,?,?)`);
  for (const teamId of input.teamIds) addMembership.run(teamId, officerId, adminId);
  db.prepare(`INSERT INTO officer_account_events
    (officer_user_id,admin_user_id,event_type,previous_status,next_status)
    VALUES(?,?,'CREATED',NULL,'PENDING_EMAIL_VERIFICATION')`).run(officerId, adminId);
  return { officerId };
});

async function deliverRegistrationInvitation(officerId, sender) {
  try {
    return await sender(officerId, 'REGISTRATION');
  } catch (error) {
    if (error instanceof VerificationError) {
      throw new OfficerManagementError(
        'The officer account was saved, but the verification email could not be sent. Retry the invitation.',
        error.status >= 500 ? 503 : error.status
      );
    }
    throw error;
  }
}

export async function createOfficer(input, adminId, sender = sendVerificationCode) {
  const initialPassword = randomBytes(32).toString('base64url');
  const passwordHash = await bcrypt.hash(initialPassword, 12);
  let officerId;
  try {
    ({ officerId } = createOfficerTransaction.immediate(input, adminId, passwordHash));
  } catch (error) {
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new OfficerManagementError('An account already uses that email', 409);
    }
    throw error;
  }
  try {
    const invitation = await deliverRegistrationInvitation(officerId, sender);
    return { officer: getOfficer(officerId), invitation: { sent: true, resendAfter: invitation.resendAfter ?? null } };
  } catch (error) {
    if (!(error instanceof OfficerManagementError)) throw error;
    return { officer: getOfficer(officerId), invitation: { sent: false, error: error.message } };
  }
}

export async function resendOfficerInvitation(officerId, adminId, sender = sendVerificationCode) {
  requireAdmin(adminId);
  const officer = db.prepare(`SELECT id,account_status,email_verified FROM users
    WHERE id=? AND role='OFFICER'`).get(officerId);
  if (!officer) throw new OfficerManagementError('Officer not found', 404);
  if (officer.account_status !== 'PENDING_EMAIL_VERIFICATION' || officer.email_verified) {
    throw new OfficerManagementError('Only officers awaiting email verification can receive an invitation', 409);
  }
  const invitation = await deliverRegistrationInvitation(officerId, sender);
  db.prepare(`INSERT INTO officer_account_events
    (officer_user_id,admin_user_id,event_type,previous_status,next_status)
    VALUES(?,?,'INVITATION_RESENT',?,?)`).run(
    officerId, adminId, officer.account_status, officer.account_status
  );
  return { sent: true, resendAfter: invitation.resendAfter ?? null };
}

const updateOfficerStatusTransaction = db.transaction((officerId, status, adminId) => {
  requireAdmin(adminId);
  const officer = db.prepare(`SELECT id,account_status,email_verified FROM users
    WHERE id=? AND role='OFFICER'`).get(officerId);
  if (!officer) throw new OfficerManagementError('Officer not found', 404);
  if (officer.account_status === status) throw new OfficerManagementError(`Officer is already ${status.toLowerCase()}`, 409);
  if (status === 'ACTIVE' && (!officer.email_verified || officer.account_status !== 'DEACTIVATED')) {
    throw new OfficerManagementError('Only a previously active, email-verified officer can be reactivated', 409);
  }
  const deactivatedAt = status === 'DEACTIVATED' ? new Date().toISOString() : null;
  const updated = db.prepare(`UPDATE users SET account_status=?,deactivated_at=?,
      session_version=session_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND role='OFFICER' AND account_status=?`)
    .run(status, deactivatedAt, officerId, officer.account_status);
  if (updated.changes !== 1) throw new OfficerManagementError('Officer account changed; retry the request', 409);
  db.prepare(`INSERT INTO officer_account_events
    (officer_user_id,admin_user_id,event_type,previous_status,next_status)
    VALUES(?,?,?,?,?)`).run(officerId, adminId, status === 'ACTIVE' ? 'ACTIVATED' : 'DEACTIVATED',
    officer.account_status, status);
  return getOfficer(officerId);
});

export function updateOfficerStatus(officerId, status, adminId) {
  return updateOfficerStatusTransaction.immediate(officerId, status, adminId);
}
