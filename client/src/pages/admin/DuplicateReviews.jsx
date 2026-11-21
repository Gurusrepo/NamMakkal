import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import {
  approveDuplicate,
  assessDuplicate,
  listDuplicateCandidates,
  rejectDuplicate
} from '../../api/admin.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';

const PAGE_LIMIT = 20;
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'STALE'];

function humanize(value) {
  return value ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown';
}

export default function DuplicateReviews() {
  const [status, setStatus] = useState('PENDING');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [actionId, setActionId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [rejectionReasons, setRejectionReasons] = useState({});

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');
    listDuplicateCandidates({ limit: PAGE_LIMIT, offset, status })
      .then((result) => {
        if (!active) return;
        setItems(result.items ?? []);
        setHasMore(Boolean(result.pagination?.hasMore));
      })
      .catch((error) => { if (active) setLoadError(getApiErrorMessage(error, 'Duplicate candidates could not be loaded.')); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [status, offset, retry]);

  async function performAction(id, action) {
    setActionId(id);
    setActionError('');
    try {
      await action();
      setRetry((value) => value + 1);
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'The duplicate review could not be completed.'));
    } finally {
      setActionId(null);
    }
  }

  function handleReject(item) {
    const reason = rejectionReasons[item.suggestionId]?.trim() ?? '';
    if (!reason) {
      setActionError(`Enter a rejection reason for candidate #${item.suggestionId}.`);
      return;
    }
    if (reason.length > 500) {
      setActionError('Rejection reasons must be 500 characters or fewer.');
      return;
    }
    performAction(item.suggestionId, () => rejectDuplicate(item.suggestionId, { reason }));
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Issue integrity</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#20382a]">Duplicate review</h1>
        <p className="mt-2 text-sm leading-6 text-[#68736a]">Review system-generated candidates. Approval preserves the selected issue as canonical and records the merge history.</p>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <label className="max-w-xs text-sm font-medium text-[#34483a]">Candidate status
          <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3">
            {STATUSES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setRetry((value) => value + 1)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-[#1d4933] hover:bg-[#f7f6ef]">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </section>

      {actionError && <p role="alert" className="rounded-xl border border-[#e9c9c2] bg-[#fff5f2] px-4 py-3 text-sm text-[#8b3c2d]">{actionError}</p>}
      {isLoading ? <LoadingState>Loading duplicate candidates…</LoadingState> : loadError ? <ErrorState onRetry={() => setRetry((value) => value + 1)}>{loadError}</ErrorState> : items.length === 0 ? <EmptyState>No candidates have this status.</EmptyState> : (
        <section className="space-y-4">
          {items.map((item) => {
            const pending = item.status === 'PENDING';
            const score = Math.round((item.score ?? 0) * 100);
            return (
              <article key={item.suggestionId} className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-[#68736a]">Candidate #{item.suggestionId}</p>
                    <h2 className="mt-1 text-lg font-semibold text-[#20382a]">Issue #{item.issueA.id} and issue #{item.issueB.id}</h2>
                  </div>
                  <span className="rounded-full bg-[#f3f0e5] px-3 py-1 text-xs font-semibold text-[#5b624c]">{humanize(item.status)}</span>
                </header>

                <div className="grid gap-3 sm:grid-cols-2">
                  {[item.issueA, item.issueB].map((issue, index) => (
                    <div key={issue.id} className="rounded-xl bg-[#f7f6ef] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#68736a]">Issue {index === 0 ? 'A' : 'B'} · #{issue.id}</p>
                      <p className="mt-2 text-sm text-[#34483a]">Status: {humanize(issue.status)}</p>
                      <p className="mt-1 text-sm text-[#34483a]">Categories: {issue.categorySummary.categories.length
                        ? issue.categorySummary.categories.map(({ category, count }) => `${humanize(category)} (${count})`).join(', ')
                        : 'No successful assessments'}</p>
                      <p className="mt-1 text-xs text-[#68736a]">Category signal: {humanize(issue.categorySummary.status)}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#e5e2d5] p-4">
                    <p className="text-sm font-semibold text-[#20382a]">Deterministic match · {score}%</p>
                    <p className="mt-1 text-xs leading-5 text-[#68736a]">
                      {item.signals.distanceMeters} m apart · {item.signals.timeDifferenceHours} hours apart · category signal {humanize(item.signals.categoryStatus)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#e5e2d5] p-4">
                    <p className="text-sm font-semibold text-[#20382a]">AI review</p>
                    {item.aiAssessment ? (
                      <>
                        <p className="mt-1 text-sm text-[#34483a]">{humanize(item.aiAssessment.result)} · {Math.round(item.aiAssessment.confidence * 100)}% confidence</p>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#68736a]">{item.aiAssessment.rationale}</p>
                      </>
                    ) : <p className="mt-1 text-sm text-[#68736a]">No AI review yet.</p>}
                  </div>
                </div>

                {pending && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={actionId !== null} onClick={() => performAction(item.suggestionId, () => assessDuplicate(item.suggestionId))} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#d9ded5] px-4 text-sm font-semibold text-[#34483a] disabled:opacity-50">
                        <Sparkles className="h-4 w-4" aria-hidden="true" /> {actionId === item.suggestionId ? 'Assessing...' : actionError ? 'Retry AI assessment' : 'Assess with AI'}
                      </button>
                      <button type="button" disabled={actionId !== null} onClick={() => performAction(item.suggestionId, () => approveDuplicate(item.suggestionId, { canonicalIssueId: item.issueA.id }))} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1d4933] px-4 text-sm font-semibold text-white disabled:opacity-50">
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Keep issue #{item.issueA.id}
                      </button>
                      <button type="button" disabled={actionId !== null} onClick={() => performAction(item.suggestionId, () => approveDuplicate(item.suggestionId, { canonicalIssueId: item.issueB.id }))} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1d4933] px-4 text-sm font-semibold text-white disabled:opacity-50">
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Keep issue #{item.issueB.id}
                      </button>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input value={rejectionReasons[item.suggestionId] ?? ''} maxLength={500} onChange={(event) => setRejectionReasons((current) => ({ ...current, [item.suggestionId]: event.target.value }))} placeholder="Reason for rejecting this candidate" aria-label={`Rejection reason for candidate ${item.suggestionId}`} className="min-h-11 flex-1 rounded-xl border border-[#d9ded5] px-3 text-sm" />
                      <button type="button" disabled={actionId !== null} onClick={() => handleReject(item)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-800 disabled:opacity-50">
                        <XCircle className="h-4 w-4" aria-hidden="true" /> Reject candidate
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
          <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3">
            <span className="text-xs text-[#68736a]">Page {Math.floor(offset / PAGE_LIMIT) + 1}</span>
            <div className="flex gap-2">
              <button type="button" disabled={offset === 0 || isLoading} onClick={() => setOffset((value) => Math.max(0, value - PAGE_LIMIT))} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#d9ded5] px-3 text-sm disabled:opacity-50"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous</button>
              <button type="button" disabled={!hasMore || isLoading} onClick={() => setOffset((value) => value + PAGE_LIMIT)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#d9ded5] px-3 text-sm disabled:opacity-50">Next <ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
