import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAiAssessment, getComplaint, getComplaintTimeline, getResolution, submitResolutionVerification } from '../../api/complaints.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState, Skeleton } from '../../components/AsyncState.jsx';
import StatusBadge from '../../components/citizen/StatusBadge.jsx';
import IssueTimeline from '../../components/citizen/IssueTimeline.jsx';
import { requestOnce } from '../../utils/requestOnce.js';
import { useAuth } from '../../context/AuthContext.jsx';

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function InfoField({ label, children }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-[#758077]">{label}</dt><dd className="mt-1 break-words text-sm text-[#24362a]">{children}</dd></div>;
}

function AssessmentPanel({ assessment, isLoading, error, onRefresh }) {
  return (
    <section aria-labelledby="assessment-heading" className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Automated review</p><h2 id="assessment-heading" className="mt-1 text-xl font-semibold text-[#20382a]">AI assessment</h2></div>
        <button type="button" onClick={onRefresh} disabled={isLoading} className="min-h-10 rounded-lg border border-[#cfd8ce] px-3 text-sm font-semibold text-[#1d4933] hover:bg-[#f7faf5] focus:outline-none focus:ring-2 focus:ring-[#477454]/30 disabled:opacity-60">{isLoading ? 'Checking...' : 'Refresh assessment'}</button>
      </div>
      {isLoading && !assessment ? <LoadingState>Loading AI assessment...</LoadingState> : error && !assessment ? <ErrorState onRetry={onRefresh}>We could not load the AI assessment. {error}</ErrorState> : !assessment ? <EmptyState>Assessment information is not available.</EmptyState> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={assessment.status} />{assessment.updatedAt && <span className="text-xs text-[#758077]">Updated {formatDate(assessment.updatedAt)}</span>}</div>
          {assessment.status === 'PENDING' && <p className="text-sm leading-6 text-[#68736a]">Your report is waiting for assessment.</p>}
          {assessment.status === 'PROCESSING' && <p role="status" className="text-sm leading-6 text-[#68736a]">The assessment is in progress. Refresh this section to check for an update.</p>}
          {assessment.status === 'FAILED' && <p className="text-sm leading-6 text-[#8b3c2d]">{assessment.message || 'The AI assessment could not be completed.'}</p>}
          {assessment.status === 'SUCCEEDED' && (
            <>
              <dl className="grid gap-4 sm:grid-cols-2">
                <InfoField label="Category">{assessment.category?.replaceAll('_', ' ')}</InfoField>
                <InfoField label="Department">{assessment.department}</InfoField>
                <InfoField label="Severity">{assessment.severity}</InfoField>
                <InfoField label="Confidence">{Number.isFinite(assessment.confidence) ? `${Math.round(assessment.confidence * 100)}%` : 'Not provided'}</InfoField>
              </dl>
              {assessment.severity_reason && <div><h3 className="text-sm font-semibold text-[#34483a]">Severity explanation</h3><p className="mt-1 text-sm leading-6 text-[#526258]">{assessment.severity_reason}</p></div>}
              {Array.isArray(assessment.risk_factors) && assessment.risk_factors.length > 0 && <div><h3 className="text-sm font-semibold text-[#34483a]">Risk factors</h3><ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[#526258]">{assessment.risk_factors.map((factor, index) => <li key={`${factor}-${index}`}>{factor}</li>)}</ul></div>}
              {assessment.human_review_required && <p className="rounded-xl border border-[#e7d9b4] bg-[#fff9e9] px-4 py-3 text-sm leading-6 text-[#725a23]">Human review required{assessment.human_review_reason ? `: ${assessment.human_review_reason}` : '.'}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ResolutionPanel({ complaintId, issueStatus, resolution, isLoading, error, onRefresh, onVerified }) {
  const [decision, setDecision] = useState('CONFIRM');
  const [reason, setReason] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleVerification(event) {
    event.preventDefault();
    setSubmitError('');
    const payload = decision === 'CONFIRM'
      ? { decision: 'CONFIRM' }
      : { decision: 'DISPUTE', reason: reason.trim() };
    if (decision === 'DISPUTE' && (!payload.reason || payload.reason.length > 2000)) {
      setSubmitError('Enter a dispute reason of 1 to 2000 characters.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await submitResolutionVerification(complaintId, payload);
      onVerified(result.verification);
    } catch (requestError) {
      setSubmitError(getApiErrorMessage(requestError, 'We could not submit your response. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="resolution-heading" className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Work progress</p><h2 id="resolution-heading" className="mt-1 text-xl font-semibold text-[#20382a]">Resolution tracking</h2></div>
        {issueStatus === 'RESOLVED' && <button type="button" onClick={onRefresh} disabled={isLoading} className="min-h-10 rounded-lg border border-[#cfd8ce] px-3 text-sm font-semibold text-[#1d4933] hover:bg-[#f7faf5] focus:outline-none focus:ring-2 focus:ring-[#477454]/30 disabled:opacity-60">{isLoading ? 'Loading...' : 'Refresh resolution'}</button>}
      </div>
      {issueStatus !== 'RESOLVED' ? (
        <p className="text-sm leading-6 text-[#68736a]">Resolution evidence and citizen verification will be available when the civic issue is marked resolved. Current issue status: <span className="font-semibold">{issueStatus?.replaceAll('_', ' ') ?? 'Unavailable'}</span>.</p>
      ) : isLoading && !resolution ? (
        <LoadingState>Loading resolution evidence...</LoadingState>
      ) : error && !resolution ? (
        <ErrorState onRetry={onRefresh}>Resolution information could not be loaded. {error}</ErrorState>
      ) : !resolution ? (
        <EmptyState>Resolution information is not available.</EmptyState>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={resolution.issue?.status} />{resolution.review && <span className="text-sm text-[#68736a]">Admin review: {resolution.review.decision.toLowerCase()}</span>}</div>
          <div>
            <h3 className="text-sm font-semibold text-[#34483a]">Repair evidence</h3>
            {Array.isArray(resolution.evidence) && resolution.evidence.length > 0 ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{resolution.evidence.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-[#e5e2d5] focus:outline-none focus:ring-4 focus:ring-[#477454]/20"><img src={item.url} alt={`${item.stage.toLowerCase()} repair evidence`} className="h-48 w-full object-cover" /><span className="block px-3 py-2 text-xs font-semibold text-[#34483a]">{item.stage} · {formatDate(item.createdAt)}</span></a>)}</div>
            ) : <p className="mt-2 text-sm text-[#68736a]">No repair photos were returned.</p>}
          </div>
          {resolution.myVerification ? (
            <p role="status" className="rounded-xl border border-[#d4e2d3] bg-[#f2f8f1] px-4 py-3 text-sm leading-6 text-[#385743]">You submitted “{resolution.myVerification.decision.toLowerCase()}” on {formatDate(resolution.myVerification.submittedAt)}.</p>
          ) : resolution.review ? (
            <p className="rounded-xl border border-[#e7d9b4] bg-[#fff9e9] px-4 py-3 text-sm leading-6 text-[#725a23]">This issue has a final admin review, so a new verification response is not available.</p>
          ) : (
            <form onSubmit={handleVerification} className="space-y-4 border-t border-[#edf0e9] pt-5">
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-[#34483a]">Has this issue been resolved?</legend>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[#34483a]"><input type="radio" name="verification-decision" value="CONFIRM" checked={decision === 'CONFIRM'} onChange={() => setDecision('CONFIRM')} className="h-4 w-4 accent-[#1d4933]" />Yes, I confirm the resolution</label>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[#34483a]"><input type="radio" name="verification-decision" value="DISPUTE" checked={decision === 'DISPUTE'} onChange={() => setDecision('DISPUTE')} className="h-4 w-4 accent-[#1d4933]" />No, I want to dispute the resolution</label>
              </fieldset>
              {decision === 'DISPUTE' && <div><label htmlFor="verification-reason" className="mb-2 block text-sm font-medium text-[#34483a]">Reason for dispute</label><textarea id="verification-reason" required minLength={1} maxLength={2000} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-xl border border-[#d9ded5] px-4 py-3 text-sm leading-6 outline-none focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" placeholder="Describe what remains unresolved." /><p className="mt-1 text-right text-xs text-[#758077]">{reason.length}/2000</p></div>}
              {submitError && <p role="alert" className="rounded-xl border border-[#e9c9c2] bg-[#fff5f2] px-4 py-3 text-sm text-[#8b3c2d]">{submitError}</p>}
              <button type="submit" disabled={isSubmitting} className="min-h-11 rounded-xl bg-[#1d4933] px-5 text-sm font-semibold text-white transition hover:bg-[#163b29] focus:outline-none focus:ring-4 focus:ring-[#477454]/25 disabled:cursor-wait disabled:opacity-60">{isSubmitting ? 'Sending response...' : 'Send response'}</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

export default function ComplaintDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const [complaint, setComplaint] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [timeline, setTimeline] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');
  const [timelineRetry, setTimelineRetry] = useState(0);
  const [assessment, setAssessment] = useState(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentError, setAssessmentError] = useState('');
  const [assessmentRetry, setAssessmentRetry] = useState(0);
  const assessmentRequestSequence = useRef(0);
  const [resolution, setResolution] = useState(null);
  const [resolutionLoading, setResolutionLoading] = useState(false);
  const [resolutionError, setResolutionError] = useState('');
  const [resolutionRetry, setResolutionRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError('');
    setComplaint(null);
    setTimeline(null);
    setTimelineError('');
    setAssessment(null);
    setAssessmentError('');
    setResolution(null);
    setResolutionError('');
    requestOnce(`citizen:${user?.id}:complaint:${id}:${retry}`, () => getComplaint(id))
      .then((result) => { if (active) setComplaint(result.complaint); })
      .catch((requestError) => { if (active) setError(getApiErrorMessage(requestError, 'We could not load this complaint.')); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [id, retry, user?.id]);

  useEffect(() => {
    if (!complaint) return undefined;
    let active = true;
    setTimelineLoading(true);
    setTimelineError('');
    requestOnce(`citizen:${user?.id}:timeline:${id}:${timelineRetry}`, () => getComplaintTimeline(id))
      .then((result) => { if (active) setTimeline(Array.isArray(result.items) ? result.items : []); })
      .catch((requestError) => { if (active) setTimelineError(getApiErrorMessage(requestError, 'Complaint timeline could not be loaded.')); })
      .finally(() => { if (active) setTimelineLoading(false); });
    return () => { active = false; };
  }, [complaint, id, timelineRetry, user?.id]);

  useEffect(() => {
    if (!complaint) return undefined;
    let active = true;
    const sequence = ++assessmentRequestSequence.current;
    setAssessmentLoading(true);
    setAssessmentError('');
    requestOnce(`citizen:${user?.id}:assessment:${id}:${assessmentRetry}`, () => getAiAssessment(id))
      .then((result) => { if (active && sequence === assessmentRequestSequence.current) setAssessment(result.assessment); })
      .catch((requestError) => { if (active && sequence === assessmentRequestSequence.current) setAssessmentError(getApiErrorMessage(requestError, 'Assessment information could not be loaded.')); })
      .finally(() => { if (active && sequence === assessmentRequestSequence.current) setAssessmentLoading(false); });
    return () => { active = false; };
  }, [complaint, id, assessmentRetry, user?.id]);

  useEffect(() => {
    if (!assessment || !['PENDING', 'PROCESSING'].includes(assessment.status)) return undefined;
    const timer = window.setTimeout(() => {
      setAssessmentRetry((value) => value + 1);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [assessment]);

  useEffect(() => {
    if (!complaint || complaint.issueStatus !== 'RESOLVED') {
      setResolution(null);
      setResolutionError('');
      setResolutionLoading(false);
      return undefined;
    }
    let active = true;
    setResolutionLoading(true);
    setResolutionError('');
    requestOnce(`citizen:${user?.id}:resolution:${id}:${resolutionRetry}`, () => getResolution(id))
      .then((result) => { if (active) setResolution(result.resolution); })
      .catch((requestError) => { if (active) setResolutionError(getApiErrorMessage(requestError, 'Resolution information could not be loaded.')); })
      .finally(() => { if (active) setResolutionLoading(false); });
    return () => { active = false; };
  }, [complaint, id, resolutionRetry, user?.id]);

  function updateVerification(verification) {
    setResolution((current) => current ? {
      ...current,
      myVerification: { decision: verification.decision, submittedAt: verification.submittedAt }
    } : current);
  }

  if (isLoading) return (
    <div className="mx-auto max-w-3xl space-y-4" aria-label="Loading complaint details">
      <div className="rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm sm:p-6">
        <Skeleton className="h-3 w-28" /><Skeleton className="mt-3 h-8 w-3/4" /><Skeleton className="mt-4 h-4 w-full" /><Skeleton className="mt-2 h-4 w-5/6" />
        <div className="mt-6 grid grid-cols-2 gap-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      </div>
      <Skeleton className="h-40" />
    </div>
  );
  if (error || !complaint) return <div className="space-y-4"><Link to="/citizen/complaints" className="text-sm font-semibold text-[#1d4933] underline underline-offset-4">Back to complaints</Link><ErrorState onRetry={() => setRetry((value) => value + 1)}>{error || 'Complaint not found.'}</ErrorState></div>;

  const mapsUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(complaint.latitude)}&mlon=${encodeURIComponent(complaint.longitude)}#map=17/${encodeURIComponent(complaint.latitude)}/${encodeURIComponent(complaint.longitude)}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/citizen/complaints" className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-semibold text-[#1d4933] underline decoration-[#d4ae58] underline-offset-4 focus:outline-none focus:ring-2 focus:ring-[#477454]/30">Back to complaints</Link>
        <Link to="/citizen/complaints/new" className="inline-flex min-h-10 items-center rounded-lg bg-[#1d4933] px-4 text-sm font-semibold text-white hover:bg-[#163b29] focus:outline-none focus:ring-4 focus:ring-[#477454]/25">Report another issue</Link>
      </div>

      <article className="space-y-5 rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-[#758077]">Complaint #{complaint.id} · Submitted {formatDate(complaint.createdAt)}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#20382a] sm:text-3xl">{complaint.title}</h1></div>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#526258]">{complaint.description}</p>
        <dl className="grid gap-4 border-t border-[#edf0e9] pt-5 sm:grid-cols-3">
          <InfoField label="Civic issue status">{complaint.issueStatus ? <StatusBadge status={complaint.issueStatus} /> : 'Unavailable'}</InfoField>
          <InfoField label="Community reports">{complaint.reportCount ?? 'Unavailable'}</InfoField>
          <InfoField label="Your complaint status">{complaint.status ? <StatusBadge status={complaint.status} /> : 'Unavailable'}</InfoField>
        </dl>
      </article>

      
<section
  aria-labelledby="location-heading"
  className="overflow-hidden rounded-2xl border border-[#e2e8df] bg-white shadow-sm"
>
  {/* Header */}
  <div className="flex items-center gap-3 border-b border-[#edf0e9] bg-[#f8faf6] px-5 py-4 sm:px-6">
    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e6efe5] text-[#245638]">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    </div>

    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#9a7832]">
        Location details
      </p>
      <h2
        id="location-heading"
        className="mt-0.5 text-lg font-bold text-[#244632]"
      >
        Where it happened
      </h2>
    </div>
  </div>

  {/* Address */}
  <div className="space-y-5 p-5 sm:p-6">
    <div className="rounded-xl border border-[#e5eadf] bg-[#f8faf6] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#39734c] shadow-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#788579]">
            Complaint address
          </p>
          <p className="mt-1.5 break-words text-sm font-semibold leading-6 text-[#263d2d] sm:text-base">
            {complaint.address || 'Address was not recorded for this complaint.'}
          </p>
        </div>
      </div>
    </div>

    {/* Coordinates */}
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#788579]">
        GPS coordinates
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[#edf0e9] p-4">
          <p className="text-xs font-medium text-[#788579]">Latitude</p>
          <p className="mt-1 break-all font-mono text-sm font-semibold text-[#294c35]">
            {complaint.latitude ?? 'Not available'}
          </p>
        </div>

        <div className="rounded-xl border border-[#edf0e9] p-4">
          <p className="text-xs font-medium text-[#788579]">Longitude</p>
          <p className="mt-1 break-all font-mono text-sm font-semibold text-[#294c35]">
            {complaint.longitude ?? 'Not available'}
          </p>
        </div>
      </div>
    </div>

    {/* Accuracy */}
    {complaint.locationAccuracyMeters != null && (
      <div className="flex items-center gap-2 text-xs text-[#68776b]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4 shrink-0 text-[#477454]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="12" cy="12" r="8" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5" />
        </svg>
        Location accuracy: approximately{' '}
        {Math.round(complaint.locationAccuracyMeters)} metres
      </div>
    )}

    {/* Map button */}
    <a
      href={mapsUrl}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#245638] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#193f28] focus:outline-none focus:ring-2 focus:ring-[#477454]/40 focus:ring-offset-2"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 18 3 21V6l6-3m0 15 6 3m-6-3V3m6 18 6-3V3l-6 3m0 15V6" />
      </svg>
      View location on Maps
      <span aria-hidden="true">↗</span>
    </a>
  </div>
</section>


      <section aria-labelledby="photos-heading" className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm sm:p-6">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Attached media</p></div>
        {Array.isArray(complaint.media) && complaint.media.length > 0 ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{complaint.media.map((media) => <a key={media.id} href={media.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-[#e5e2d5] focus:outline-none focus:ring-4 focus:ring-[#477454]/20"><img src={media.url} alt={`Photo attached to complaint ${complaint.id}`} className="h-56 w-full object-cover" /><span className="block px-3 py-2 text-xs text-[#68736a]">{media.mimeType} · {Math.ceil(media.byteSize / 1024)} KB</span></a>)}</div> : <EmptyState>No complaint photo was returned.</EmptyState>}
      </section>

      <IssueTimeline items={timeline} isLoading={timelineLoading} error={timelineError} onRetry={() => setTimelineRetry((value) => value + 1)} />
      <AssessmentPanel assessment={assessment} isLoading={assessmentLoading} error={assessmentError} onRefresh={() => setAssessmentRetry((value) => value + 1)} />
      <ResolutionPanel complaintId={id} issueStatus={complaint.issueStatus} resolution={resolution} isLoading={resolutionLoading} error={resolutionError} onRefresh={() => setResolutionRetry((value) => value + 1)} onVerified={updateVerification} />
    </div>
  );
}
