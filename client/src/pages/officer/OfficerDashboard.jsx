import { useEffect, useState } from 'react';
import { Activity, ClipboardList, MapPin, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getOfficerDashboard } from '../../api/officer.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';
import StatusBadge from '../../components/citizen/StatusBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { requestOnce } from '../../utils/requestOnce.js';

const statisticCards = [
  { key: 'totalAssigned', label: 'Total assigned', accent: 'border-[#d4ae58]' },
  { key: 'open', label: 'Open', accent: 'border-amber-400' },
  { key: 'inProgress', label: 'In progress', accent: 'border-sky-500' },
  { key: 'resolved', label: 'Resolved', accent: 'border-emerald-500' }
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

function SectionHeading({ id, title, icon: Icon }) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon className="h-5 w-5 text-[#477454]" aria-hidden="true" />}
      <h2 id={id} className="text-lg font-semibold text-[#20382a]">{title}</h2>
    </div>
  );
}

export default function OfficerDashboard() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');

    requestOnce(`officer:${user?.id}:dashboard:${retry}`, getOfficerDashboard)
      .then((result) => {
        if (active) setDashboard(result);
      })
      .catch((error) => {
        if (active) setLoadError(getApiErrorMessage(error, 'Officer dashboard could not be loaded.'));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retry, user?.id]);

  if (isLoading) {
    return <LoadingState>Loading your dashboard...</LoadingState>;
  }

  if (loadError) {
    return (
      <ErrorState onRetry={() => setRetry((value) => value + 1)}>
        {loadError}
      </ErrorState>
    );
  }

  const { summary, teams, activeIssues, recentAssignments, recentActivity } = dashboard;
  const displayName = typeof user?.name === 'string' ? user.name.trim() : '';

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">
          Officer workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#20382a] sm:text-4xl">
          Welcome, {displayName || 'Officer'}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#68736a]">
          Review the issues assigned to your ward teams and keep track of their current status.
        </p>
      </header>

      <section aria-label="Assigned issue statistics" className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {statisticCards.map(({ key, label, accent }) => (
            <article
              key={key}
              className={`min-h-28 rounded-2xl border-l-4 ${accent} bg-white p-4 shadow-sm sm:p-5`}
            >
              <p className="text-xs font-medium text-[#68736a] sm:text-sm">{label}</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-[#20382a]">
                {summary[key]}
              </p>
            </article>
          ))}
        </div>
        <p className="text-xs leading-5 text-[#68736a]">
          Totals include current issues assigned to your active ward teams.
        </p>
      </section>

      <section aria-labelledby="officer-teams-heading" className="space-y-4">
        <SectionHeading id="officer-teams-heading" title="Your ward teams" icon={Users} />
        {teams.length === 0 ? (
          <EmptyState>You are not currently a member of an active ward team.</EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {teams.map((team) => (
              <article
                key={team.id}
                className="rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-[#20382a]">{team.name}</h3>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-[#68736a]">
                      <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{team.ward.name} ({team.ward.code})</span>
                    </p>
                    <p className="mt-1 text-xs text-[#758077]">{team.department}</p>
                  </div>
                  <p className="shrink-0 rounded-full bg-[#edf2eb] px-2.5 py-1 text-xs font-semibold text-[#385743]">
                    {team.activeMemberCount} {team.activeMemberCount === 1 ? 'officer' : 'officers'}
                  </p>
                </div>
                <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-[#ece9df] pt-4 text-center">
                  {[
                    { key: 'open', label: 'Open' },
                    { key: 'inProgress', label: 'In progress' },
                    { key: 'resolved', label: 'Resolved' }
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <dt className="text-xs text-[#758077]">{label}</dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums text-[#34483a]">
                        {team.workload[key]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="active-issues" aria-labelledby="active-issues-heading" className="space-y-4">
        <SectionHeading id="active-issues-heading" title="Active assigned issues" icon={ClipboardList} />
        {activeIssues.length === 0 ? (
          <EmptyState>There are no open or in-progress issues assigned to your teams.</EmptyState>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {activeIssues.map((issue) => (
              <article
                key={issue.id}
                className="rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#758077]">Issue #{issue.id}</p>
                    <h3 className="mt-1 text-base font-semibold text-[#20382a]">
                      <Link
                        to={`/officer/issues/${issue.id}`}
                        className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
                      >
                        {issue.title || 'Untitled civic issue'}
                      </Link>
                    </h3>
                  </div>
                  <StatusBadge status={issue.status} />
                </div>
                {issue.descriptionPreview && (
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#68736a]">
                    {issue.descriptionPreview}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#526458]">
                  <span className="rounded-full bg-[#f2f4ef] px-2.5 py-1">
                    {issue.ward.code} · {issue.teamName}
                  </span>
                  {issue.category && (
                    <span className="rounded-full bg-[#f2f4ef] px-2.5 py-1">
                      {formatEnumLabel(issue.category)}
                    </span>
                  )}
                  {issue.severity && (
                    <span className="rounded-full bg-[#f2f4ef] px-2.5 py-1">
                      {formatEnumLabel(issue.severity)} severity
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#ece9df] pt-3 text-xs text-[#758077]">
                  <span>{issue.reportCount} {issue.reportCount === 1 ? 'citizen report' : 'citizen reports'}</span>
                  <span className="text-right">Assigned {formatDate(issue.assignedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section aria-labelledby="recent-assignments-heading" className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
          <SectionHeading id="recent-assignments-heading" title="Recent assignments" icon={ClipboardList} />
          {recentAssignments.length === 0 ? (
            <EmptyState>No recent assignments to show.</EmptyState>
          ) : (
            <ul className="divide-y divide-[#ece9df]">
              {recentAssignments.map((assignment) => (
                <li key={`${assignment.id}-${assignment.assignedAt}`} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#34483a]">
                      {assignment.title || `Issue #${assignment.id}`}
                    </p>
                    <p className="mt-1 truncate text-xs text-[#758077]">
                      {assignment.ward.code} · {assignment.teamName}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusBadge status={assignment.status} />
                    <p className="mt-1 text-xs text-[#758077]">{formatDate(assignment.assignedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent-activity-heading" className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
          <SectionHeading id="recent-activity-heading" title="Recent team activity" icon={Activity} />
          {recentActivity.length === 0 ? (
            <EmptyState>No recent team activity to show.</EmptyState>
          ) : (
            <ul className="divide-y divide-[#ece9df]">
              {recentActivity.map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#34483a]">
                      {formatEnumLabel(event.eventType)} · Issue #{event.civicIssueId}
                    </p>
                    <p className="mt-1 text-xs text-[#758077]">{event.officerName}</p>
                  </div>
                  <p className="shrink-0 text-right text-xs text-[#758077]">
                    {formatDate(event.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
