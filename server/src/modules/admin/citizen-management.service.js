import { db } from '../../config/database.js';

export class CitizenManagementError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

function requireAdmin(adminId) {
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND role='ADMIN'").get(adminId)) {
    throw new CitizenManagementError('Admin authorization is required', 403);
  }
}

export function listCitizens({ limit = 20, offset = 0, status, search } = {}) {
  const conditions = ["u.role='CITIZEN'", 'u.deleted_at IS NULL'];
  const params = [];
  if (status) {
    conditions.push('u.account_status=?');
    params.push(status);
  }
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(`(u.display_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern);
  }
  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS count FROM users u WHERE ${where}`).get(...params).count;
  params.push(limit + 1, offset);
  const rows = db.prepare(`SELECT u.id,u.display_name,u.email,u.account_status,u.email_verified,
      u.created_at,u.updated_at,u.phone_number,u.address,
      (SELECT COUNT(*) FROM complaints c WHERE c.user_id=u.id) AS complaint_count
    FROM users u WHERE ${where}
    ORDER BY u.created_at DESC,u.id DESC LIMIT ? OFFSET ?`).all(...params);
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      name: row.display_name,
      email: row.email,
      status: row.account_status,
      emailVerified: Boolean(row.email_verified),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      phoneNumber: row.phone_number,
      address: row.address,
      complaintCount: row.complaint_count
    })),
    pagination: { limit, offset, hasMore, total }
  };
}

export function getCitizen(citizenId) {
  const citizen = db.prepare(`SELECT id,display_name,email,account_status,email_verified,created_at,
      updated_at,phone_number,date_of_birth,address
    FROM users WHERE id=? AND role='CITIZEN' AND deleted_at IS NULL`).get(citizenId);
  if (!citizen) return null;
  const complaints = db.prepare(`SELECT c.id,c.title,c.status,c.created_at,c.updated_at,
      i.status AS civic_issue_status
    FROM complaints c LEFT JOIN civic_issues i ON i.id=c.civic_issue_id
    WHERE c.user_id=? ORDER BY c.created_at DESC,c.id DESC`).all(citizenId).map((row) => ({
    id: row.id,
    reference: `CMP-${row.id}`,
    title: row.title,
    status: row.civic_issue_status ?? row.status,
    submittedAt: row.created_at,
    updatedAt: row.updated_at
  }));
  return {
    citizen: {
      id: citizen.id,
      name: citizen.display_name,
      email: citizen.email,
      status: citizen.account_status,
      emailVerified: Boolean(citizen.email_verified),
      createdAt: citizen.created_at,
      updatedAt: citizen.updated_at,
      phoneNumber: citizen.phone_number,
      dateOfBirth: citizen.date_of_birth,
      address: citizen.address
    },
    complaintCount: complaints.length,
    complaints
  };
}

export function updateCitizenStatus(citizenId, status, adminId) {
  requireAdmin(adminId);
  const citizen = db.prepare(`SELECT id,account_status,deleted_at FROM users
    WHERE id=? AND role='CITIZEN' AND deleted_at IS NULL`).get(citizenId);
  if (!citizen) throw new CitizenManagementError('Citizen not found', 404);
  if (citizen.account_status === status) {
    throw new CitizenManagementError(`Citizen is already ${status.toLowerCase()}`, 409);
  }
  const timestamp = new Date().toISOString();
  const updated = db.prepare(`UPDATE users SET account_status=?,deactivated_at=?,
      session_version=session_version+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND role='CITIZEN' AND deleted_at IS NULL AND account_status=?`)
    .run(status, status === 'DEACTIVATED' ? timestamp : null, citizenId, citizen.account_status);
  if (updated.changes !== 1) throw new CitizenManagementError('Citizen account changed; retry the request', 409);
  return getCitizen(citizenId).citizen;
}

export function deleteCitizen(citizenId, adminId) {
  requireAdmin(adminId);
  const citizen = db.prepare(`SELECT id,account_status FROM users
    WHERE id=? AND role='CITIZEN' AND deleted_at IS NULL`).get(citizenId);
  if (!citizen) throw new CitizenManagementError('Citizen not found', 404);
  const timestamp = new Date().toISOString();
  const updated = db.prepare(`UPDATE users SET account_status='DEACTIVATED',deleted_at=?,
      deactivated_at=?,session_version=session_version+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND role='CITIZEN' AND deleted_at IS NULL`).run(timestamp, timestamp, citizenId);
  if (updated.changes !== 1) throw new CitizenManagementError('Citizen account changed; retry the request', 409);
  return { deleted: true };
}
