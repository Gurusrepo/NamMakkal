import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOfficerProfile } from '../../api/officer.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';
import { requestOnce } from '../../utils/requestOnce.js';
import { useAuth } from '../../context/AuthContext.jsx';

function ProfileSection({ title, children }) {
  return (
    <section className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold text-[#20382a]">{title}</h2>
      {children}
    </section>
  );
}

export default function OfficerProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setProfile(null);
    setIsLoading(true);
    setError('');
    requestOnce(`officer:${user?.id}:profile:${retry}`, getOfficerProfile)
      .then((result) => { if (active) setProfile(result.profile); })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Officer profile could not be loaded.'));
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [retry, user?.id]);

  if (isLoading) return <LoadingState>Loading your profile...</LoadingState>;
  if (error || !profile) {
    return <ErrorState onRetry={() => setRetry((value) => value + 1)}>
      {error || 'Officer profile not found.'}
    </ErrorState>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Officer account</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#20382a]">My profile</h1>
        <p className="mt-2 text-sm text-[#68736a]">Your account and active ward-team details.</p>
      </header>

      <ProfileSection title="Account details">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-[#758077]">Name</dt>
            <dd className="mt-1 break-words text-sm text-[#34483a]">{profile.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-[#758077]">Email</dt>
            <dd className="mt-1 break-words text-sm text-[#34483a]">{profile.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-[#758077]">Employee ID</dt>
            <dd className="mt-1 text-sm text-[#34483a]">{profile.employeeId || 'Not assigned'}</dd>
          </div>
        </dl>
        <p className="border-t border-[#ece9df] pt-3 text-xs leading-5 text-[#758077]">
          Contact an administrator if your account details need to be changed.
        </p>
      </ProfileSection>

      <ProfileSection title="Active ward teams">
        {profile.teams.length === 0 ? (
          <EmptyState>You are not currently a member of an active ward team.</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {profile.teams.map((team) => (
              <li key={team.id} className="rounded-xl border border-[#ece9df] p-4">
                <h3 className="font-semibold text-[#20382a]">{team.name}</h3>
                <p className="mt-1 text-sm text-[#526258]">{team.department}</p>
                <p className="mt-2 text-xs text-[#758077]">
                  {team.ward.name} ({team.ward.code})
                </p>
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      <Link
        to="/officer/issues"
        className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-semibold text-[#1d4933] underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/30"
      >
        View assigned complaints
      </Link>
    </div>
  );
}
