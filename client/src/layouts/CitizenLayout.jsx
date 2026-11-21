import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useDismissableLayer } from '../context/DismissableLayerContext.jsx';
import nammakkalLogo from '../assets/nammakkal-logo.png';
import { getUnreadNotificationCount } from '../api/notifications.js';
import ProfileAvatar from '../components/citizen/ProfileAvatar.jsx';
import { useTranslation } from '../i18n/LocaleProvider.jsx';
import { Menu } from 'lucide-react';

function SidebarIcon({ name }) {
  const iconProps = {
    'aria-hidden': true,
    className: 'h-5 w-5 shrink-0',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.8,
    viewBox: '0 0 24 24'
  };

  switch (name) {
    case 'overview':
      return <svg {...iconProps}><path d="m3 10 9-7 9 7" /><path d="M5.5 9v11h13V9M9.5 20v-6h5v6" /></svg>;
    case 'report':
      return <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
    case 'complaints':
      return <svg {...iconProps}><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
    case 'announcements':
      return <svg {...iconProps}><path d="M3 11v2h3l10 5V6L6 11H3Z" /><path d="m6 13 1.5 5M19 9a4 4 0 0 1 0 6" /></svg>;
    case 'notifications':
      return <svg {...iconProps}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>;
    case 'profile':
      return <svg {...iconProps}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
    case 'help':
      return <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.3 1.7c-1.2 1.1-1.9 1.5-1.9 3M12 17.5h.01" /></svg>;
    default:
      return null;
  }
}

