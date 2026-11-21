import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, Flag, Lightbulb, Megaphone, Users
} from 'lucide-react';
import { getAdminDashboard } from '../../api/admin.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { requestOnce } from '../../utils/requestOnce.js';

const statisticCards = [
  { key: 'totalComplaints', label: 'Total complaints', icon: ClipboardList, path: 'complaints', accent: 'border-[#d4ae58]' },
  { key: 'openComplaints', label: 'Open complaints', icon: Flag, path: 'complaints', accent: 'border-amber-400' },
  { key: 'inProgressComplaints', label: 'In progress', icon: ClipboardList, path: 'complaints', accent: 'border-sky-500' },
  { key: 'resolvedComplaints', label: 'Resolved complaints', icon: ClipboardList, path: 'complaints', accent: 'border-emerald-500' },
  { key: 'reportedProblems', label: 'Reported problems', icon: Flag, path: 'reported-problems', accent: 'border-rose-400' },
  { key: 'suggestions', label: 'Suggestions', icon: Lightbulb, path: 'suggestions', accent: 'border-violet-400' },
  { key: 'activeOfficers', label: 'Active officers', icon: Users, path: 'officers', accent: 'border-teal-500' },
  { key: 'publishedAnnouncements', label: 'Published announcements', icon: Megaphone, path: 'announcements', accent: 'border-[#d4ae58]' }
];

const statusLabels = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved'
};

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function SectionHeading({ id, title, link, linkLabel }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="text-lg font-semibold text-[#20382a]">{title}</h2>
      {link && (
        <Link
          to={link}
          className="shrink-0 text-sm font-semibold text-[#1d4933] underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

export default function AdminOverview() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');

    requestOnce(`admin:${user?.id}:dashboard:${retry}`, getAdminDashboard)
      .then((result) => {
        if (active) setDashboard(result);
      })
      .catch((error) => {
        if (active) setLoadError(getApiErrorMessage(error, 'The dashboard could not be loaded.'));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retry, user?.id]);

  if (isLoading) {
    return <LoadingState>Loading dashboard statistics...</LoadingState>;
  }

  if (loadError) {
    return (
      <ErrorState
        onRetry={() => setRetry((value) => value + 1)}
        retryLabel="Try again"
      >
        {loadError}
      </ErrorState>
    );
  }

  const { summary, recent } = dashboard;

  return (
    <div className="space-y-8">
      <header>
        <p className="mt-3 max-w-3xl text-sm leading-6 tracking-[0.16em] text-[#9a7832]">
          A live summary of civic issues, citizen submissions, active officers and published announcements.
        </p>
      </header>

      <section aria-label="Dashboard statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {statisticCards.map(({ key, label, icon: Icon, path, accent }) => (
          <Link
            key={key}
            to={`/admin/${path}`}
            className={`group min-h-32 rounded-2xl border-l-4 ${accent} bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/50 sm:p-5`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium leading-5 text-[#68736a] sm:text-sm">
                {label}
              </p>
              <Icon className="h-5 w-5 shrink-0 text-[#477454]" aria-hidden="true" />
            </div>
            <p className="mt-4 text-3xl font-semibold tabular-nums text-[#20382a]">
              {summary[key]}
            </p>
          </Link>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section aria-labelledby="admin-recent-complaints" className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
          <SectionHeading
            id="admin-recent-complaints"
            title="Recent complaints"
            link="/admin/complaints"
            linkLabel="View all"
          />
          {recent.complaints.length === 0 ? (
            <EmptyState>No complaints have been submitted yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[#ece9df]">
              {recent.complaints.map((complaint) => (
                <li key={complaint.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#34483a]">{complaint.title}</p>
                    <p className="mt-1 text-xs text-[#758077]">
                      Complaint #{complaint.id}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-[#385743]">
                      {statusLabels[complaint.status] || 'Status unavailable'}
                    </p>
                    <p className="mt-1 text-xs text-[#758077]">
                      {formatDate(complaint.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="admin-recent-support" className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
          <SectionHeading
            id="admin-recent-support"
            title="Recent citizen submissions"
            link="/admin/reported-problems"
            linkLabel="View all"
          />
          {recent.supportSubmissions.length === 0 ? (
            <EmptyState>No citizen submissions have been received yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[#ece9df]">
              {recent.supportSubmissions.map((submission) => (
                <li key={submission.referenceId} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#34483a]">{submission.title}</p>
                    <p className="mt-1 truncate text-xs text-[#758077]">
                      {submission.referenceId} · {submission.category}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-[#385743]">
                      {submission.kind === 'BUG_REPORT' ? 'Reported problem' : 'Suggestion'}
                    </p>
                    <p className="mt-1 text-xs text-[#758077]">
                      {formatDate(submission.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="admin-recent-announcements" className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
          <SectionHeading
            id="admin-recent-announcements"
            title="Published announcements"
            link="/admin/announcements"
            linkLabel="View all"
          />
          {recent.announcements.length === 0 ? (
            <EmptyState>No public announcements have been published yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[#ece9df]">
              {recent.announcements.map((announcement) => (
                <li key={announcement.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <p className="min-w-0 text-sm font-semibold text-[#34483a]">{announcement.title}</p>
                  <p className="shrink-0 text-right text-xs text-[#758077]">
                    {formatDate(announcement.publishedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="admin-quick-links" className="hidden sm:block space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-4 shadow-sm sm:p-5">
          <SectionHeading id="admin-quick-links" title="Quick links" />
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Complaints', path: 'complaints', icon: ClipboardList },
              { label: 'Reported problems', path: 'reported-problems', icon: Flag },
              { label: 'Suggestions', path: 'suggestions', icon: Lightbulb },
              { label: 'Announcements', path: 'announcements', icon: Megaphone },
              { label: 'Officers', path: 'officers', icon: Users }
            ].map(({ label, path, icon: Icon }) => (
              <Link
                key={path}
                to={`/admin/${path}`}
                className="flex min-h-12 items-center gap-3 rounded-xl border border-[#e5e2d5] px-3 text-sm font-semibold text-[#34483a] transition hover:border-[#9bb29b] hover:bg-[#f7faf5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
              >
                <Icon className="h-4 w-4 text-[#477454]" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
