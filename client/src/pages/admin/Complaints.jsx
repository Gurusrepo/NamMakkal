import { useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Eye, RefreshCw, X } from 'lucide-react';
import {
  assignIssueTeam,
  getCivicIssue,
  listCivicIssues,
  listTeams,
  listWards,
  reassignIssueTeam,
  unassignIssueTeam
} from '../../api/admin.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';

const PAGE_LIMIT = 20;
const STATUSES = ['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'MERGED'];
const CATEGORIES = ['ROAD_DAMAGE', 'WATER_SUPPLY', 'DRAINAGE', 'WASTE_MANAGEMENT', 'STREETLIGHT', 'PUBLIC_HEALTH', 'PUBLIC_PROPERTY', 'OTHER'];
const DEPARTMENTS = ['Roads & Infrastructure', 'Water Supply', 'Drainage', 'Sanitation', 'Electricity', 'Public Health', 'Public Works', 'General Administration'];

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function humanize(value) {
  return value ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : '—';
}

function ComplaintDetails({ issue, onClose, onRefresh }) {
  const [teams, setTeams] = useState([]);
  const [teamsError, setTeamsError] = useState('');
  const [teamsRetry, setTeamsRetry] = useState(0);
  const [teamId, setTeamId] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setTeamsError('');
    listTeams()
      .then((result) => { if (active) setTeams(result.items ?? []); })
      .catch((error) => { if (active) setTeamsError(getApiErrorMessage(error, 'Ward teams could not be loaded.')); });
    return () => { active = false; };
  }, [teamsRetry]);

  useEffect(() => {
    setTeamId(issue.currentTeamAssignment?.teamId ? String(issue.currentTeamAssignment.teamId) : '');
    setActionError('');
    setActionMessage('');
  }, [issue.id, issue.currentTeamAssignment?.teamId]);

  const selectedTeam = teams.find((team) => String(team.id) === teamId);
  const isAssigned = Boolean(issue.currentTeamAssignment);
  const workflowLocked = issue.status === 'IN_PROGRESS' || issue.status === 'MERGED';

  async function handleAssignment(event) {
    event.preventDefault();
    if (!selectedTeam) {
      setActionError('Choose an active ward team.');
      return;
    }
    setIsSaving(true);
    setActionError('');
    setActionMessage('');
    try {
      const payload = { teamId: selectedTeam.id, routingDepartment: selectedTeam.department };
      if (isAssigned) await reassignIssueTeam(issue.id, payload);
      else await assignIssueTeam(issue.id, payload);
      setActionMessage(isAssigned ? 'Issue reassigned successfully.' : 'Issue assigned successfully.');
      onRefresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Team assignment could not be saved.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnassign() {
    setIsSaving(true);
    setActionError('');
    setActionMessage('');
    try {
      await unassignIssueTeam(issue.id);
      setActionMessage('Issue was removed from its current team.');
      onRefresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Team assignment could not be removed.'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="complaint-detail-title">
      <section className="my-auto w-full max-w-5xl rounded-2xl bg-[#f7f6ef] shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 rounded-t-2xl bg-[#173d2b] px-5 py-4 text-white">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#e2c77f]">Civic issue #{issue.id}</p>
            <h2 id="complaint-detail-title" className="mt-1 text-xl font-semibold">{humanize(issue.status)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close issue details" className="rounded-lg p-2 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-5 p-4 sm:p-6">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><p className="text-xs text-[#68736a]">Citizen reports</p><p className="mt-1 text-lg font-semibold text-[#20382a]">{issue.reportCount}</p></div>
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><p className="text-xs text-[#68736a]">Current team</p><p className="mt-1 font-semibold text-[#20382a]">{issue.currentTeamAssignment?.teamName ?? 'Unassigned'}</p></div>
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><p className="text-xs text-[#68736a]">Department</p><p className="mt-1 font-semibold text-[#20382a]">{issue.currentTeamAssignment?.department ?? issue.aiAssessmentSummary?.latestSuccessfulComplaintAssessment?.department ?? '—'}</p></div>
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><p className="text-xs text-[#68736a]">Updated</p><p className="mt-1 font-semibold text-[#20382a]">{formatDate(issue.updatedAt)}</p></div>
          </section>

          <section className="rounded-xl border border-[#e5e2d5] bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="font-semibold text-[#20382a]">Ward team assignment</h3>
                <p className="mt-1 text-sm text-[#68736a]">Assignments are checked and recorded by the existing team-routing workflow.</p>
              </div>
              <p className="text-sm text-[#68736a]">{issue.currentTeamAssignment?.ward?.name ?? 'No ward assigned'}</p>
            </div>
            <form onSubmit={handleAssignment} className="mt-4 flex flex-col gap-3 sm:flex-row">
              <label className="flex-1 text-sm font-medium text-[#34483a]">
                Ward team
                <select value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={workflowLocked || isSaving} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 text-sm">
                  <option value="">Select a team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.ward.name} · {team.name} · {team.department}</option>)}
                </select>
              </label>
              <button type="submit" disabled={workflowLocked || isSaving || !teamId || (isAssigned && Number(teamId) === issue.currentTeamAssignment.teamId)} className="min-h-11 self-end rounded-xl bg-[#1d4933] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {isSaving ? 'Saving…' : isAssigned ? 'Reassign issue' : 'Assign issue'}
              </button>
              {isAssigned && <button type="button" onClick={handleUnassign} disabled={workflowLocked || isSaving} className="min-h-11 self-end rounded-xl border border-[#d9ded5] px-4 text-sm font-semibold text-[#34483a] disabled:opacity-50">Unassign</button>}
            </form>
            {teamsError && <div className="mt-3"><ErrorState onRetry={() => setTeamsRetry((value) => value + 1)}>{teamsError}</ErrorState></div>}
            {workflowLocked && <p className="mt-2 text-xs text-[#68736a]">Team assignment cannot be changed while work is in progress or after an issue is merged.</p>}
            {actionError && <p role="alert" className="mt-3 rounded-lg bg-[#fff5f2] px-3 py-2 text-sm text-[#8b3c2d]">{actionError}</p>}
            {actionMessage && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{actionMessage}</p>}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[#20382a]">Associated citizen reports</h3>
              <span className="text-xs text-[#68736a]">Personal contact details are not shown.</span>
            </div>
            {issue.linkedComplaints.length === 0 ? <EmptyState>No citizen reports are linked to this issue.</EmptyState> : issue.linkedComplaints.map((complaint) => (
              <article key={complaint.complaintId} className="space-y-4 rounded-xl border border-[#e5e2d5] bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-[#68736a]">Report #{complaint.complaintId} · {formatDate(complaint.createdAt)}</p>
                    <h4 className="mt-1 font-semibold text-[#20382a]">{complaint.title}</h4>
                  </div>
                  <span className="rounded-full bg-[#f3f0e5] px-3 py-1 text-xs font-semibold text-[#5b624c]">{humanize(complaint.status)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#4f5d52]">{complaint.description}</p>
                <div className="rounded-lg bg-[#f7f6ef] p-3 text-sm">
                  <p className="font-semibold text-[#34483a]">Location</p>
                  <p className="mt-1 text-[#68736a]">{complaint.address || 'Address not provided'}</p>
                  <p className="mt-1 text-xs text-[#68736a]">
                    {complaint.location.latitude.toFixed(5)}, {complaint.location.longitude.toFixed(5)}
                    {complaint.location.accuracyMeters ? ` · Accuracy ${Math.round(complaint.location.accuracyMeters)} m` : ''}
                  </p>
                </div>
                {complaint.media.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {complaint.media.map((media) => (
                      <a key={media.id} href={media.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-[#e5e2d5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]">
                        <img src={media.url} alt={`Photo for report ${complaint.complaintId}`} loading="lazy" className="h-36 w-full object-cover" />
                        <span className="block px-2 py-1 text-xs text-[#68736a]">Open photo · {Math.ceil(media.byteSize / 1024)} KB</span>
                      </a>
                    ))}
                  </div>
                )}
                {complaint.aiAssessment && (
                  <div className="rounded-lg border border-[#e7e5dc] p-3">
                    <h5 className="text-sm font-semibold text-[#20382a]">AI assessment · {humanize(complaint.aiAssessment.status)}</h5>
                    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-[#68736a]">Category</dt><dd className="text-[#34483a]">{humanize(complaint.aiAssessment.category)}</dd></div>
                      <div><dt className="text-xs text-[#68736a]">Department</dt><dd className="text-[#34483a]">{complaint.aiAssessment.department || '—'}</dd></div>
                      <div><dt className="text-xs text-[#68736a]">Severity</dt><dd className="text-[#34483a]">{humanize(complaint.aiAssessment.severity)}</dd></div>
                      <div><dt className="text-xs text-[#68736a]">Confidence</dt><dd className="text-[#34483a]">{complaint.aiAssessment.confidence === null ? '—' : `${Math.round(complaint.aiAssessment.confidence * 100)}%`}</dd></div>
                      <div className="sm:col-span-2"><dt className="text-xs text-[#68736a]">Assessment reason</dt><dd className="whitespace-pre-wrap text-[#34483a]">{complaint.aiAssessment.severityReason || '—'}</dd></div>
                      <div className="sm:col-span-2"><dt className="text-xs text-[#68736a]">Human review</dt><dd className="whitespace-pre-wrap text-[#34483a]">{complaint.aiAssessment.humanReviewRequired ? complaint.aiAssessment.humanReviewReason || 'Required' : 'Not required'}</dd></div>
                    </dl>
                  </div>
                )}
              </article>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4">
              <h3 className="font-semibold text-[#20382a]">Team assignment history</h3>
              {issue.teamAssignmentHistory.length === 0 ? <p className="mt-2 text-sm text-[#68736a]">No team assignment history.</p> : (
                <ol className="mt-3 space-y-3">
                  {issue.teamAssignmentHistory.map((event) => <li key={event.id} className="border-l-2 border-[#d8c58f] pl-3 text-sm">
                    <p className="font-medium text-[#34483a]">{humanize(event.eventType)} · {event.team?.name ?? event.previousTeam?.name ?? 'No team'}</p>
                    <p className="mt-1 text-xs text-[#68736a]">{event.admin.name} · {formatDate(event.createdAt)}</p>
                  </li>)}
                </ol>
              )}
            </div>
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4">
              <h3 className="font-semibold text-[#20382a]">Assignment history</h3>
              {issue.assignmentHistory.length === 0 ? <p className="mt-2 text-sm text-[#68736a]">No individual assignment history.</p> : (
                <ol className="mt-3 space-y-3">
                  {issue.assignmentHistory.map((event) => <li key={event.id} className="border-l-2 border-[#d8c58f] pl-3 text-sm">
                    <p className="font-medium text-[#34483a]">{humanize(event.eventType)} · {event.officer?.name ?? event.previousOfficer?.name ?? 'No officer'}</p>
                    <p className="mt-1 text-xs text-[#68736a]">{event.admin.name} · {formatDate(event.createdAt)}</p>
                  </li>)}
                </ol>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export default function Complaints() {
  const [items, setItems] = useState([]);
  const [wards, setWards] = useState([]);
  const [teams, setTeams] = useState([]);
  const [optionsError, setOptionsError] = useState('');
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [wardId, setWardId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setOptionsError('');
    Promise.all([listWards(), listTeams()])
      .then(([wardResult, teamResult]) => {
        if (!active) return;
        setWards(wardResult.items ?? []);
        setTeams(teamResult.items ?? []);
      })
      .catch((error) => { if (active) setOptionsError(getApiErrorMessage(error, 'Ward and team filters could not be loaded.')); });
    return () => { active = false; };
  }, [optionsRetry]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');
    const params = { limit: PAGE_LIMIT, offset };
    if (status) params.status = status;
    if (department) params.department = department;
    if (category) params.category = category;
    if (wardId) params.wardId = Number(wardId);
    if (teamId) params.teamId = Number(teamId);
    if (search.trim()) params.search = search.trim();
    listCivicIssues(params)
      .then((result) => {
        if (!active) return;
        setItems(result.items ?? []);
        setHasMore(Boolean(result.pagination?.hasMore));
      })
      .catch((error) => { if (active) setLoadError(getApiErrorMessage(error, 'Civic issues could not be loaded.')); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [status, department, category, wardId, teamId, search, offset, retry]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError('');
      return undefined;
    }
    let active = true;
    setDetail(null);
    setIsDetailLoading(true);
    setDetailError('');
    getCivicIssue(selectedId)
      .then((result) => { if (active) setDetail(result.issue); })
      .catch((error) => { if (active) setDetailError(getApiErrorMessage(error, 'Issue details could not be loaded.')); })
      .finally(() => { if (active) setIsDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, detailRetry]);

  function resetFilters() {
    setStatus('');
    setDepartment('');
    setCategory('');
    setWardId('');
    setTeamId('');
    setSearch('');
    setOffset(0);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="mt-2 text-sm leading-6 tracking-[0.16em] text-[#9a7832]">Review reported issues, citizen submissions, assessments, locations, and team routing.</h1>
      </header>

      <section className="rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
        {optionsError && <div className="mb-4"><ErrorState onRetry={() => setOptionsRetry((value) => value + 1)}>{optionsError}</ErrorState></div>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-[#34483a]">Status
            <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3">
              <option value="">Active issues</option>{STATUSES.map((value) => <option key={value} value={value}>{value === 'ALL' ? 'All issues, including merged' : humanize(value)}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-[#34483a]">Department
            <select value={department} onChange={(event) => { setDepartment(event.target.value); setOffset(0); }} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3">
              <option value="">All departments</option>{DEPARTMENTS.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-[#34483a]">AI category
            <select value={category} onChange={(event) => { setCategory(event.target.value); setOffset(0); }} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3">
              <option value="">All categories</option>{CATEGORIES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-[#34483a]">Ward
            <select value={wardId} onChange={(event) => { setWardId(event.target.value); setOffset(0); }} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3">
              <option value="">All wards</option>{wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.code} · {ward.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-[#34483a]">Team
            <select value={teamId} onChange={(event) => { setTeamId(event.target.value); setOffset(0); }} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3">
              <option value="">All teams</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.ward.code} · {team.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-[#34483a] sm:col-span-2">Search report title or description
            <input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3" placeholder="Search reports" />
          </label>
          <button type="button" onClick={resetFilters} className="min-h-11 self-end rounded-xl border border-[#d9ded5] px-4 text-sm font-semibold text-[#34483a]">Clear filters</button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#20382a]">Civic issues</h2>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-[#1d4933] hover:bg-white">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
          </button>
        </div>
        {isLoading ? <LoadingState>Loading civic issues…</LoadingState> : loadError ? <ErrorState onRetry={() => setRetry((value) => value + 1)}>{loadError}</ErrorState> : items.length === 0 ? <EmptyState>No civic issues match these filters.</EmptyState> : (
          <div className="overflow-hidden rounded-2xl border border-[#e5e2d5] bg-white shadow-sm">
            <ul className="divide-y divide-[#ebe9df]">
              {items.map((issue) => (
                <li key={issue.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[#20382a]">Issue #{issue.id}</h3>
                      <span className="rounded-full bg-[#f3f0e5] px-2.5 py-1 text-xs font-semibold text-[#5b624c]">{humanize(issue.status)}</span>
                    </div>
                    <p className="mt-1 text-sm text-[#68736a]">{issue.reportCount} report{issue.reportCount === 1 ? '' : 's'} · {issue.currentTeamAssignment ? `${issue.currentTeamAssignment.ward.name} · ${issue.currentTeamAssignment.teamName}` : 'No team assigned'}</p>
                    <p className="mt-1 text-xs text-[#68736a]">Updated {formatDate(issue.updatedAt)}{issue.aiAssessmentSummary?.latestSuccessfulComplaintAssessment ? ` · Latest AI severity: ${humanize(issue.aiAssessmentSummary.latestSuccessfulComplaintAssessment.severity)}` : ''}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedId(issue.id)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#1d4933] px-4 text-sm font-semibold text-white hover:bg-[#163b29]">
                    <Eye className="h-4 w-4" aria-hidden="true" /> review
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-[#ebe9df] px-4 py-3">
              <span className="text-xs text-[#68736a]">Page {Math.floor(offset / PAGE_LIMIT) + 1}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOffset((value) => Math.max(0, value - PAGE_LIMIT))} disabled={offset === 0 || isLoading} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#d9ded5] px-3 text-sm disabled:opacity-50"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous</button>
                <button type="button" onClick={() => setOffset((value) => value + PAGE_LIMIT)} disabled={!hasMore || isLoading} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#d9ded5] px-3 text-sm disabled:opacity-50">Next <ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
          </div>
        )}
      </section>

      {selectedId && (isDetailLoading ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"><LoadingState>Loading issue details…</LoadingState></div>
      ) : detailError ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5">
            <div className="flex items-center gap-2 text-[#8b3c2d]"><AlertCircle className="h-5 w-5" aria-hidden="true" /><p className="font-semibold">Issue details unavailable</p></div>
            <p role="alert" className="mt-2 text-sm text-[#68736a]">{detailError}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedId(null)} className="min-h-10 rounded-lg border border-[#d9ded5] px-4 text-sm">Close</button>
              <button type="button" onClick={() => setDetailRetry((value) => value + 1)} className="min-h-10 rounded-lg bg-[#1d4933] px-4 text-sm font-semibold text-white">Retry</button>
            </div>
          </div>
        </div>
      ) : detail ? <ComplaintDetails issue={detail} onClose={() => setSelectedId(null)} onRefresh={() => { setDetailRetry((value) => value + 1); setRetry((value) => value + 1); }} /> : null)}
    </div>
  );
}
