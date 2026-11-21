import { db } from '../../config/database.js';
import * as defaultStorage from '../../services/objectStorage.js';
import { createSupportUpdateNotification } from '../notifications/notification.service.js';

export class ReportedProblemError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function mapProblemRecord(row, screenshotUrl = null) {
  return {
    referenceId: row.reference_id,
    title: row.title,
    category: row.category,
    description: row.description,
    status: row.status,
    hasScreenshot: Boolean(row.screenshot_key),
    screenshotUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    adminNotes: row.admin_notes,
    user: {
      id: row.user_id,
      displayName: row.display_name,
      email: row.email,
      phoneNumber: row.phone_number
    }
  };
}

export function listReportedProblems({ limit = 20, offset = 0, status, category, search } = {}) {
  const conditions = ["s.kind = 'BUG_REPORT'"];
  const params = [];

  if (status) {
    conditions.push('s.status = ?');
    params.push(status);
  }

  if (category) {
    conditions.push('s.category = ?');
    params.push(category);
  }

  if (search) {
    conditions.push('(s.reference_id LIKE ? OR s.title LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term);
  }

  const whereClause = conditions.join(' AND ');

  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM citizen_support_submissions s
    WHERE ${whereClause}
  `).get(...params).count;

  const rows = db.prepare(`
    SELECT s.reference_id, s.user_id, s.title, s.category, s.description,
           s.screenshot_key, s.screenshot_mime_type, s.created_at, s.status,
           s.admin_notes, s.updated_at, s.closed_at,
           u.display_name, u.email, u.phone_number
    FROM citizen_support_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE ${whereClause}
    ORDER BY s.created_at DESC, s.reference_id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit + 1, offset);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => mapProblemRecord(row));

  return {
    items,
    pagination: {
      limit,
      offset,
      hasMore,
      total
    }
  };
}

export async function getReportedProblem(referenceId, storageAdapter = defaultStorage) {
  const row = db.prepare(`
    SELECT s.reference_id, s.user_id, s.title, s.category, s.description,
           s.screenshot_key, s.screenshot_mime_type, s.created_at, s.status,
           s.admin_notes, s.updated_at, s.closed_at,
           u.display_name, u.email, u.phone_number
    FROM citizen_support_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE s.reference_id = ? AND s.kind = 'BUG_REPORT'
  `).get(referenceId);

  if (!row) return null;

  let screenshotUrl = null;
  if (row.screenshot_key && row.screenshot_mime_type) {
    if (!row.screenshot_key.startsWith('support-attachments/')) {
      throw new Error('Invalid support attachment object key');
    }
    screenshotUrl = await storageAdapter.createSupportAttachmentReadUrl(
      row.screenshot_key,
      row.screenshot_mime_type
    );
  }

  return mapProblemRecord(row, screenshotUrl);
}

export async function updateReportedProblem(
  referenceId,
  { status, adminNotes },
  storageAdapter = defaultStorage
) {
  const existing = db.prepare(`
    SELECT reference_id, user_id, status, closed_at, admin_notes
    FROM citizen_support_submissions
    WHERE reference_id = ? AND kind = 'BUG_REPORT'
  `).get(referenceId);

  if (!existing) return null;

  const isTerminal = status === 'RESOLVED' || status === 'REJECTED';
  const closedAt = isTerminal
    ? (existing.closed_at || new Date().toISOString())
    : null;

  const updatedAt = new Date().toISOString();
  const notesToSave = adminNotes !== undefined
    ? (adminNotes === null ? null : adminNotes.trim())
    : existing.admin_notes;

  const saveUpdate = db.transaction(() => {
    db.prepare(`
      UPDATE citizen_support_submissions
      SET status = ?,
          admin_notes = ?,
          updated_at = ?,
          closed_at = ?
      WHERE reference_id = ? AND kind = 'BUG_REPORT'
    `).run(status, notesToSave, updatedAt, closedAt, referenceId);

    if (notesToSave) {
      createSupportUpdateNotification({
        userId: existing.user_id,
        kind: 'BUG_REPORT',
        referenceId,
        status,
        adminNotes: notesToSave
      });
    }
  });
  saveUpdate();

  return getReportedProblem(referenceId, storageAdapter);
}
