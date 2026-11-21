import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { getApiErrorMessage } from '../../api/errors.js';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from '../../api/notifications.js';
import { EmptyState, ErrorState, LoadingState } from '../AsyncState.jsx';
import { useDismissableLayer } from '../../context/DismissableLayerContext.jsx';
import { useTranslation } from '../../i18n/LocaleProvider.jsx';

const PAGE_LIMIT = 10;

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function NotificationMenu() {
  const { t } = useTranslation();
  const {
    isOpen,
    triggerRef,
    panelRef,
    toggle,
    close
  } = useDismissableLayer('citizen-notifications');
  const [unreadCount, setUnreadCount] = useState(null);
  const [countError, setCountError] = useState('');
  const [countRetry, setCountRetry] = useState(0);
  const [items, setItems] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingId, setPendingId] = useState(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const requestSequence = useRef(0);
  const positionFrame = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequence.current += 1;
    };
  }, []);

  const positionPanel = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const rect = trigger.getBoundingClientRect();
    const edge = 12;
    const gap = 8;
    const width = Math.min(360, Math.max(0, window.innerWidth - edge * 2));
    const height = Math.min(panel.scrollHeight, window.innerHeight * 0.7, 500);
    const left = Math.min(Math.max(edge, rect.right - width), window.innerWidth - edge - width);
    const below = window.innerHeight - rect.bottom - gap - edge;
    const above = rect.top - gap - edge;
    const top = below >= Math.min(height, 180) || below >= above
      ? Math.min(rect.bottom + gap, window.innerHeight - edge - height)
      : Math.max(edge, rect.top - gap - height);

    const nextStyle = { left, top, width, maxHeight: Math.max(120, Math.min(500, window.innerHeight * 0.7)) };
    setPanelStyle((current) => current && current.left === nextStyle.left && current.top === nextStyle.top && current.width === nextStyle.width && current.maxHeight === nextStyle.maxHeight
      ? current
      : nextStyle);
  }, [triggerRef, panelRef]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPanelStyle(null);
      return undefined;
    }

    let active = true;
    const monitorPosition = () => {
      if (!active) return;
      positionPanel();
      positionFrame.current = requestAnimationFrame(monitorPosition);
    };
    const schedulePosition = () => {
      cancelAnimationFrame(positionFrame.current);
      positionFrame.current = requestAnimationFrame(monitorPosition);
    };
    schedulePosition();
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('orientationchange', schedulePosition);
    window.addEventListener('scroll', schedulePosition, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedulePosition);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      active = false;
      cancelAnimationFrame(positionFrame.current);
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('orientationchange', schedulePosition);
      window.removeEventListener('scroll', schedulePosition, true);
      observer?.disconnect();
    };
  }, [isOpen, positionPanel, triggerRef, panelRef, items.length, isLoading]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function refreshUnreadCount() {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await getUnreadNotificationCount();
        if (active) {
          setUnreadCount(result.unreadCount);
          setCountError('');
        }
      } catch (requestError) {
        if (active) setCountError(getApiErrorMessage(requestError, 'Unread notifications could not be checked.'));
      } finally {
        inFlight = false;
      }
    }

    refreshUnreadCount();
    const intervalId = setInterval(refreshUnreadCount, 60000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [countRetry]);

  async function loadPage(pageOffset = 0, append = false) {
    const sequence = ++requestSequence.current;
    setError('');
    setActionError('');
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    try {
      const result = await listNotifications({ limit: PAGE_LIMIT, offset: pageOffset });
      if (!mountedRef.current || sequence !== requestSequence.current) return;
      const pageItems = Array.isArray(result.items) ? result.items : [];
      setItems((current) => append ? [...current, ...pageItems] : pageItems);
      setOffset(pageOffset);
      setHasMore(Boolean(result.pagination?.hasMore));
    } catch (requestError) {
      if (!mountedRef.current || sequence !== requestSequence.current) return;
      setError(getApiErrorMessage(requestError, 'Notifications could not be loaded.'));
    } finally {
      if (mountedRef.current && sequence === requestSequence.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }

  function toggleMenu() {
    const nextIsOpen = !isOpen;
    toggle();
    if (nextIsOpen) loadPage();
  }

  async function handleMarkRead(id) {
    setPendingId(id);
    setActionError('');
    try {
      const result = await markNotificationRead(id);
      if (!mountedRef.current) return;
      setItems((current) => current.map((item) => item.id === id ? result.notification : item));
      setCountRetry((value) => value + 1);
    } catch (requestError) {
      if (mountedRef.current) setActionError(getApiErrorMessage(requestError, 'This notification could not be marked as read.'));
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  }

  async function handleMarkAllRead() {
    setIsMarkingAll(true);
    setActionError('');
    try {
      await markAllNotificationsRead();
      if (!mountedRef.current) return;
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      setCountRetry((value) => value + 1);
    } catch (requestError) {
      if (mountedRef.current) setActionError(getApiErrorMessage(requestError, 'Notifications could not be marked as read.'));
    } finally {
      if (mountedRef.current) setIsMarkingAll(false);
    }
  }

  function refreshMenu() {
    loadPage();
    setCountRetry((value) => value + 1);
  }

  const notificationsLabel = t('navigation.notifications');

  return (
    <div className="relative">
      <button
        type="button"
        ref={triggerRef}
        onClick={toggleMenu}
        aria-expanded={isOpen}
        aria-controls="citizen-notification-menu"
        aria-label={unreadCount === null ? notificationsLabel : `${notificationsLabel}, ${unreadCount} unread`}
        className={`relative inline-flex min-h-10 shrink-0 items-center gap-3 rounded-lg border border-white/25 px-3 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-[#e2c77f] lg:min-h-11 lg:w-full lg:rounded-xl lg:border-transparent lg:text-left ${isOpen ? 'bg-white/15' : 'hover:bg-white/10'}`}
      >
        <svg aria-hidden="true" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        <span className="min-w-0 truncate">{notificationsLabel}</span>
        {unreadCount > 0 && <span aria-hidden="true" className="ml-1 inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[#e2c77f] px-1.5 py-0.5 text-xs font-bold text-[#213c2a] lg:ml-auto">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {isOpen && createPortal(
        <section ref={panelRef} id="citizen-notification-menu" role="region" aria-label="Notifications" style={{ ...panelStyle, position: 'fixed', boxSizing: 'border-box', zIndex: 1000, visibility: panelStyle ? 'visible' : 'hidden' }} className="overflow-y-auto rounded-2xl border border-[#e5e2d5] bg-white p-4 text-[#24362a] shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#20382a]">Notifications</h2>
            <button type="button" onClick={refreshMenu} className="rounded px-2 py-1 text-sm font-semibold text-[#1d4933] underline underline-offset-2">Refresh</button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-[#68736a]">{unreadCount === null ? 'Unread count unavailable' : `${unreadCount} unread`}</p>
            {unreadCount > 0 && <button type="button" onClick={handleMarkAllRead} disabled={isMarkingAll} className="text-xs font-semibold text-[#1d4933] underline underline-offset-2 disabled:opacity-60">{isMarkingAll ? 'Marking...' : 'Mark all as read'}</button>}
          </div>
          {countError && <div className="mt-3"><ErrorState onRetry={() => setCountRetry((value) => value + 1)}>{countError}</ErrorState></div>}
          {actionError && <p role="alert" className="mt-3 rounded-lg bg-[#fff5f2] px-3 py-2 text-xs text-[#8b3c2d]">{actionError}</p>}
          <div className="mt-3 space-y-2">
            {isLoading && items.length === 0 ? <LoadingState>Loading notifications...</LoadingState> : error && items.length === 0 ? (
              <ErrorState onRetry={() => loadPage()}>{error}</ErrorState>
            ) : items.length === 0 ? (
              <EmptyState>You do not have any notifications yet.</EmptyState>
            ) : (
              <>
                {error && <ErrorState onRetry={() => loadPage(offset)}>{error}</ErrorState>}
                {items.map((item) => (
                  <article key={item.id} className={`rounded-xl border p-3 ${item.isRead ? 'border-[#e5e2d5] bg-white' : 'border-[#d4e2d3] bg-[#f2f8f1]'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[#20382a]">{item.title}</h3>
                      {!item.isRead && <span aria-label="Unread" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#2b7650]" />}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#526258]">{item.message}</p>
                    <p className="mt-2 text-[11px] text-[#758077]">{formatTimestamp(item.createdAt)}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      {item.relatedComplaintId
                        ? <Link to={`/citizen/complaints/${item.relatedComplaintId}`} onClick={close} className="text-xs font-semibold text-[#1d4933] underline underline-offset-2">View complaint</Link>
                        : item.relatedSupportReference
                          ? <Link to="/citizen/help" onClick={close} className="text-xs font-semibold text-[#1d4933] underline underline-offset-2">View update</Link>
                          : <span />}
                      {!item.isRead && <button type="button" onClick={() => handleMarkRead(item.id)} disabled={pendingId === item.id} className="text-xs font-semibold text-[#1d4933] underline underline-offset-2 disabled:opacity-60">{pendingId === item.id ? 'Saving...' : 'Mark as read'}</button>}
                    </div>
                  </article>
                ))}
                {hasMore && <button type="button" disabled={isLoadingMore} onClick={() => loadPage(offset + PAGE_LIMIT, true)} className="min-h-10 w-full rounded-lg border border-[#cfd8ce] text-sm font-semibold text-[#1d4933] disabled:opacity-60">{isLoadingMore ? 'Loading...' : 'Load more'}</button>}
              </>
            )}
          </div>
        </section>,
        document.body
      )}
    </div>
  );
}
