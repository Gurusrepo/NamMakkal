import { db } from '../../config/database.js';
import { classifyComplaint } from '../../services/geminiProvider.js';
import { generateCandidatesForComplaint } from '../admin/duplicate.service.js';

const POLL_INTERVAL_MS = 1000;
const PROCESSING_LEASE_MINUTES = 1;
const claimNext = db.transaction(() => {
  const next = db.prepare(`
    SELECT a.id, c.title, c.description
    FROM complaint_ai_assessments a
    JOIN complaints c ON c.id = a.complaint_id
    WHERE a.status = 'PENDING'
    ORDER BY a.created_at, a.id
    LIMIT 1
  `).get();
  if (!next) return null;
  const claimed = db.prepare(`
    UPDATE complaint_ai_assessments
    SET status = 'PROCESSING', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND status = 'PENDING'
  `).run(next.id);
  return claimed.changes === 1 ? next : null;
});

const saveSuccess = db.prepare(`
  UPDATE complaint_ai_assessments SET
    status = 'SUCCEEDED', category = @category, department = @department,
    severity = @severity, severity_reason = @severity_reason,
    risk_factors = @risk_factors, confidence = @confidence,
    human_review_required = @human_review_required,
    human_review_reason = @human_review_reason, error_code = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = @id AND status = 'PROCESSING'
`);
const saveFailure = db.prepare(`
  UPDATE complaint_ai_assessments SET status = 'FAILED', error_code = ?,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ? AND status = 'PROCESSING'
`);

export async function processNextAssessment(classifier = classifyComplaint) {
  const item = claimNext();
  if (!item) return false;
  try {
    const assessment = await classifier({ title: item.title, description: item.description });
    saveSuccess.run({
      ...assessment,
      risk_factors: JSON.stringify(assessment.risk_factors),
      human_review_required: assessment.human_review_required ? 1 : 0,
      id: item.id
    });
    try {
      const complaintId = db.prepare('SELECT complaint_id FROM complaint_ai_assessments WHERE id=?').get(item.id)?.complaint_id;
      if (complaintId) generateCandidatesForComplaint(complaintId);
    } catch (error) {
      console.error('Duplicate candidate refresh failed:', error?.code ?? error?.name ?? 'Error');
    }
  } catch (error) {
    const safeCode = error?.code === 'PROVIDER_UNCONFIGURED'
      ? 'PROVIDER_UNCONFIGURED'
      : error?.code === 'INVALID_PROVIDER_RESPONSE'
        ? 'INVALID_PROVIDER_RESPONSE'
        : error?.diagnostic?.category === 'QUOTA'
          ? 'PROVIDER_RATE_LIMITED'
          : error?.diagnostic?.category === 'TIMEOUT'
            ? 'PROVIDER_TIMEOUT'
            : 'PROVIDER_UNAVAILABLE';
    saveFailure.run(safeCode, item.id);
    if (error?.diagnostic) {
      console.error(JSON.stringify({ event: 'gemini_classification_failed', ...error.diagnostic }));
    } else {
      console.error('AI assessment failed:', safeCode);
    }
  }
  return true;
}

export function recoverInterruptedAssessments() {
  return db.prepare(`UPDATE complaint_ai_assessments SET status = 'PENDING',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE status = 'PROCESSING'
      AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${PROCESSING_LEASE_MINUTES} minutes')`).run();
}

export function startAssessmentWorker() {
  // Expire abandoned claims after a lease so another live server won't steal active work.
  recoverInterruptedAssessments();
  let stopped = false;
  let active = false;
  let timer;
  const tick = async () => {
    if (stopped || active) return;
    active = true;
    try {
      recoverInterruptedAssessments();
      await processNextAssessment();
    }
    catch (error) {
      console.error('AI assessment worker failed:', error?.code ?? error?.name ?? 'Error');
    } finally {
      active = false;
      if (!stopped) timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };
  timer = setTimeout(tick, 0);
  timer.unref?.();
  return () => { stopped = true; clearTimeout(timer); };
}
