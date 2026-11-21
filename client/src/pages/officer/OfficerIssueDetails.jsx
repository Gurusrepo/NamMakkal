import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getCivicIssue, getCivicIssueTimeline, listRepairEvidence, recordInspection, submitActionPlan,
  recordProgressUpdate, startWork, uploadRepairEvidence, completeWork
} from '../../api/officer.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';
import StatusBadge from '../../components/citizen/StatusBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { requestOnce } from '../../utils/requestOnce.js';

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatEnumLabel(value) {
  if (!value) return 'Unavailable';
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventTitle(event) {
  if (event.eventType.startsWith('TEAM_')) {
    return {
      TEAM_ASSIGNED: 'Assigned to a ward team',
      TEAM_REASSIGNED: 'Reassigned to another ward team',
      TEAM_UNASSIGNED: 'Removed from a ward team'
    }[event.eventType] ?? 'Team assignment updated';
  }
  return {
    REPORT_SUBMITTED: 'Citizen report submitted',
    INSPECTION_RECORDED: 'Inspection findings recorded',
    ACTION_PLAN_SUBMITTED: 'Action plan submitted',
    PROGRESS_UPDATED: 'Work progress updated',
    STARTED: 'Work started',
    EVIDENCE_UPLOADED: 'Repair evidence uploaded',
    COMPLETED: 'Work marked resolved',
    RESOLUTION_CONFIRMED: 'Citizen confirmed the resolution',
    RESOLUTION_DISPUTED: 'Citizen disputed the resolution',
    DISPUTE_REVIEWED: event.decision === 'ACCEPTED'
      ? 'Administrator accepted the dispute'
      : 'Administrator rejected the dispute'
  }[event.eventType] ?? formatEnumLabel(event.eventType);
}

function Section({ title, children, id }) {
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-6">
      <h2 id={id} className="text-lg font-semibold text-[#20382a]">{title}</h2>
      {children}
    </section>
  );
}

