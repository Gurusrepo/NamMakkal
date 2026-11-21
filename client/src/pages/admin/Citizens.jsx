import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, UserRound, X } from 'lucide-react';
import { deleteCitizen, getCitizen, listCitizens, updateCitizenStatus } from '../../api/admin.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';

const PAGE_LIMIT = 20;
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export default function Citizens() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [actionId, setActionId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    listCitizens({ limit: PAGE_LIMIT, offset, search: search.trim() || undefined, status: status || undefined })
      .then((result) => {
        if (!active) return;
        setItems(result.items ?? []);
        setHasMore(Boolean(result.pagination?.hasMore));
      })
      .catch((requestError) => { if (active) setError(getApiErrorMessage(requestError, 'Citizens could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, status, offset, retry]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError('');
      return undefined;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    getCitizen(selectedId)
      .then((result) => { if (active) setDetail(result); })
      .catch((requestError) => { if (active) setDetailError(getApiErrorMessage(requestError, 'Citizen details could not be loaded.')); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, retry]);

  async function changeStatus(citizen, nextStatus) {
    const action = nextStatus === 'DEACTIVATED' ? 'deactivate' : 'reactivate';
    if (!window.confirm(`Confirm ${action} for ${citizen.name}?`)) return;
    setActionId(citizen.id);
    setActionError('');
    setActionMessage('');
    try {
      await updateCitizenStatus(citizen.id, { status: nextStatus });
      setActionMessage(`Citizen ${action}d successfully.`);
      setRetry((value) => value + 1);
    } catch (requestError) {
      setActionError(getApiErrorMessage(requestError, `Citizen could not be ${action}d.`));
    } finally {
      setActionId(null);
    }
  }

  async function removeCitizen(citizen) {
    if (!window.confirm(`Delete ${citizen.name}? This archives the account and preserves complaints and audit records.`)) return;
    setActionId(citizen.id);
    setActionError('');
    setActionMessage('');
    try {
      await deleteCitizen(citizen.id);
      setActionMessage('Citizen account archived successfully.');
      setSelectedId(null);
      setRetry((value) => value + 1);
    } catch (requestError) {
      setActionError(getApiErrorMessage(requestError, 'Citizen account could not be archived.'));
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Account administration</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#20382a]">Citizens</h1></header>
      {actionError && <p role="alert" className="rounded-xl border border-[#e9c9c2] bg-[#fff5f2] px-4 py-3 text-sm text-[#8b3c2d]">{actionError}</p>}
      {actionMessage && <p role="status" className="rounded-xl border border-[#d4e2d3] bg-[#f2f8f1] px-4 py-3 text-sm text-[#385743]">{actionMessage}</p>}
      <section className="grid gap-3 rounded-2xl border border-[#e5e2d5] bg-white p-4 sm:grid-cols-[minmax(0,1fr)_14rem_auto_auto]">
        <label className="text-sm font-medium text-[#34483a]">Search name or email<input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3" /></label>
        <label className="text-sm font-medium text-[#34483a]">Status<select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} className="mt-1 min-h-11 w-full rounded-xl border border-[#d9ded5] px-3"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="DEACTIVATED">Deactivated</option></select></label>
        <button type="button" onClick={() => { setSearch(''); setStatus(''); setOffset(0); }} className="min-h-11 self-end rounded-xl border border-[#d9ded5] px-4 text-sm font-semibold text-[#34483a]">Clear</button>
        <button type="button" onClick={() => setRetry((value) => value + 1)} className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-xl px-3 text-sm font-semibold text-[#1d4933]"><RefreshCw className="h-4 w-4" />Refresh</button>
      </section>
      {loading ? <LoadingState>Loading citizens…</LoadingState> : error ? <ErrorState onRetry={() => setRetry((value) => value + 1)}>{error}</ErrorState> : items.length === 0 ? <EmptyState>No citizens match these filters.</EmptyState> : (
        <div className="overflow-hidden rounded-2xl border border-[#e5e2d5] bg-white shadow-sm">
          <ul className="divide-y divide-[#ebe9df]">{items.map((citizen) => (
            <li key={citizen.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex min-w-0 items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eef2eb] text-[#1d4933]"><UserRound className="h-5 w-5" /></span><div className="min-w-0"><h2 className="truncate font-semibold text-[#20382a]">{citizen.name}</h2><p className="truncate text-sm text-[#68736a]">{citizen.email}</p><p className="mt-1 text-xs text-[#68736a]">{citizen.status} · Registered {formatDate(citizen.createdAt)} · {citizen.complaintCount} complaints</p></div></div>
              <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setSelectedId(citizen.id)} className="min-h-10 rounded-xl border border-[#d9ded5] px-4 text-sm font-semibold text-[#34483a]">View details</button>{citizen.status === 'ACTIVE' ? <button type="button" disabled={actionId === citizen.id} onClick={() => changeStatus(citizen, 'DEACTIVATED')} className="min-h-10 rounded-xl border border-amber-200 px-4 text-sm font-semibold text-amber-800 disabled:opacity-50">Deactivate</button> : <button type="button" disabled={actionId === citizen.id} onClick={() => changeStatus(citizen, 'ACTIVE')} className="min-h-10 rounded-xl bg-[#1d4933] px-4 text-sm font-semibold text-white disabled:opacity-50">Activate</button>}<button type="button" disabled={actionId === citizen.id} onClick={() => removeCitizen(citizen)} className="min-h-10 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-800 disabled:opacity-50">Delete</button></div>
            </li>
          ))}</ul>
          <div className="flex items-center justify-between border-t border-[#ebe9df] px-4 py-3"><span className="text-xs text-[#68736a]">Page {Math.floor(offset / PAGE_LIMIT) + 1}</span><div className="flex gap-2"><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - PAGE_LIMIT))} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#d9ded5] px-3 text-sm disabled:opacity-50"><ChevronLeft className="h-4 w-4" />Previous</button><button type="button" disabled={!hasMore || loading} onClick={() => setOffset((value) => value + PAGE_LIMIT)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#d9ded5] px-3 text-sm disabled:opacity-50">Next<ChevronRight className="h-4 w-4" /></button></div></div>
        </div>
      )}
      {selectedId && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6" role="dialog" aria-modal="true"><section className="my-auto w-full max-w-4xl rounded-2xl bg-[#f7f6ef] shadow-2xl"><header className="flex items-start justify-between gap-4 rounded-t-2xl bg-[#173d2b] px-5 py-4 text-white"><div><p className="text-xs uppercase tracking-[0.14em] text-[#e2c77f]">Citizen details</p><h2 className="mt-1 text-xl font-semibold">{detail?.citizen.name ?? 'Loading citizen'}</h2></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close citizen details" className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></button></header><div className="p-4 sm:p-6">{detailLoading ? <LoadingState>Loading citizen details…</LoadingState> : detailError ? <ErrorState onRetry={() => setRetry((value) => value + 1)}>{detailError}</ErrorState> : detail && <div className="space-y-5"><dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><dt className="text-xs text-[#68736a]">Email</dt><dd className="mt-1 break-all font-semibold">{detail.citizen.email}</dd></div><div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><dt className="text-xs text-[#68736a]">Status</dt><dd className="mt-1 font-semibold">{detail.citizen.status}</dd></div><div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><dt className="text-xs text-[#68736a]">Registered</dt><dd className="mt-1 font-semibold">{formatDate(detail.citizen.createdAt)}</dd></div><div className="rounded-xl border border-[#e5e2d5] bg-white p-4"><dt className="text-xs text-[#68736a]">Complaints</dt><dd className="mt-1 font-semibold">{detail.complaintCount}</dd></div></dl><section className="rounded-xl border border-[#e5e2d5] bg-white p-4"><h3 className="font-semibold text-[#20382a]">Complaint history</h3>{detail.complaints.length === 0 ? <p className="mt-2 text-sm text-[#68736a]">No complaints found.</p> : <ul className="mt-3 divide-y divide-[#ebe9df]">{detail.complaints.map((complaint) => <li key={complaint.id} className="py-3"><p className="font-semibold text-[#34483a]">{complaint.reference} · {complaint.title}</p><p className="mt-1 text-xs text-[#68736a]">{complaint.status} · Submitted {formatDate(complaint.submittedAt)}</p></li>)}</ul>}</section></div>}</div></section></div>}
    </div>
  );
}
