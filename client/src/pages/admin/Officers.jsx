import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, UserRound, X } from 'lucide-react';
import {
  addTeamMember,
  createOfficer,
  getOfficer,
  listOfficers,
  listWards,
  listTeams,
  removeTeamMember,
  resendOfficerInvitation,
  updateOfficerStatus
} from '../../api/admin.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';

const PAGE_LIMIT = 20;
const STATUSES = ['ACTIVE', 'PENDING_EMAIL_VERIFICATION', 'DEACTIVATED'];

function statusLabel(status) {
  return status === 'PENDING_EMAIL_VERIFICATION' ? 'Pending email verification' : status;
}

function OfficerDetails({ officer, teams, teamsError, onClose, onRefresh, onRetryTeams }) {
  const [teamId, setTeamId] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const currentTeamIds = useMemo(() => new Set(officer.teams.filter((membership) => membership.active).map((membership) => membership.team.id)), [officer.teams]);
  const availableTeams = teams.filter((team) => !currentTeamIds.has(team.id));

  async function changeStatus(status) {
    setIsSaving(true);
    setActionError('');
    setActionMessage('');
    try {
      await updateOfficerStatus(officer.id, { status });
      setActionMessage(`Officer account ${status === 'ACTIVE' ? 'activated' : 'deactivated'}.`);
      onRefresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Officer status could not be updated.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function sendInvitation() {
    setIsSaving(true);
    setActionError('');
    setActionMessage('');
    try {
      await resendOfficerInvitation(officer.id);
      setActionMessage('Verification email sent.');
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Invitation could not be sent. Please retry.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function addMembership(event) {
    event.preventDefault();
    if (!teamId) {
      setActionError('Choose a ward team.');
      return;
    }
    setIsSaving(true);
    setActionError('');
    setActionMessage('');
    try {
      await addTeamMember(Number(teamId), { officerId: officer.id });
      setTeamId('');
      setActionMessage('Officer added to the team.');
      onRefresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Team membership could not be added.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeMembership(membership) {
    setIsSaving(true);
    setActionError('');
    setActionMessage('');
    try {
      await removeTeamMember(membership.team.id, officer.id);
      setActionMessage(`Removed from ${membership.team.name}.`);
      onRefresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Team membership could not be removed.'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="officer-detail-title">
      <section className="my-auto w-full max-w-4xl rounded-2xl bg-[#f7f6ef] shadow-2xl">
        <header className="flex items-start justify-between gap-4 rounded-t-2xl bg-[#173d2b] px-5 py-4 text-white">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#e2c77f]">Officer account</p>
            <h2 id="officer-detail-title" className="mt-1 text-xl font-semibold">{officer.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close officer details" className="rounded-lg p-2 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><X className="h-5 w-5" aria-hidden="true" /></button>
        </header>
        <div className="space-y-5 p-4 sm:p-6">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><p className="text-xs text-[#68736a]">Employee ID</p><p className="mt-1 font-semibold text-[#20382a]">{officer.employeeId}</p></div>
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><p className="text-xs text-[#68736a]">Email</p><p className="mt-1 break-all font-semibold text-[#20382a]">{officer.email}</p></div>
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><p className="text-xs text-[#68736a]">Account status</p><p className="mt-1 font-semibold text-[#20382a]">{statusLabel(officer.status)}</p></div>
            <div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><p className="text-xs text-[#68736a]">Email verified</p><p className="mt-1 font-semibold text-[#20382a]">{officer.emailVerified ? 'Yes' : 'No'}</p></div>
          </section>

          <section className="rounded-xl border border-[#e5e2d5] bg-white p-4">
            <h3 className="font-semibold text-[#20382a]">Account actions</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {officer.status === 'PENDING_EMAIL_VERIFICATION' && <button type="button" disabled={isSaving} onClick={sendInvitation} className="min-h-10 rounded-xl border border-[#d9ded5] px-4 text-sm font-semibold text-[#34483a] disabled:opacity-50">Resend verification email</button>}
              {officer.status === 'ACTIVE' && <button type="button" disabled={isSaving} onClick={() => changeStatus('DEACTIVATED')} className="min-h-10 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-800 disabled:opacity-50">Deactivate account</button>}
              {officer.status === 'DEACTIVATED' && <button type="button" disabled={isSaving} onClick={() => changeStatus('ACTIVE')} className="min-h-10 rounded-xl bg-[#1d4933] px-4 text-sm font-semibold text-white disabled:opacity-50">Reactivate account</button>}
            </div>
            {officer.status === 'PENDING_EMAIL_VERIFICATION' && <p className="mt-3 text-xs leading-5 text-[#68736a]">After verifying the invitation email, the officer can use Forgot password to set a password.</p>}
          </section>

          <section className="rounded-xl border border-[#e5e2d5] bg-white p-4">
            <div>
              <h3 className="font-semibold text-[#20382a]">Ward team memberships</h3>
              <p className="mt-1 text-sm text-[#68736a]">Department and ward assignments are represented by team membership. Multiple teams are supported.</p>
            </div>
            <form onSubmit={addMembership} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select aria-label="Add officer to a ward team" value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={isSaving || officer.status !== 'ACTIVE'} className="min-h-11 flex-1 rounded-xl border border-[#d9ded5] px-3 text-sm">
                <option value="">Select a team to add</option>
                {availableTeams.map((team) => <option key={team.id} value={team.id}>{team.ward.name} · {team.name} · {team.department}</option>)}
              </select>
              <button type="submit" disabled={isSaving || officer.status !== 'ACTIVE' || !teamId} className="min-h-11 rounded-xl bg-[#1d4933] px-4 text-sm font-semibold text-white disabled:opacity-50">Add to team</button>
            </form>
            {teamsError && <ErrorState onRetry={onRetryTeams}>{teamsError}</ErrorState>}
            {officer.status !== 'ACTIVE' && <p className="mt-2 text-xs text-[#68736a]">Only active officers can be added to teams.</p>}
            {officer.teams.length === 0 ? <p className="mt-3 text-sm text-[#68736a]">No team membership history.</p> : (
              <ul className="mt-3 divide-y divide-[#ebe9df]">
                {officer.teams.map((membership) => (
                  <li key={membership.membershipId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[#34483a]">{membership.team.name} · {membership.team.department}</p>
                      <p className="text-xs text-[#68736a]">{membership.ward.code} · {membership.ward.name} · {membership.active ? 'Membership active' : 'Membership removed'}{!membership.team.active || !membership.ward.active ? ' · Team/ward inactive' : ''}</p>
                    </div>
                    {membership.active && officer.status === 'ACTIVE' && <button type="button" disabled={isSaving} onClick={() => removeMembership(membership)} className="min-h-9 self-start rounded-lg border border-[#d9ded5] px-3 text-xs font-semibold text-[#34483a] disabled:opacity-50">Remove</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-[#e5e2d5] bg-white p-4">
            <h3 className="font-semibold text-[#20382a]">Account history</h3>
            {officer.accountHistory.length === 0 ? <p className="mt-2 text-sm text-[#68736a]">No account history is available.</p> : (
              <ol className="mt-3 space-y-3">
                {officer.accountHistory.map((event) => <li key={event.id} className="border-l-2 border-[#d8c58f] pl-3 text-sm">
                  <p className="font-medium text-[#34483a]">{event.eventType.replaceAll('_', ' ')} · {event.previousStatus ?? '—'} → {event.nextStatus}</p>
                  <p className="mt-1 text-xs text-[#68736a]">{event.admin.name} · {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</p>
                </li>)}
              </ol>
            )}
          </section>
          {actionError && <p role="alert" className="rounded-lg bg-[#fff5f2] px-3 py-2 text-sm text-[#8b3c2d]">{actionError}</p>}
          {actionMessage && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{actionMessage}</p>}
        </div>
      </section>
    </div>
  );
}

export default function Officers() {
  const [items, setItems] = useState([]);
  const [teams, setTeams] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [wards, setWards] = useState([]);
  const [wardId, setWardId] = useState('');
  const [isWardsLoading, setIsWardsLoading] = useState(true);
  const [wardsError, setWardsError] = useState('');
  const [wardsRetry, setWardsRetry] = useState(0);
  const [isTeamsLoading, setIsTeamsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [teamsError, setTeamsError] = useState('');
  const [teamsRetry, setTeamsRetry] = useState(0);
  const [allTeamsError, setAllTeamsError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createMessage, setCreateMessage] = useState('');
  const [form, setForm] = useState({ displayName: '', email: '', teamIds: [] });

  useEffect(() => {
    let active = true;
    setIsWardsLoading(true);
    setWardsError('');
    listWards()
      .then((result) => { if (active) setWards(result.items ?? []); })
      .catch((error) => { if (active) setWardsError(getApiErrorMessage(error, 'Wards could not be loaded.')); })
      .finally(() => { if (active) setIsWardsLoading(false); });
    return () => { active = false; };
  }, [wardsRetry]);

  useEffect(() => {
    let active = true;
    setAllTeamsError('');
    listTeams()
      .then((result) => { if (active) setAllTeams(result.items ?? []); })
      .catch((error) => { if (active) setAllTeamsError(getApiErrorMessage(error, 'Ward teams could not be loaded.')); });
    return () => { active = false; };
  }, [teamsRetry]);

  useEffect(() => {
    let active = true;
    if (!wardId) {
      setTeams([]);
      setTeamsError('');
      setIsTeamsLoading(false);
      return () => { active = false; };
    }
    setIsTeamsLoading(true);
    setTeamsError('');
    setTeams([]);
    listTeams({ wardId: Number(wardId) })
      .then((result) => { if (active) setTeams(result.items ?? []); })
      .catch((error) => { if (active) setTeamsError(getApiErrorMessage(error, 'Ward teams could not be loaded.')); })
      .finally(() => { if (active) setIsTeamsLoading(false); });
    return () => { active = false; };
  }, [wardId, teamsRetry]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');
    const params = { limit: PAGE_LIMIT, offset };
    if (status) params.status = status;
    if (search.trim()) params.search = search.trim();
    listOfficers(params)
      .then((result) => {
        if (!active) return;
        setItems(result.items ?? []);
        setHasMore(Boolean(result.pagination?.hasMore));
      })
      .catch((error) => { if (active) setLoadError(getApiErrorMessage(error, 'Officer accounts could not be loaded.')); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [status, search, offset, retry]);

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
    getOfficer(selectedId)
      .then((result) => { if (active) setDetail(result.officer); })
      .catch((error) => { if (active) setDetailError(getApiErrorMessage(error, 'Officer details could not be loaded.')); })
      .finally(() => { if (active) setIsDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, detailRetry]);

  async function submitCreate(event) {
    event.preventDefault();
    setIsCreating(true);
    setCreateError('');
    setCreateMessage('');
    try {
      const result = await createOfficer({
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        wardId: Number(wardId),
        teamIds: form.teamIds
      });
      setForm({ displayName: '', email: '', teamIds: [] });
      setWardId('');
      setCreateMessage(`Officer account created. Employee ID: ${result.officer.employeeId}. ${result.invitation.sent
        ? 'A verification email was sent; the officer can use Forgot password after verification to set a password.'
        : result.invitation.error}`);
      setSelectedId(result.officer.id);
      setRetry((value) => value + 1);
    } catch (error) {
      setCreateError(getApiErrorMessage(error, 'Officer account could not be created.'));
    } finally {
      setIsCreating(false);
    }
  }

  function resetFilters() {
    setStatus('');
    setSearch('');
    setOffset(0);
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Staff administration</p>
      </header>

      <form onSubmit={submitCreate} className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
        <div>
          <h2 className="text-lg font-semibold text-[#20382a]">Create officer account</h2>
          <p className="mt-1 text-sm text-[#68736a]">The officer receives an email verification invitation and sets a password through the existing reset flow.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-[#34483a]">Officer name
            <input required minLength={1} maxLength={100} value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3" />
          </label>
          <label className="text-sm font-medium text-[#34483a]">Email
            <input required type="email" maxLength={254} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3" />
          </label>
          <label className="text-sm font-medium text-[#34483a]">Ward
            <select required value={wardId} onChange={(event) => {
              const nextWardId = event.target.value;
              setWardId(nextWardId);
              setTeams([]);
              setTeamsError('');
              setIsTeamsLoading(Boolean(nextWardId));
              setForm((current) => ({ ...current, teamIds: [] }));
            }} disabled={isWardsLoading || Boolean(wardsError) || wards.length === 0} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3">
              <option value="">Select a ward</option>
              {wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.code} · {ward.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-[#34483a]">Ward teams
            <select required multiple value={form.teamIds.map(String)} onChange={(event) => setForm((current) => ({ ...current, teamIds: Array.from(event.target.selectedOptions, (option) => Number(option.value)) }))} disabled={!wardId || isTeamsLoading || Boolean(teamsError) || teams.length === 0} className="mt-1 min-h-24 w-full rounded-xl border border-[#d9ded5] px-3 py-2">
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.department}</option>)}
            </select>
            <span className="mt-1 block text-xs text-[#68736a]">Select one or more active teams (Ctrl/Cmd-click for multiple).</span>
          </label>
        </div>
        {isWardsLoading && <p role="status" className="text-sm text-[#68736a]">Loading wards...</p>}
        {wardsError && <ErrorState onRetry={() => setWardsRetry((value) => value + 1)}>{wardsError}</ErrorState>}
        {!isWardsLoading && !wardsError && wards.length === 0 && <p role="status" className="text-sm text-[#68736a]">No active wards are available. Create an active ward in Wards before creating an Officer.</p>}
        {wardId && isTeamsLoading && <p role="status" className="text-sm text-[#68736a]">Loading teams...</p>}
        {teamsError && <ErrorState onRetry={() => setTeamsRetry((value) => value + 1)}>{teamsError}</ErrorState>}
        {wardId && !isTeamsLoading && !teamsError && teams.length === 0 && <p role="status" className="text-sm text-[#68736a]">No active teams are available for this ward. Add an active team in Teams before creating this Officer.</p>}
        {!wardId && wards.length > 0 && <p className="text-sm text-[#68736a]">Select a ward to load its active teams.</p>}
        {createError && <p role="alert" className="rounded-lg bg-[#fff5f2] px-3 py-2 text-sm text-[#8b3c2d]">{createError}</p>}
        {createMessage && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{createMessage}</p>}
        <button type="submit" disabled={isCreating || isWardsLoading || Boolean(wardsError) || wards.length === 0 || !wardId || isTeamsLoading || Boolean(teamsError) || teams.length === 0 || form.teamIds.length === 0} className="min-h-11 rounded-xl bg-[#1d4933] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{isCreating ? 'Creating account…' : 'Create officer'}</button>
      </form>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-[#20382a]">Officer accounts</h2>
          <p className="mt-1 text-sm text-[#68736a]">Account deactivation revokes sessions. Active team memberships are retained for possible reactivation, but inactive officers do not count for routing.</p>
        </div>
        <div className="grid gap-3 rounded-2xl border border-[#e5e2d5] bg-white p-4 sm:grid-cols-[minmax(0,1fr)_16rem_auto_auto]">
          <label className="text-sm font-medium text-[#34483a]">Search name, email, or employee ID
            <input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3" />
          </label>
          <label className="text-sm font-medium text-[#34483a]">Status
            <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3">
              <option value="">All statuses</option>{STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
            </select>
          </label>
          <button type="button" onClick={resetFilters} className="min-h-11 self-end rounded-xl border border-[#d9ded5] px-4 text-sm font-semibold text-[#34483a]">Clear</button>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-xl px-3 text-sm font-semibold text-[#1d4933] hover:bg-[#f7f6ef]"><RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh</button>
        </div>
        {isLoading ? <LoadingState>Loading officer accounts…</LoadingState> : loadError ? <ErrorState onRetry={() => setRetry((value) => value + 1)}>{loadError}</ErrorState> : items.length === 0 ? <EmptyState>No officer accounts match these filters.</EmptyState> : (
          <div className="overflow-hidden rounded-2xl border border-[#e5e2d5] bg-white shadow-sm">
            <ul className="divide-y divide-[#ebe9df]">
              {items.map((officer) => (
                <li key={officer.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eef2eb] text-[#1d4933]"><UserRound className="h-5 w-5" aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-[#20382a]">{officer.name}</h3>
                      <p className="truncate text-sm text-[#68736a]">{officer.email} · {officer.employeeId || 'No employee ID'}</p>
                      <p className="mt-1 text-xs text-[#68736a]">{statusLabel(officer.status)} · {officer.teams.map((membership) => membership.team.name).join(', ') || 'No active teams'}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setSelectedId(officer.id)} className="min-h-10 shrink-0 rounded-xl bg-[#1d4933] px-4 text-sm font-semibold text-white hover:bg-[#163b29]">View details</button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-[#ebe9df] px-4 py-3">
              <span className="text-xs text-[#68736a]">Page {Math.floor(offset / PAGE_LIMIT) + 1}</span>
              <div className="flex gap-2">
                <button type="button" disabled={offset === 0 || isLoading} onClick={() => setOffset((value) => Math.max(0, value - PAGE_LIMIT))} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#d9ded5] px-3 text-sm disabled:opacity-50"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous</button>
                <button type="button" disabled={!hasMore || isLoading} onClick={() => setOffset((value) => value + PAGE_LIMIT)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#d9ded5] px-3 text-sm disabled:opacity-50">Next <ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
          </div>
        )}
      </section>

      {selectedId && (isDetailLoading ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"><LoadingState>Loading officer details…</LoadingState></div>
      ) : detailError ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5">
            <p role="alert" className="text-sm text-[#8b3c2d]">{detailError}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedId(null)} className="min-h-10 rounded-lg border border-[#d9ded5] px-4 text-sm">Close</button>
              <button type="button" onClick={() => setDetailRetry((value) => value + 1)} className="min-h-10 rounded-lg bg-[#1d4933] px-4 text-sm font-semibold text-white">Retry</button>
            </div>
          </div>
        </div>
      ) : detail ? <OfficerDetails officer={detail} teams={allTeams} teamsError={allTeamsError} onClose={() => setSelectedId(null)} onRefresh={() => { setDetailRetry((value) => value + 1); setRetry((value) => value + 1); }} onRetryTeams={() => setTeamsRetry((value) => value + 1)} /> : null)}
    </div>
  );
}
