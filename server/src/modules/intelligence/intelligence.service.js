import { db } from '../../config/database.js';

export function getOwnedAssessment(userId, complaintId) {
  const row = db.prepare(`
    SELECT a.*
    FROM complaint_ai_assessments a
    JOIN complaints c ON c.id = a.complaint_id
    WHERE c.id = ? AND c.user_id = ?
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1
  `).get(complaintId, userId);
  if (!row) return null;
  const result = { status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
  if (row.status === 'SUCCEEDED') {
    let riskFactors = [];
    if (row.risk_factors) {
      try {
        const parsed = JSON.parse(row.risk_factors);
        riskFactors = Array.isArray(parsed) ? parsed : [];
      } catch {
        riskFactors = [];
      }
    }
    Object.assign(result, {
      category: row.category,
      department: row.department,
      severity: row.severity,
      severity_reason: row.severity_reason,
      risk_factors: riskFactors,
      confidence: row.confidence,
      human_review_required: Boolean(row.human_review_required),
      human_review_reason: row.human_review_reason
    });
  }
  if (row.status === 'FAILED') {
    result.errorCode = row.error_code;
    result.message = row.error_code === 'PROVIDER_UNCONFIGURED'
      ? 'AI assessment is unavailable because the provider is not configured.'
      : row.error_code === 'PROVIDER_RATE_LIMITED'
        ? 'The AI provider is temporarily rate limited. Please try again later.'
        : row.error_code === 'PROVIDER_TIMEOUT'
          ? 'The AI provider timed out. Please try again.'
          : 'AI assessment could not be completed.';
  }
  return result;
}
