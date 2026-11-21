import { db } from '../../config/database.js';
import { createSupportUpdateNotification } from '../notifications/notification.service.js';

export class SuggestionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const ALLOWED_SUGGESTION_TRANSITIONS = {
  NEW: new Set(['NEW', 'UNDER_REVIEW', 'REJECTED']),
  UNDER_REVIEW: new Set(['UNDER_REVIEW', 'NEW', 'PLANNED', 'IMPLEMENTED', 'REJECTED']),
  PLANNED: new Set(['PLANNED', 'UNDER_REVIEW', 'IMPLEMENTED', 'REJECTED']),
  IMPLEMENTED: new Set(['IMPLEMENTED', 'UNDER_REVIEW', 'PLANNED']),
  REJECTED: new Set(['REJECTED', 'NEW', 'UNDER_REVIEW'])
};

function mapSuggestionRecord(row) {
  return {
    referenceId: row.reference_id,
    title: row.title,
    category: row.category,
    description: row.description,
    status: row.status,
    adminNotes: row.admin_notes,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    user: {
      id: row.user_id,
      displayName: row.display_name,
      email: row.email,
      phoneNumber: row.phone_number
    }
  };
}

export function listSuggestions({ limit = 20, offset = 0, status, category, search } = {}) {
  const conditions = ["s.kind = 'SUGGESTION'"];
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
           s.created_at, s.status, s.admin_notes, s.rejection_reason,
           s.updated_at, s.closed_at,
           u.display_name, u.email, u.phone_number
    FROM citizen_support_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE ${whereClause}
    ORDER BY s.created_at DESC, s.reference_id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit + 1, offset);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => mapSuggestionRecord(row));

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

export function getSuggestion(referenceId) {
  const row = db.prepare(`
    SELECT s.reference_id, s.user_id, s.title, s.category, s.description,
           s.created_at, s.status, s.admin_notes, s.rejection_reason,
           s.updated_at, s.closed_at,
           u.display_name, u.email, u.phone_number
    FROM citizen_support_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE s.reference_id = ? AND s.kind = 'SUGGESTION'
  `).get(referenceId);

  if (!row) return null;
  return mapSuggestionRecord(row);
}

export function updateSuggestion(referenceId, { status, rejectionReason, adminNotes }) {
  const existing = db.prepare(`
    SELECT reference_id, user_id, status, rejection_reason, closed_at, admin_notes
    FROM citizen_support_submissions
    WHERE reference_id = ? AND kind = 'SUGGESTION'
  `).get(referenceId);

  if (!existing) return null;

  if (!ALLOWED_SUGGESTION_TRANSITIONS[existing.status]?.has(status)) {
    throw new SuggestionError(
      `Cannot transition suggestion from ${existing.status} to ${status}`,
      400
    );
  }

  const isClosed = status === 'IMPLEMENTED' || status === 'REJECTED';
  const wasClosed = existing.status === 'IMPLEMENTED' || existing.status === 'REJECTED';

  let closedAt;
  let finalRejectionReason;

  if (isClosed) {
    if (status === 'REJECTED') {
      const reasonToUse = rejectionReason !== undefined ? rejectionReason : existing.rejection_reason;
      if (!reasonToUse || reasonToUse.trim().length < 3) {
        throw new SuggestionError(
          'A rejection explanation of at least 3 characters is required when rejecting a suggestion',
          400
        );
      }
      finalRejectionReason = reasonToUse.trim();
    } else {
      // IMPLEMENTED
      finalRejectionReason = null;
    }
    closedAt = wasClosed && existing.closed_at ? existing.closed_at : new Date().toISOString();
  } else {
    // Reopening / moving to open status (NEW, UNDER_REVIEW, PLANNED)
    closedAt = null;
    finalRejectionReason = null;
  }

  const updatedAt = new Date().toISOString();
  const notesToSave = adminNotes !== undefined
    ? (adminNotes === null ? null : adminNotes.trim())
    : existing.admin_notes;

  const saveUpdate = db.transaction(() => {
    db.prepare(`
      UPDATE citizen_support_submissions
      SET status = ?,
          rejection_reason = ?,
          admin_notes = ?,
          updated_at = ?,
          closed_at = ?
      WHERE reference_id = ? AND kind = 'SUGGESTION'
    `).run(status, finalRejectionReason, notesToSave, updatedAt, closedAt, referenceId);

    if (notesToSave) {
      createSupportUpdateNotification({
        userId: existing.user_id,
        kind: 'SUGGESTION',
        referenceId,
        status,
        adminNotes: notesToSave,
        rejectionReason: finalRejectionReason
      });
    }
  });
  saveUpdate();

  return getSuggestion(referenceId);
}
