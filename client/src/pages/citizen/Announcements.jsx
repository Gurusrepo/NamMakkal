import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAnnouncements } from '../../api/announcements.js';
import { getApiErrorMessage } from '../../api/errors.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { requestOnce } from '../../utils/requestOnce.js';

const PAGE_LIMIT = 20;

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export default function Announcements() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    if (offset === 0) setIsLoading(true);
    else setIsLoadingMore(true);

    requestOnce(`citizen:${user?.id}:announcements:${offset}:${retry}`, () => listAnnouncements({ limit: PAGE_LIMIT, offset }))
      .then((result) => {
        if (!active) return;
        const pageItems = Array.isArray(result.items) ? result.items : [];
        setItems((current) => offset === 0 ? pageItems : [...current, ...pageItems]);
        setHasMore(Boolean(result.pagination?.hasMore));
      })
      .catch((requestError) => { if (active) setError(getApiErrorMessage(requestError, 'Announcements could not be loaded.')); })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
        setIsLoadingMore(false);
      });

    return () => { active = false; };
  }, [offset, retry, user?.id]);

  function retryPage() {
    setRetry((value) => value + 1);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="mt-5 text-xl font-semibold uppercase tracking-[0.16em] text-[#9a7832]">From your community</p>
        <p className="mt-2 text-sm text-[#68736a]">News and notices from your local civil team.</p>
      </div>
      {error && items.length === 0 ? (
        <ErrorState onRetry={retryPage}>{error}</ErrorState>
      ) : isLoading && items.length === 0 ? (
        <LoadingState>Loading announcements...</LoadingState>
      ) : items.length === 0 ? (
        <EmptyState>There are no public announcements yet. Please check back soon.</EmptyState>
      ) : (
        <>
          {error && <ErrorState onRetry={retryPage}>We could not load more announcements. {error}</ErrorState>}
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map((announcement) => (
              <article key={announcement.id} className="flex flex-col rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm">
                <p className="text-xs font-medium text-[#758077]">Published {formatDate(announcement.publishedAt)}</p>
                <h2 className="mt-2 text-xl font-semibold text-[#20382a]">{announcement.title}</h2>
                <p className="mt-2 line-clamp-4 flex-1 whitespace-pre-wrap text-sm leading-6 text-[#68736a]">{announcement.description}</p>
                <Link to={`/citizen/announcements/${announcement.id}`} className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-[#1d4933] underline decoration-[#d4ae58] underline-offset-4">View announcement</Link>
              </article>
            ))}
          </div>
          {hasMore && <div className="flex justify-center"><button type="button" disabled={isLoadingMore} onClick={() => setOffset((value) => value + PAGE_LIMIT)} className="min-h-11 rounded-xl border border-[#cfd8ce] bg-white px-5 text-sm font-semibold text-[#1d4933] hover:bg-[#edf2eb] disabled:opacity-60">{isLoadingMore ? 'Loading more...' : 'Load more announcements'}</button></div>}
        </>
      )}
    </div>
  );
}
