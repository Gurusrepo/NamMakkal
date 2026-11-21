import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listCivicIssues, getOfficerDashboard } from '../../api/officer.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';
import StatusBadge from '../../components/citizen/StatusBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { requestOnce } from '../../utils/requestOnce.js';

const PAGE_LIMIT = 20;
const INITIAL_FILTERS = {
  search: '',
  status: '',
  department: '',
  category: '',
  wardId: '',
  teamId: '',
  assignedFrom: '',
  assignedTo: ''
};
const DEPARTMENTS = [
  'Roads & Infrastructure',
  'Water Supply',
  'Drainage',
  'Sanitation',
  'Electricity',
  'Public Health',
  'Public Works',
  'General Administration'
];
const CATEGORIES = [
  'ROAD_DAMAGE',
  'WATER_SUPPLY',
  'DRAINAGE',
  'WASTE_MANAGEMENT',
  'STREETLIGHT',
  'PUBLIC_HEALTH',
  'PUBLIC_PROPERTY',
  'OTHER'
];

function formatEnumLabel(value) {
  if (!value) return '';
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function OfficerIssues() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTeamId = searchParams.get('teamId') ?? '';
  const [draftFilters, setDraftFilters] = useState({ ...INITIAL_FILTERS, teamId: selectedTeamId });
  const [filters, setFilters] = useState({ ...INITIAL_FILTERS, teamId: selectedTeamId });
  const [teams, setTeams] = useState([]);
  const [teamsError, setTeamsError] = useState('');
  const [teamsRetry, setTeamsRetry] = useState(0);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ limit: PAGE_LIMIT, offset: 0, hasMore: false });
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setDraftFilters((current) => ({ ...current, teamId: selectedTeamId }));
    setFilters((current) => ({ ...current, teamId: selectedTeamId }));
    setOffset(0);
  }, [selectedTeamId]);

  useEffect(() => {
    let active = true;
    setTeamsError('');

    requestOnce(`officer:${user?.id}:issue-filters:${teamsRetry}`, getOfficerDashboard)
      .then((result) => {
        if (active) setTeams(result.teams);
      })
      .catch((requestError) => {
        if (active) setTeamsError(getApiErrorMessage(requestError, 'Team filters could not be loaded.'));
      });

    return () => {
      active = false;
    };
  }, [teamsRetry, user?.id]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError('');

    const params = { limit: PAGE_LIMIT, offset };
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params[key] = value;
    });

    requestOnce(
      `officer:${user?.id}:issues:${offset}:${JSON.stringify(filters)}:${retry}`,
      () => listCivicIssues(params)
    )
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setPagination(result.pagination);
      })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Assigned complaints could not be loaded.'));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, offset, retry, user?.id]);

  function applyFilters(event) {
    event.preventDefault();
    setOffset(0);
    setFilters({ ...draftFilters });
    setSearchParams(draftFilters.teamId ? { teamId: draftFilters.teamId } : {});
  }

  function clearFilters() {
    setDraftFilters({ ...INITIAL_FILTERS });
    setFilters({ ...INITIAL_FILTERS });
    setOffset(0);
    setSearchParams({});
  }

  function updateFilter(event) {
    const { name, value } = event.target;
    setDraftFilters((current) => ({ ...current, [name]: value }));
  }

  const wards = [...new Map(teams.map((team) => [team.ward.id, team.ward])).values()];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">
          Officer workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#20382a] sm:text-4xl">
          Assigned complaints
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#68736a]">
          Search and review civic issues currently assigned to your active ward teams.
        </p>
      </header>

      <form onSubmit={applyFilters} className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <label htmlFor="officer-issue-search" className="mb-1.5 block text-sm font-medium text-[#34483a]">
              Search by issue ID or report text
            </label>
            <input
              id="officer-issue-search"
              name="search"
              type="search"
              maxLength={120}
              value={draftFilters.search}
              onChange={updateFilter}
              placeholder="Issue ID, title, or description"
              className="min-h-11 w-full rounded-xl border border-[#d9ded5] px-3 text-sm text-[#24362a] outline-none focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10"
            />
          </div>
          <div>
            <label htmlFor="officer-issue-status" className="mb-1.5 block text-sm font-medium text-[#34483a]">
              Status
            </label>
            <select id="officer-issue-status" name="status" value={draftFilters.status} onChange={updateFilter} className="min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 text-sm text-[#24362a] focus:border-[#477454] focus:outline-none focus:ring-4 focus:ring-[#477454]/10">
              <option value="">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
          <div>
            <label htmlFor="officer-issue-department" className="mb-1.5 block text-sm font-medium text-[#34483a]">
              Department
            </label>
            <select id="officer-issue-department" name="department" value={draftFilters.department} onChange={updateFilter} className="min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 text-sm text-[#24362a] focus:border-[#477454] focus:outline-none focus:ring-4 focus:ring-[#477454]/10">
              <option value="">All departments</option>
              {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="officer-issue-category" className="mb-1.5 block text-sm font-medium text-[#34483a]">
              Category
            </label>
            <select id="officer-issue-category" name="category" value={draftFilters.category} onChange={updateFilter} className="min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 text-sm text-[#24362a] focus:border-[#477454] focus:outline-none focus:ring-4 focus:ring-[#477454]/10">
              <option value="">All categories</option>
              {CATEGORIES.map((category) => <option key={category} value={category}>{formatEnumLabel(category)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="officer-issue-ward" className="mb-1.5 block text-sm font-medium text-[#34483a]">
              Ward
            </label>
            <select id="officer-issue-ward" name="wardId" value={draftFilters.wardId} onChange={updateFilter} className="min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 text-sm text-[#24362a] focus:border-[#477454] focus:outline-none focus:ring-4 focus:ring-[#477454]/10">
              <option value="">All my wards</option>
              {wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.code} · {ward.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="officer-issue-team" className="mb-1.5 block text-sm font-medium text-[#34483a]">
              Team
            </label>
            <select id="officer-issue-team" name="teamId" value={draftFilters.teamId} onChange={updateFilter} className="min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 text-sm text-[#24362a] focus:border-[#477454] focus:outline-none focus:ring-4 focus:ring-[#477454]/10">
              <option value="">All my teams</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.ward.code}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="officer-issue-assigned-from" className="mb-1.5 block text-sm font-medium text-[#34483a]">
              Assigned from
            </label>
            <input id="officer-issue-assigned-from" name="assignedFrom" type="date" value={draftFilters.assignedFrom} onChange={updateFilter} className="min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 text-sm text-[#24362a] focus:border-[#477454] focus:outline-none focus:ring-4 focus:ring-[#477454]/10" />
          </div>
          <div>
            <label htmlFor="officer-issue-assigned-to" className="mb-1.5 block text-sm font-medium text-[#34483a]">
              Assigned to
            </label>
            <input id="officer-issue-assigned-to" name="assignedTo" type="date" value={draftFilters.assignedTo} onChange={updateFilter} className="min-h-11 w-full rounded-xl border border-[#d9ded5] bg-white px-3 text-sm text-[#24362a] focus:border-[#477454] focus:outline-none focus:ring-4 focus:ring-[#477454]/10" />
          </div>
        </div>
        {teamsError && (
          <ErrorState onRetry={() => setTeamsRetry((value) => value + 1)}>
            {teamsError}
          </ErrorState>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="min-h-11 rounded-xl bg-[#1d4933] px-5 text-sm font-semibold text-white transition hover:bg-[#163b29] focus:outline-none focus:ring-4 focus:ring-[#477454]/25">
            Apply filters
          </button>
          <button type="button" onClick={clearFilters} className="min-h-11 rounded-xl border border-[#cfd8ce] bg-white px-5 text-sm font-semibold text-[#1d4933] transition hover:bg-[#f7faf5] focus:outline-none focus:ring-4 focus:ring-[#477454]/20">
            Clear filters
          </button>
        </div>
      </form>

      {error && items.length === 0 ? (
        <ErrorState onRetry={() => setRetry((value) => value + 1)}>{error}</ErrorState>
      ) : isLoading && items.length === 0 ? (
        <LoadingState>Loading assigned complaints...</LoadingState>
      ) : items.length === 0 ? (
        <EmptyState>No assigned complaints match these filters.</EmptyState>
      ) : (
        <>
          {error && <ErrorState onRetry={() => setRetry((value) => value + 1)}>{error}</ErrorState>}
          <p className="text-sm text-[#68736a]">
            Showing {pagination.offset + 1}–{pagination.offset + items.length} assigned {items.length === 1 ? 'issue' : 'issues'}.
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
            {items.map((issue) => (
              <article key={issue.id} className="rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#758077]">Issue #{issue.id}</p>
                    <h2 className="mt-1 text-lg font-semibold text-[#20382a]">
                      <Link to={`/officer/issues/${issue.id}`} className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40">
                        {issue.title || 'Untitled civic issue'}
                      </Link>
                    </h2>
                  </div>
                  <StatusBadge status={issue.status} />
                </div>
                {issue.descriptionPreview && (
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#68736a]">{issue.descriptionPreview}</p>
                )}
                <dl className="mt-4 grid gap-3 border-t border-[#ece9df] pt-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-[#758077]">Category and department</dt>
                    <dd className="mt-1 text-sm text-[#34483a]">
                      {issue.category ? formatEnumLabel(issue.category) : 'Category unavailable'}
                      {' · '}
                      {issue.department || 'Department unavailable'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#758077]">Assigned team</dt>
                    <dd className="mt-1 text-sm text-[#34483a]">{issue.teamName} · {issue.ward.code}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#758077]">AI severity</dt>
                    <dd className="mt-1 text-sm text-[#34483a]">
                      {issue.severity ? formatEnumLabel(issue.severity) : 'Unavailable'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#758077]">Linked reports</dt>
                    <dd className="mt-1 text-sm text-[#34483a]">{issue.reportCount}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#ece9df] pt-3">
                  <p className="text-xs text-[#758077]">Assigned {formatDate(issue.assignedAt)}</p>
                  <Link to={`/officer/issues/${issue.id}`} className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-[#1d4933] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40">
                    View details
                  </Link>
                </div>
              </article>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" disabled={offset === 0 || isLoading} onClick={() => setOffset((value) => Math.max(0, value - PAGE_LIMIT))} className="min-h-11 rounded-xl border border-[#cfd8ce] bg-white px-4 text-sm font-semibold text-[#1d4933] disabled:cursor-not-allowed disabled:opacity-50">
              Previous
            </button>
            <p className="text-xs text-[#68736a]">Page {Math.floor(offset / PAGE_LIMIT) + 1}</p>
            <button type="button" disabled={!pagination.hasMore || isLoading} onClick={() => setOffset((value) => value + PAGE_LIMIT)} className="min-h-11 rounded-xl border border-[#cfd8ce] bg-white px-4 text-sm font-semibold text-[#1d4933] disabled:cursor-not-allowed disabled:opacity-50">
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