export default function CitizenLayout() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const {
    isOpen: isMoreOpen,
    triggerRef: moreTriggerRef,
    panelRef: morePanelRef,
    toggle: toggleMoreMenu,
    close: closeMoreMenu
  } = useDismissableLayer('citizen-more');
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () => getUnreadNotificationCount().then((result) => { if (active) setUnreadCount(result.unreadCount); }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener('nammakkal:notifications-updated', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('nammakkal:notifications-updated', refresh); };
  }, [user?.id]);

  const sidebarLinkClass = ({ isActive }) => `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e2c77f] ${isActive ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'}`;
  const mobileLinkClass = ({ isActive }) => `flex min-h-14 flex-1 items-center justify-center px-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1d4933] ${isActive ? 'text-[#1d4933]' : 'text-[#68736a]'}`;
  const displayName = typeof user?.name === 'string' ? user.name.trim() : '';
  const citizenType = user?.role === 'CITIZEN' ? t('navigation.citizenType') : '';

  return (
    <div className="min-h-screen bg-[#f7f6ef] lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <header className="relative z-30 bg-[#173d2b] text-white shadow-sm lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:mx-0 lg:max-w-none lg:flex-col lg:items-stretch lg:px-5 lg:py-7">
          <Link
            to="/citizen"
            onClick={closeMoreMenu}
            className="inline-flex w-fit shrink-0 rounded-lg px-1 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <img
              src={nammakkalLogo}
              alt="NAMMAKKAL civic platform"
              className="h-12 w-auto max-w-44 object-contain sm:h-14 sm:max-w-52"
            />
          </Link>
          <Link
            to="/citizen/profile"
            onClick={closeMoreMenu}
            aria-label={`${displayName || citizenType}, ${citizenType}, ${t('navigation.profile')}`}
            className="group hidden min-w-0 items-center gap-3 rounded-xl border border-white/15 bg-white/5 p-3 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e2c77f] lg:flex"
          >
            <ProfileAvatar user={user} alt={`${displayName || 'Citizen'} profile photo`} className="h-12 w-12 border border-[#e2c77f]/70 bg-[#e2c77f]/15 text-sm text-[#f4d88e]" />
            <span className="min-w-0 flex-1 text-left">
              <span title={displayName || undefined} className="block truncate text-sm font-semibold text-white">{displayName || citizenType}</span>
              <span className="block truncate text-xs text-white/70">
                {t(
                  `profile.citizenTypes.${
                    ['MINOR', 'CITIZEN', 'SENIOR_CITIZEN'].includes(
                      user?.ageBasedCitizenCategory
                    )
                      ? user.ageBasedCitizenCategory
                      : 'NOT_SET'
                  }`
                )}
              </span>
            </span>
            <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-white/60 transition group-hover:translate-x-0.5 group-hover:text-white" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>

          <nav aria-label="Citizen navigation" className="flex items-center gap-2 lg:mt-6 lg:flex-1 lg:flex-col lg:items-stretch lg:gap-1">
            <div className="hidden lg:block">
              <NavLink to="/citizen" end className={sidebarLinkClass}><SidebarIcon name="overview" /><span className="min-w-0 truncate">{t('navigation.overview')}</span></NavLink>
            </div>
            <div className="hidden lg:block">
              <NavLink to="/citizen/complaints/new" className={sidebarLinkClass}><SidebarIcon name="report" /><span className="min-w-0 truncate">{t('navigation.report')}</span></NavLink>
            </div>
            <div className="hidden lg:block">
              <NavLink to="/citizen/complaints" end className={sidebarLinkClass}><SidebarIcon name="complaints" /><span className="min-w-0 truncate">{t('navigation.complaints')}</span></NavLink>
            </div>
            <div className="hidden lg:block">
              <NavLink to="/citizen/announcements" className={sidebarLinkClass}><SidebarIcon name="announcements" /><span className="min-w-0 truncate">{t('navigation.announcements')}</span></NavLink>
            </div>
            <div className="hidden lg:block">
              <NavLink to="/citizen/notifications" className={sidebarLinkClass}><SidebarIcon name="notifications" /><span className="min-w-0 truncate">{t('navigation.notifications')}</span>{unreadCount > 0 && <span className="ml-auto rounded-full bg-[#e2c77f] px-2 py-0.5 text-xs font-bold text-[#213c2a]">{unreadCount > 99 ? '99+' : unreadCount}</span>}</NavLink>
            </div>
            <div className="hidden lg:block">
              <NavLink to="/citizen/profile" className={sidebarLinkClass}><SidebarIcon name="profile" /><span className="min-w-0 truncate">{t('navigation.profile')}</span></NavLink>
            </div>
            <div className="hidden lg:block">
              <NavLink to="/citizen/help" className={sidebarLinkClass}><SidebarIcon name="help" /><span className="min-w-0 truncate">{t('navigation.help')}</span></NavLink>
            </div>
            <button
                type="button"
                ref={moreTriggerRef}
                onClick={toggleMoreMenu}
                aria-label={t('navigation.more')}
                aria-expanded={isMoreOpen}
                aria-controls="citizen-secondary-menu"
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-white/25 text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e2c77f] lg:hidden"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </button>
          </nav>

        </div>

        {isMoreOpen && (
          <div ref={morePanelRef} id="citizen-secondary-menu" className="absolute right-4 top-full z-50 mt-2 w-64 rounded-2xl border border-[#e5e2d5] bg-white p-2 text-[#24362a] shadow-xl lg:hidden">
            <NavLink to="/citizen/announcements" onClick={closeMoreMenu} className={({ isActive }) => `flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${isActive ? 'bg-[#edf2eb] text-[#1d4933]' : 'hover:bg-[#f7f8f5]'}`}>{t('navigation.announcements')}</NavLink>
            <NavLink to="/citizen/notifications" onClick={closeMoreMenu} className={({ isActive }) => `flex min-h-11 items-center justify-between rounded-lg px-3 text-sm font-medium ${isActive ? 'bg-[#edf2eb] text-[#1d4933]' : 'hover:bg-[#f7f8f5]'}`}><span>{t('navigation.notifications')}</span>{unreadCount > 0 && <span className="rounded-full bg-[#e2c77f] px-2 py-0.5 text-xs font-bold text-[#213c2a]">{unreadCount}</span>}</NavLink>
            <NavLink to="/citizen/help" onClick={closeMoreMenu} className={({ isActive }) => `flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${isActive ? 'bg-[#edf2eb] text-[#1d4933]' : 'hover:bg-[#f7f8f5]'}`}>{t('navigation.help')}</NavLink>
          </div>
        )}
      </header>

      <main className="mx-auto w-full min-w-0 max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:mx-0 lg:px-10 lg:pb-10">
        <Outlet />
      </main>

      <nav aria-label={t('navigation.mobile')} className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[#d9ded5] bg-white/95 px-2 pt-1 shadow-[0_-4px_18px_rgba(23,61,43,0.08)] backdrop-blur lg:hidden" style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}>
        <NavLink to="/citizen" end className={mobileLinkClass}>{t('navigation.home')}</NavLink>
        <NavLink to="/citizen/complaints/new" className={mobileLinkClass}>{t('navigation.reportShort')}</NavLink>
        <NavLink to="/citizen/complaints" end className={mobileLinkClass}>{t('navigation.complaintsShort')}</NavLink>
        <NavLink to="/citizen/profile" className={mobileLinkClass}>{t('navigation.profileShort')}</NavLink>
      </nav>
    </div>
  );
}
