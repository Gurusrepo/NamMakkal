import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAdminAnnouncements, publishAnnouncement } from '../../api/announcements.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { requestOnce } from '../../utils/requestOnce.js';

const PAGE_LIMIT = 20;

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function ManageAnnouncements() {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');
    requestOnce(`admin:${user?.id}:announcements:${retry}`, () => listAdminAnnouncements({ limit: PAGE_LIMIT, offset: 0 }))
      .then((result) => { if (active) setItems(Array.isArray(result.items) ? result.items : []); })
      .catch((error) => { if (active) setLoadError(getApiErrorMessage(error, 'Announcements could not be loaded.')); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [retry, user?.id]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');
    setIsPublishing(true);
    try {
      const result = await publishAnnouncement({ title: title.trim(), description: description.trim() });
      setLoadError('');
      setItems((current) => [result.announcement, ...current].slice(0, PAGE_LIMIT));
      setTitle('');
      setDescription('');
    } catch (error) {
      setSubmitError(getApiErrorMessage(error, 'Announcement could not be published.'));
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Community updates</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#20382a]">Publish an announcement</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm sm:p-7">
        <div>
          <label htmlFor="announcement-title" className="mb-2 block text-sm font-semibold text-[#34483a]">Title</label>
          <input id="announcement-title" required minLength={3} maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-12 w-full rounded-xl border border-[#d9ded5] px-4 py-3 text-sm outline-none focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" />
          <p className="mt-1 text-right text-xs text-[#758077]">{title.length}/160</p>
        </div>
        <div>
          <label htmlFor="announcement-description" className="mb-2 block text-sm font-semibold text-[#34483a]">Description</label>
          <textarea id="announcement-description" required maxLength={3000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded-xl border border-[#d9ded5] px-4 py-3 text-sm leading-6 outline-none focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" />
          <p className="mt-1 text-right text-xs text-[#758077]">{description.length}/3000</p>
        </div>
        {submitError && <p role="alert" className="rounded-xl border border-[#e9c9c2] bg-[#fff5f2] px-4 py-3 text-sm text-[#8b3c2d]">{submitError}</p>}
        <button type="submit" disabled={isPublishing} className="min-h-11 rounded-xl bg-[#1d4933] px-5 text-sm font-semibold text-white hover:bg-[#163b29] disabled:cursor-wait disabled:opacity-60">{isPublishing ? 'Publishing...' : 'Publish announcement'}</button>
      </form>

      <section aria-labelledby="published-announcements-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="published-announcements-heading" className="text-xl font-semibold text-[#20382a]">Recently published</h2>
          {loadError && <button type="button" onClick={() => setRetry((value) => value + 1)} className="text-sm font-semibold text-[#1d4933] underline underline-offset-4">Retry</button>}
        </div>
        {isLoading ? <LoadingState>Loading published announcements...</LoadingState> : loadError ? (
          <ErrorState onRetry={() => setRetry((value) => value + 1)}>{loadError}</ErrorState>
        ) : items.length === 0 ? (
          <EmptyState>No announcements have been published yet.</EmptyState>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm">
                <p className="text-xs text-[#758077]">Published {formatDate(item.publishedAt)}</p>
                <h3 className="mt-2 font-semibold text-[#20382a]">{item.title}</h3>
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-[#68736a]">{item.description}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
