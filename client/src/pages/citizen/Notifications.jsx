import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiErrorMessage } from '../../api/errors.js';
import { getUnreadNotificationCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '../../api/notifications.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';

const PAGE_LIMIT = 20;

function dateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function category(type) {
  if (type === 'SUPPORT_UPDATE') return 'Help & Support update';
  if (type.startsWith('ISSUE_') || type.startsWith('DISPUTE_')) return 'Complaint update';
  if (type.startsWith('ANNOUNCEMENT_')) return 'Announcement';
  if (type.startsWith('ACCOUNT_') || type.startsWith('VERIFICATION_')) return 'Account and verification';
  if (type.startsWith('APPLICATION_')) return 'Service and application';
  return 'General update';
}

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [workingId, setWorkingId] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);

  const load = useCallback(async (start = 0, append = false) => {
    setError('');
    if (!append) setLoading(true);
    try {
      const [result, count] = await Promise.all([listNotifications({ limit: PAGE_LIMIT, offset: start }), getUnreadNotificationCount()]);
      const page = Array.isArray(result.items) ? result.items : [];
      setItems((current) => append ? [...current, ...page] : page);
      setHasMore(Boolean(result.pagination?.hasMore));
      setOffset(start);
      setUnreadCount(count.unreadCount);
    } catch (requestError) { setError(getApiErrorMessage(requestError, 'Notifications could not be loaded.')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, retry]);

  async function read(id) {
    setWorkingId(id); setActionError('');
    try {
      const result = await markNotificationRead(id);
      setItems((current) => current.map((item) => item.id === id ? result.notification : item));
      setUnreadCount((count) => Math.max(0, (count ?? 1) - 1));
      window.dispatchEvent(new Event('nammakkal:notifications-updated'));
    } catch (requestError) { setActionError(getApiErrorMessage(requestError, 'This notification could not be updated.')); }
    finally { setWorkingId(null); }
  }

  async function readAll() {
    setMarkingAll(true); setActionError('');
    try { await markAllNotificationsRead(); setItems((current) => current.map((item) => ({ ...item, isRead: true }))); setUnreadCount(0); window.dispatchEvent(new Event('nammakkal:notifications-updated')); }
    catch (requestError) { setActionError(getApiErrorMessage(requestError, 'Notifications could not be updated.')); }
    finally { setMarkingAll(false); }
  }

  return <div className="mx-auto max-w-4xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Citizen updates</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#20382a]">Notifications</h1><p className="mt-2 text-sm text-[#68736a]">Updates about your complaints and citizen services.</p></div>
      <div className="flex items-center gap-3"><span className="text-sm text-[#68736a]">{unreadCount === null ? 'Unread count unavailable' : `${unreadCount} unread`}</span><button type="button" disabled={!unreadCount || markingAll} onClick={readAll} className="min-h-10 rounded-xl border border-[#cfd8ce] bg-white px-3 text-sm font-semibold text-[#1d4933] disabled:opacity-50">{markingAll ? 'Updating…' : 'Mark all as read'}</button></div>
    </header>
    {actionError && <p role="alert" className="rounded-xl border border-[#e9c9c2] bg-[#fff5f2] p-3 text-sm text-[#8b3c2d]">{actionError}</p>}
    {error && items.length === 0 ? <ErrorState onRetry={() => setRetry((n) => n + 1)}>{error}</ErrorState> : loading && !items.length ? <LoadingState>Loading notifications…</LoadingState> : !items.length ? <EmptyState>You do not have any notifications yet.</EmptyState> : <div className="space-y-3">{items.map((item) => <article key={item.id} className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${item.isRead ? 'border-[#e5e2d5] bg-white' : 'border-[#d4e2d3] bg-[#f7faf5]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><span className="inline-flex rounded-full bg-[#edf2eb] px-2.5 py-1 text-xs font-semibold text-[#385743]">{category(item.notificationType)}</span><h2 className="mt-3 text-lg font-semibold text-[#20382a]">{item.title}</h2></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.isRead ? 'bg-[#f1f2ef] text-[#68736a]' : 'bg-[#dcebdd] text-[#1d4933]'}`}>{item.isRead ? 'Read' : 'Unread'}</span></div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#526258]">{item.message}</p><p className="mt-3 text-xs text-[#758077]"><time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time></p>
      {item.relatedSupportReference && <p className="mt-3 text-xs font-semibold text-[#758077]">Reference: {item.relatedSupportReference}</p>}
      <div className="mt-3 flex flex-wrap gap-4">{item.relatedComplaintId && <Link to={`/citizen/complaints/${item.relatedComplaintId}`} onClick={() => !item.isRead && read(item.id)} className="text-sm font-semibold text-[#1d4933] underline underline-offset-2">Open related complaint</Link>}{item.relatedSupportReference && <Link to="/citizen/help" onClick={() => !item.isRead && read(item.id)} className="text-sm font-semibold text-[#1d4933] underline underline-offset-2">Open Help & Support</Link>}{!item.isRead && <button type="button" disabled={workingId === item.id} onClick={() => read(item.id)} className="text-sm font-semibold text-[#1d4933] underline underline-offset-2 disabled:opacity-60">{workingId === item.id ? 'Saving…' : 'Mark as read'}</button>}</div>
    </article>)}{hasMore && <div className="text-center"><button type="button" onClick={() => load(offset + PAGE_LIMIT, true)} className="min-h-11 rounded-xl border border-[#cfd8ce] bg-white px-5 text-sm font-semibold text-[#1d4933]">Load more</button></div>}</div>}
  </div>;
}
