import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, UsersRound } from 'lucide-react';
import { getOfficerDashboard } from '../../api/officer.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { requestOnce } from '../../utils/requestOnce.js';

function Workload({ workload }) {
  const counts = [
    { key: 'open', label: 'Open' },
    { key: 'inProgress', label: 'In progress' },
    { key: 'resolved', label: 'Resolved' }
  ];

  return (
    <dl className="grid grid-cols-3 gap-2 border-t border-[#ece9df] pt-4 text-center">
      {counts.map(({ key, label }) => (
        <div key={key}>
          <dt className="text-xs text-[#758077]">{label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-[#34483a]">{workload[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function OfficerTeams() {
  const { user } = useAuth();
  const [teams, setTeams] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError('');

    requestOnce(`officer:${user?.id}:teams:${retry}`, getOfficerDashboard)
      .then((result) => {
        if (active) setTeams(result.teams);
      })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Your teams could not be loaded.'));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retry, user?.id]);

  if (isLoading) return <LoadingState>Loading your teams...</LoadingState>;
  if (error) {
    return <ErrorState onRetry={() => setRetry((value) => value + 1)}>{error}</ErrorState>;
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Officer workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#20382a] sm:text-4xl">Your teams</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#68736a]">
          Review your active ward-team memberships and open complaints assigned to a team.
        </p>
      </header>

      {teams.length === 0 ? (
        <EmptyState>You are not currently a member of an active ward team.</EmptyState>
      ) : (
        <section aria-label="Active ward teams" className="grid gap-4 md:grid-cols-2">
          {teams.map((team) => (
            <article key={team.id} className="rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold text-[#20382a]">{team.name}</h2>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-[#68736a]">
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{team.ward.name} ({team.ward.code})</span>
                  </p>
                  <p className="mt-1 text-sm text-[#526258]">{team.department}</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#edf2eb] px-2.5 py-1 text-xs font-semibold text-[#385743]">
                  <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
                  {team.activeMemberCount}
                </span>
              </div>

              <div className="mt-5">
                <Workload workload={team.workload} />
              </div>
              <div className="mt-4 flex justify-end border-t border-[#ece9df] pt-3">
                <Link
                  to={`/officer/issues?teamId=${team.id}`}
                  className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-[#1d4933] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
                >
                  View team complaints
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