export default function OfficerIssueDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const [issue, setIssue] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [timeline, setTimeline] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState('');
  const [timelineRetry, setTimelineRetry] = useState(0);
  const [evidence, setEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [evidenceError, setEvidenceError] = useState('');
  const [evidenceRetry, setEvidenceRetry] = useState(0);
  const [evidenceStage, setEvidenceStage] = useState('BEFORE');
  const [evidencePhoto, setEvidencePhoto] = useState(null);
  const [evidenceUploadError, setEvidenceUploadError] = useState('');
  const [evidenceUploadSuccess, setEvidenceUploadSuccess] = useState('');
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const evidencePhotoInput = useRef(null);
  const [inspectionFindings, setInspectionFindings] = useState('');
  const [inspectionError, setInspectionError] = useState('');
  const [inspectionSuccess, setInspectionSuccess] = useState('');
  const [inspectionSubmitting, setInspectionSubmitting] = useState(false);
  const [actionPlanDescription, setActionPlanDescription] = useState('');
  const [actionPlanSteps, setActionPlanSteps] = useState(['']);
  const [actionPlanError, setActionPlanError] = useState('');
  const [actionPlanSuccess, setActionPlanSuccess] = useState('');
  const [actionPlanSubmitting, setActionPlanSubmitting] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressError, setProgressError] = useState('');
  const [progressSuccess, setProgressSuccess] = useState('');
  const [progressSubmitting, setProgressSubmitting] = useState(false);
  const [startError, setStartError] = useState('');
  const [startSubmitting, setStartSubmitting] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [resolutionError, setResolutionError] = useState('');
  const [resolutionSuccess, setResolutionSuccess] = useState('');
  const [resolutionSubmitting, setResolutionSubmitting] = useState(false);

  async function handleStartWork() {
    setStartError('');
    setStartSubmitting(true);
    try {
      const result = await startWork(id);
      setIssue((current) => current && ({ ...current, status: result.event.status }));
      setTimelineRetry((value) => value + 1);
    } catch (requestError) {
      setStartError(getApiErrorMessage(requestError, 'Work could not be started.'));
    } finally {
      setStartSubmitting(false);
    }
  }

  async function handleInspectionSubmit(event) {
    event.preventDefault();
    setInspectionError('');
    setInspectionSuccess('');
    setInspectionSubmitting(true);
    try {
      const result = await recordInspection(id, inspectionFindings);
      setIssue((current) => current && ({
        ...current,
        inspections: [...(current.inspections ?? []), result.inspection]
      }));
      setInspectionFindings('');
      setInspectionSuccess('Inspection findings saved.');
      setTimelineRetry((value) => value + 1);
    } catch (requestError) {
      setInspectionError(getApiErrorMessage(requestError, 'Inspection findings could not be saved.'));
    } finally {
      setInspectionSubmitting(false);
    }
  }

  async function handleActionPlanSubmit(event) {
    event.preventDefault();
    setActionPlanError('');
    setActionPlanSuccess('');
    setActionPlanSubmitting(true);
    try {
      const result = await submitActionPlan(id, {
        description: actionPlanDescription,
        steps: actionPlanSteps.map((step) => step.trim()).filter(Boolean)
      });
      setIssue((current) => current && ({
        ...current,
        actionPlans: [...(current.actionPlans ?? []), result.actionPlan]
      }));
      setActionPlanDescription('');
      setActionPlanSteps(['']);
      setActionPlanSuccess('Action plan saved.');
      setTimelineRetry((value) => value + 1);
    } catch (requestError) {
      setActionPlanError(getApiErrorMessage(requestError, 'Action plan could not be saved.'));
    } finally {
      setActionPlanSubmitting(false);
    }
  }

  async function handleEvidenceSubmit(event) {
    event.preventDefault();
    setEvidenceUploadError('');
    setEvidenceUploadSuccess('');
    if (!evidencePhoto) {
      setEvidenceUploadError('Choose a photo to upload.');
      return;
    }

    setEvidenceUploading(true);
    try {
      await uploadRepairEvidence(id, { photo: evidencePhoto, stage: evidenceStage });
    } catch (requestError) {
      setEvidenceUploadError(getApiErrorMessage(requestError, 'Repair photo could not be uploaded.'));
      setEvidenceUploading(false);
      return;
    }

    setEvidenceUploadSuccess(`${evidenceStage} repair photo uploaded.`);
    setEvidencePhoto(null);
    if (evidencePhotoInput.current) evidencePhotoInput.current.value = '';
    try {
      const result = await listRepairEvidence(id);
      setEvidence(result.items);
    } catch (requestError) {
      setEvidenceUploadError(getApiErrorMessage(requestError, 'Photo uploaded, but the evidence list could not be refreshed.'));
    } finally {
      setEvidenceUploading(false);
    }
  }

  async function handleProgressSubmit(event) {
    event.preventDefault();
    setProgressError('');
    setProgressSuccess('');
    setProgressSubmitting(true);
    try {
      const result = await recordProgressUpdate(id, progressMessage);
      setIssue((current) => current && ({
        ...current,
        progressUpdates: [...(current.progressUpdates ?? []), result.update]
      }));
      setProgressMessage('');
      setProgressSuccess('Progress update saved.');
      setTimelineRetry((value) => value + 1);
    } catch (requestError) {
      setProgressError(getApiErrorMessage(requestError, 'Progress update could not be saved.'));
    } finally {
      setProgressSubmitting(false);
    }
  }

  async function handleResolutionSubmit(event) {
    event.preventDefault();
    setResolutionError('');
    setResolutionSuccess('');
    setResolutionSubmitting(true);
    try {
      const result = await completeWork(id, resolutionSummary);
      setIssue((current) => current && ({
        ...current,
        status: result.event.status,
        resolutions: [...(current.resolutions ?? []), result.resolution]
      }));
      setResolutionSummary('');
      setResolutionSuccess('Resolution submitted with the required repair evidence.');
      setTimelineRetry((value) => value + 1);
      setEvidenceRetry((value) => value + 1);
    } catch (requestError) {
      setResolutionError(getApiErrorMessage(requestError, 'Resolution could not be submitted.'));
    } finally {
      setResolutionSubmitting(false);
    }
  }

  useEffect(() => {
    let active = true;
    setIssue(null);
    setIsLoading(true);
    setError('');
    requestOnce(`officer:${user?.id}:issue:${id}:${retry}`, () => getCivicIssue(id))
      .then((result) => { if (active) setIssue(result.issue); })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Complaint details could not be loaded.'));
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [id, retry, user?.id]);

  useEffect(() => {
    let active = true;
    setTimeline(null);
    setTimelineLoading(true);
    setTimelineError('');
    requestOnce(`officer:${user?.id}:timeline:${id}:${timelineRetry}`, () => getCivicIssueTimeline(id))
      .then((result) => { if (active) setTimeline(result.items); })
      .catch((requestError) => {
        if (active) setTimelineError(getApiErrorMessage(requestError, 'Issue timeline could not be loaded.'));
      })
      .finally(() => { if (active) setTimelineLoading(false); });
    return () => { active = false; };
  }, [id, timelineRetry, user?.id]);

  useEffect(() => {
    let active = true;
    setEvidence(null);
    setEvidenceLoading(true);
    setEvidenceError('');
    requestOnce(`officer:${user?.id}:repair-evidence:${id}:${evidenceRetry}`, () => listRepairEvidence(id))
      .then((result) => { if (active) setEvidence(result.items); })
      .catch((requestError) => {
        if (active) setEvidenceError(getApiErrorMessage(requestError, 'Repair evidence could not be loaded.'));
      })
      .finally(() => { if (active) setEvidenceLoading(false); });
    return () => { active = false; };
  }, [id, evidenceRetry, user?.id]);

  if (isLoading) return <LoadingState>Loading complaint details...</LoadingState>;
  if (error || !issue) {
    return (
      <div className="space-y-4">
        <Link to="/officer/issues" className="text-sm font-semibold text-[#1d4933] underline underline-offset-4">Back to complaints</Link>
        <ErrorState onRetry={() => setRetry((value) => value + 1)}>{error || 'Complaint not found.'}</ErrorState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to="/officer/issues" className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-semibold text-[#1d4933] underline decoration-[#d4ae58] underline-offset-4 focus:outline-none focus:ring-2 focus:ring-[#477454]/30">
        Back to complaints
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Assigned civic issue #{issue.id}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#20382a]">Complaint details</h1>
          <p className="mt-2 text-sm text-[#68736a]">
            {issue.ward.name} ({issue.ward.code}) · {issue.team.name} · {issue.department}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {issue.status === 'OPEN' && (
            <button
              type="button"
              onClick={handleStartWork}
              disabled={startSubmitting}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#1d4933] px-4 text-sm font-semibold text-white transition hover:bg-[#163b29] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
            >
              {startSubmitting ? 'Starting...' : 'Start work'}
            </button>
          )}
          <StatusBadge status={issue.status} />
        </div>
      </header>
      {startError && <p role="alert" className="text-sm text-red-700">{startError}</p>}

      <Section title="Assignment history" id="officer-assignment-history">
        {issue.assignmentHistory.length === 0 ? (
          <EmptyState>No assignment history is available.</EmptyState>
        ) : (
          <ol className="space-y-3">
            {issue.assignmentHistory.map((assignment) => (
              <li key={assignment.id} className="rounded-xl border border-[#ece9df] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#34483a]">{formatEnumLabel(assignment.eventType)}</p>
                  <time className="text-xs text-[#758077]" dateTime={assignment.createdAt}>{formatDate(assignment.createdAt)}</time>
                </div>
                <p className="mt-1 text-sm text-[#68736a]">
                  {assignment.previousTeam?.name
                    ? `${assignment.previousTeam.name} → `
                    : ''}
                  {assignment.team?.name || 'Unassigned'}
                  {' · '}
                  {assignment.assignedBy ? `Assigned by ${assignment.assignedBy}` : 'Administrator action'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Citizen reports" id="officer-linked-reports">
        {issue.reports.length === 0 ? (
          <EmptyState>No linked citizen reports are available.</EmptyState>
        ) : (
          <div className="space-y-4">
            {issue.reports.map((report) => (
              <article key={report.id} className="space-y-4 rounded-xl border border-[#ece9df] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#758077]">Report #{report.id} · {formatDate(report.createdAt)}</p>
                    <h3 className="mt-1 text-base font-semibold text-[#20382a]">{report.title}</h3>
                  </div>
                  <StatusBadge status={report.status} />
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#526258]">{report.description}</p>
                <dl className="grid gap-3 border-t border-[#ece9df] pt-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-[#758077]">Reported address</dt>
                    <dd className="mt-1 text-sm text-[#34483a]">{report.address || 'Address unavailable'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#758077]">Coordinates</dt>
                    <dd className="mt-1 text-sm text-[#34483a]">
                      {Number.isFinite(report.location.latitude) && Number.isFinite(report.location.longitude)
                        ? `${report.location.latitude}, ${report.location.longitude}`
                        : 'Location unavailable'}
                    </dd>
                  </div>
                </dl>
                {report.media.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {report.media.map((media) => (
                      <a key={media.id} href={media.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-[#e5e2d5] focus:outline-none focus:ring-4 focus:ring-[#477454]/20">
                        <img src={media.url} alt={`Photo submitted with report ${report.id}`} className="h-52 w-full object-cover" />
                        <span className="block px-3 py-2 text-xs text-[#68736a]">
                          {media.mimeType} · {Math.ceil(media.byteSize / 1024)} KB
                        </span>
                      </a>
                    ))}
                  </div>
                )}
                {report.aiAssessment && (
                  <div className="rounded-xl bg-[#f7f8f5] p-3">
                    <h4 className="text-sm font-semibold text-[#34483a]">AI assessment</h4>
                    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                      <div><dt className="text-xs text-[#758077]">Category</dt><dd className="mt-1 text-[#34483a]">{formatEnumLabel(report.aiAssessment.category)}</dd></div>
                      <div><dt className="text-xs text-[#758077]">Department</dt><dd className="mt-1 text-[#34483a]">{report.aiAssessment.department || 'Unavailable'}</dd></div>
                      <div><dt className="text-xs text-[#758077]">Severity</dt><dd className="mt-1 text-[#34483a]">{formatEnumLabel(report.aiAssessment.severity)}</dd></div>
                    </dl>
                    {report.aiAssessment.severityReason && (
                      <p className="mt-2 text-sm leading-5 text-[#526258]">{report.aiAssessment.severityReason}</p>
                    )}
                    {report.aiAssessment.humanReviewRequired && (
                      <p className="mt-2 text-sm font-medium text-[#725a23]">This assessment requires human review.</p>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="Inspection findings" id="officer-inspections">
        {issue.inspections.length === 0 ? (
          <EmptyState>No inspection findings have been recorded.</EmptyState>
        ) : (
          <ol className="space-y-3">
            {issue.inspections.map((inspection) => (
              <li key={inspection.id} className="rounded-xl border border-[#ece9df] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#34483a]">
                    {inspection.officerName || 'Officer'}
                  </p>
                  <time className="text-xs text-[#758077]" dateTime={inspection.createdAt}>
                    {formatDate(inspection.createdAt)}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#526258]">{inspection.findings}</p>
              </li>
            ))}
          </ol>
        )}

        {issue.status === 'RESOLVED' ? (
          <p className="text-sm text-[#68736a]">Inspection records are read-only after resolution.</p>
        ) : (
          <form onSubmit={handleInspectionSubmit} className="space-y-3 border-t border-[#ece9df] pt-4">
            <label htmlFor="officer-inspection-findings" className="block text-sm font-medium text-[#34483a]">
              Record inspection findings
            </label>
            <textarea
              id="officer-inspection-findings"
              value={inspectionFindings}
              onChange={(event) => {
                setInspectionFindings(event.target.value);
                setInspectionError('');
                setInspectionSuccess('');
              }}
              maxLength={4000}
              required
              rows={4}
              className="w-full rounded-xl border border-[#d9ded5] bg-white px-3 py-2 text-sm text-[#20382a] focus:border-[#477454] focus:outline-none focus:ring-2 focus:ring-[#477454]/20"
              placeholder="Describe the issue observed during inspection."
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[#758077]">{inspectionFindings.length}/4000 characters</p>
              <button
                type="submit"
                disabled={inspectionSubmitting || !inspectionFindings.trim()}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#1d4933] px-4 text-sm font-semibold text-white transition hover:bg-[#163b29] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
              >
                {inspectionSubmitting ? 'Saving...' : 'Save inspection'}
              </button>
            </div>
            {inspectionError && <p role="alert" className="text-sm text-red-700">{inspectionError}</p>}
            {inspectionSuccess && <p role="status" className="text-sm text-[#1d4933]">{inspectionSuccess}</p>}
          </form>
        )}
      </Section>

      <Section title="Action plan" id="officer-action-plans">
        <p className="text-sm leading-6 text-[#68736a]">
          Record planned steps for this assignment. Plans are documentation and do not require approval before work.
        </p>
        {(issue.actionPlans ?? []).length === 0 ? (
          <EmptyState>No action plans have been recorded for this assignment.</EmptyState>
        ) : (
          <ol className="space-y-3">
            {issue.actionPlans.map((plan) => (
              <li key={plan.id} className="rounded-xl border border-[#ece9df] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#34483a]">{plan.officerName || 'Officer'}</p>
                  <time className="text-xs text-[#758077]" dateTime={plan.createdAt}>{formatDate(plan.createdAt)}</time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#526258]">{plan.description}</p>
                {plan.steps?.length > 0 && (
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-[#526258]">
                    {plan.steps.map((step, index) => <li key={`${plan.id}-${index}`}>{step}</li>)}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        )}

        {issue.status === 'RESOLVED' ? (
          <p className="text-sm text-[#68736a]">Action plans are read-only after resolution.</p>
        ) : (
          <form onSubmit={handleActionPlanSubmit} className="space-y-3 border-t border-[#ece9df] pt-4">
            <label htmlFor="officer-action-plan-description" className="block text-sm font-medium text-[#34483a]">
              Describe the planned work
            </label>
            <textarea
              id="officer-action-plan-description"
              value={actionPlanDescription}
              onChange={(event) => {
                setActionPlanDescription(event.target.value);
                setActionPlanError('');
                setActionPlanSuccess('');
              }}
              maxLength={4000}
              required
              rows={4}
              className="w-full rounded-xl border border-[#d9ded5] bg-white px-3 py-2 text-sm text-[#20382a] focus:border-[#477454] focus:outline-none focus:ring-2 focus:ring-[#477454]/20"
              placeholder="Summarize how the team plans to address this issue."
            />
            <div className="space-y-2">
              <p className="text-sm font-medium text-[#34483a]">Action steps (optional)</p>
              {actionPlanSteps.map((step, index) => (
                <div key={`action-step-${index}`} className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`officer-action-plan-step-${index + 1}`}>
                    Action step {index + 1}
                  </label>
                  <input
                    id={`officer-action-plan-step-${index + 1}`}
                    value={step}
                    onChange={(event) => {
                      const { value } = event.target;
                      setActionPlanSteps((current) => current.map((item, itemIndex) =>
                        itemIndex === index ? value : item));
                      setActionPlanError('');
                      setActionPlanSuccess('');
                    }}
                    maxLength={300}
                    className="min-h-10 min-w-0 flex-1 rounded-lg border border-[#d9ded5] bg-white px-3 text-sm text-[#20382a] focus:border-[#477454] focus:outline-none focus:ring-2 focus:ring-[#477454]/20"
                    placeholder={`Step ${index + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => setActionPlanSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="min-h-10 rounded-lg border border-[#cfd8ce] px-3 text-sm font-medium text-[#526258] hover:bg-[#f7faf5]"
                    aria-label={`Remove action step ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setActionPlanSteps((current) => [...current, ''])}
                disabled={actionPlanSteps.length >= 10}
                className="min-h-10 rounded-lg px-3 text-sm font-semibold text-[#1d4933] underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add a step
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[#758077]">{actionPlanDescription.length}/4000 characters</p>
              <button
                type="submit"
                disabled={actionPlanSubmitting || !actionPlanDescription.trim()}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#1d4933] px-4 text-sm font-semibold text-white transition hover:bg-[#163b29] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
              >
                {actionPlanSubmitting ? 'Saving...' : 'Save action plan'}
              </button>
            </div>
            {actionPlanError && <p role="alert" className="text-sm text-red-700">{actionPlanError}</p>}
            {actionPlanSuccess && <p role="status" className="text-sm text-[#1d4933]">{actionPlanSuccess}</p>}
          </form>
        )}
      </Section>

      <Section title="Progress updates" id="officer-progress-updates">
        {issue.progressUpdates.length === 0 ? (
          <EmptyState>No progress updates have been recorded.</EmptyState>
        ) : (
          <ol className="space-y-3">
            {issue.progressUpdates.map((update) => (
              <li key={update.id} className="rounded-xl border border-[#ece9df] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#34483a]">{update.officerName || 'Officer'}</p>
                  <time className="text-xs text-[#758077]" dateTime={update.createdAt}>{formatDate(update.createdAt)}</time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#526258]">{update.message}</p>
              </li>
            ))}
          </ol>
        )}

        {issue.status !== 'IN_PROGRESS' ? (
          <p className="text-sm text-[#68736a]">Start work to record progress updates.</p>
        ) : (
          <form onSubmit={handleProgressSubmit} className="space-y-3 border-t border-[#ece9df] pt-4">
            <label htmlFor="officer-progress-message" className="block text-sm font-medium text-[#34483a]">
              Add a progress update
            </label>
            <textarea
              id="officer-progress-message"
              value={progressMessage}
              onChange={(event) => {
                setProgressMessage(event.target.value);
                setProgressError('');
                setProgressSuccess('');
              }}
              maxLength={2000}
              required
              rows={3}
              className="w-full rounded-xl border border-[#d9ded5] bg-white px-3 py-2 text-sm text-[#20382a] focus:border-[#477454] focus:outline-none focus:ring-2 focus:ring-[#477454]/20"
              placeholder="Describe the work completed or next steps."
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[#758077]">{progressMessage.length}/2000 characters</p>
              <button
                type="submit"
                disabled={progressSubmitting || !progressMessage.trim()}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#1d4933] px-4 text-sm font-semibold text-white transition hover:bg-[#163b29] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
              >
                {progressSubmitting ? 'Saving...' : 'Save update'}
              </button>
            </div>
            {progressError && <p role="alert" className="text-sm text-red-700">{progressError}</p>}
            {progressSuccess && <p role="status" className="text-sm text-[#1d4933]">{progressSuccess}</p>}
          </form>
        )}
      </Section>

      <Section title="Repair evidence for this assignment" id="officer-repair-evidence">
        {evidenceError && !evidence ? (
          <ErrorState onRetry={() => setEvidenceRetry((value) => value + 1)}>{evidenceError}</ErrorState>
        ) : evidenceLoading && !evidence ? (
          <LoadingState>Loading repair evidence...</LoadingState>
        ) : evidenceError ? (
          <ErrorState onRetry={() => setEvidenceRetry((value) => value + 1)}>{evidenceError}</ErrorState>
        ) : evidence?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {evidence.map((item) => (
              <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-[#e5e2d5] focus:outline-none focus:ring-4 focus:ring-[#477454]/20">
                <img src={item.url} alt={`${item.stage.toLowerCase()} repair evidence`} className="h-52 w-full object-cover" />
                <span className="block px-3 py-2 text-xs font-semibold text-[#34483a]">{item.stage} · {formatDate(item.createdAt)}</span>
              </a>
            ))}
          </div>
        ) : (
          <EmptyState>No repair evidence is available for the current assignment.</EmptyState>
        )}
        {issue.status === 'RESOLVED' ? (
          <p className="text-sm text-[#68736a]">Repair evidence is read-only after resolution.</p>
        ) : (
          <form onSubmit={handleEvidenceSubmit} className="space-y-3 border-t border-[#ece9df] pt-4">
            <label htmlFor="officer-repair-evidence-stage" className="block text-sm font-medium text-[#34483a]">
              Evidence stage
            </label>
            <select
              id="officer-repair-evidence-stage"
              value={evidenceStage}
              onChange={(event) => {
                setEvidenceStage(event.target.value);
                setEvidenceUploadError('');
                setEvidenceUploadSuccess('');
              }}
              className="min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 text-sm text-[#24362a] focus:border-[#477454] focus:outline-none focus:ring-2 focus:ring-[#477454]/20"
            >
              <option value="BEFORE">BEFORE</option>
              {issue.status === 'IN_PROGRESS' && <option value="AFTER">AFTER</option>}
            </select>
            <label htmlFor="officer-repair-evidence-photo" className="block text-sm font-medium text-[#34483a]">
              Repair photo
            </label>
            <input
              ref={evidencePhotoInput}
              id="officer-repair-evidence-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                setEvidencePhoto(event.target.files?.[0] ?? null);
                setEvidenceUploadError('');
                setEvidenceUploadSuccess('');
              }}
              required
              className="min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 py-2 text-sm text-[#24362a] file:mr-3 file:rounded-lg file:border-0 file:bg-[#edf2eb] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[#1d4933]"
            />
            <button
              type="submit"
              disabled={evidenceUploading || !evidencePhoto}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#1d4933] px-4 text-sm font-semibold text-white transition hover:bg-[#163b29] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {evidenceUploading ? 'Uploading...' : `Upload ${evidenceStage.toLowerCase()} photo`}
            </button>
            {evidenceUploadError && <p role="alert" className="text-sm text-red-700">{evidenceUploadError}</p>}
            {evidenceUploadSuccess && <p role="status" className="text-sm text-[#1d4933]">{evidenceUploadSuccess}</p>}
          </form>
        )}
      </Section>

      <Section title="Resolution" id="officer-resolution">
        {issue.resolutions.length > 0 ? (
          <ol className="space-y-3">
            {issue.resolutions.map((resolution) => (
              <li key={resolution.id} className="rounded-xl border border-[#ece9df] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#34483a]">
                    Submitted by {resolution.officerName || 'Officer'}
                  </p>
                  <time className="text-xs text-[#758077]" dateTime={resolution.createdAt}>
                    {formatDate(resolution.createdAt)}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#526258]">{resolution.summary}</p>
                <p className="mt-2 text-xs text-[#758077]">
                  Includes BEFORE evidence #{resolution.beforeEvidenceId} and AFTER evidence #{resolution.afterEvidenceId}.
                </p>
              </li>
            ))}
          </ol>
        ) : issue.status === 'IN_PROGRESS' ? (
          <EmptyState>Submit a resolution after uploading both BEFORE and AFTER repair photos.</EmptyState>
        ) : (
          <EmptyState>No resolution has been submitted.</EmptyState>
        )}

        {issue.status === 'IN_PROGRESS' && (
          <form onSubmit={handleResolutionSubmit} className="space-y-3 border-t border-[#ece9df] pt-4">
            <label htmlFor="officer-resolution-summary" className="block text-sm font-medium text-[#34483a]">
              Resolution summary
            </label>
            <textarea
              id="officer-resolution-summary"
              value={resolutionSummary}
              onChange={(event) => {
                setResolutionSummary(event.target.value);
                setResolutionError('');
                setResolutionSuccess('');
              }}
              maxLength={2000}
              required
              rows={4}
              className="w-full rounded-xl border border-[#d9ded5] bg-white px-3 py-2 text-sm text-[#20382a] focus:border-[#477454] focus:outline-none focus:ring-2 focus:ring-[#477454]/20"
              placeholder="Describe the repair completed and the outcome."
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[#758077]">{resolutionSummary.length}/2000 characters</p>
              <button
                type="submit"
                disabled={resolutionSubmitting || !resolutionSummary.trim()}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#1d4933] px-4 text-sm font-semibold text-white transition hover:bg-[#163b29] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
              >
                {resolutionSubmitting ? 'Submitting...' : 'Submit resolution'}
              </button>
            </div>
            {resolutionError && <p role="alert" className="text-sm text-red-700">{resolutionError}</p>}
          </form>
        )}
        {resolutionSuccess && <p role="status" className="text-sm text-[#1d4933]">{resolutionSuccess}</p>}
      </Section>

      <Section title="Issue timeline" id="officer-issue-timeline">
        {timelineError && !timeline ? (
          <ErrorState onRetry={() => setTimelineRetry((value) => value + 1)}>{timelineError}</ErrorState>
        ) : timelineLoading && !timeline ? (
          <LoadingState>Loading issue timeline...</LoadingState>
        ) : timelineError ? (
          <ErrorState onRetry={() => setTimelineRetry((value) => value + 1)}>{timelineError}</ErrorState>
        ) : !timeline?.length ? (
          <EmptyState>No timeline events are available.</EmptyState>
        ) : (
          <ol className="space-y-5">
            {timeline.map((event) => (
              <li key={event.id} className="relative min-w-0 border-l border-[#d9ded5] pl-5 last:border-transparent">
                <span aria-hidden="true" className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-[#1d4933] ring-2 ring-white" />
                <h3 className="break-words text-sm font-semibold text-[#34483a]">{eventTitle(event)}</h3>
                <p className="mt-1 text-xs text-[#68736a]">
                  {event.actorType || 'System'}
                  {event.actorName ? ` · ${event.actorName}` : ''}
                  {event.team ? ` · ${event.team}` : ''}
                  {event.evidenceStage ? ` · ${event.evidenceStage} evidence` : ''}
                </p>
                {event.reason && <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-[#526258]">{event.reason}</p>}
                <time dateTime={event.createdAt} className="mt-1 block text-xs text-[#758077]">{formatDate(event.createdAt)}</time>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
