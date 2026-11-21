import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listComplaints } from '../../api/complaints.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState.jsx';
import ComplaintCard from '../../components/citizen/ComplaintCard.jsx';
import { requestOnce } from '../../utils/requestOnce.js';
import { useAuth } from '../../context/AuthContext.jsx';

const PAGE_LIMIT = 20;

export default function MyComplaints() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    if (offset === 0) setIsLoading(true);
    else setIsLoadingMore(true);

    requestOnce(`citizen:${user?.id}:complaints:${offset}:${retry}`, () => listComplaints({ limit: PAGE_LIMIT, offset }))
      .then((result) => {
        if (!active) return;
        const items = Array.isArray(result.items) ? result.items : [];
        setComplaints((current) => offset === 0 ? items : [...current, ...items]);
        setHasMore(Boolean(result.pagination?.hasMore));
      })
      .catch((requestError) => { if (active) setError(requestError); })
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

  function loadMore() {
    if (!hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    setOffset((value) => value + PAGE_LIMIT);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xl font-semibold uppercase tracking-[0.16em] text-[#9a7832]">Track your reports</p>

          <p className="mt-2 text-sm text-[#68736a]">Your Contributions are very much important to the Society</p>
        </div>
      </div>

      {error && complaints.length === 0 ? (
        <ErrorState onRetry={retryPage}>We could not load your complaints. {error.message}</ErrorState>
      ) : isLoading && complaints.length === 0 ? (
        <LoadingState>Loading your complaints...</LoadingState>
      ) : complaints.length === 0 ? (
        <EmptyState>You have not submitted any complaints yet. Start with a clear description and a photo of the issue.</EmptyState>
      ) : (
        <>
          <p className="text-sm text-[#68736a]">Showing {complaints.length} {complaints.length === 1 ? 'complaint' : 'complaints'}.</p>
          {error && <ErrorState onRetry={retryPage}>We could not load the next page. {error.message}</ErrorState>}
          <div className="grid gap-4 lg:grid-cols-2">{complaints.map((complaint) => <ComplaintCard key={complaint.id} complaint={complaint} />)}</div>
          {hasMore && <div className="flex justify-center pt-2"><button type="button" disabled={isLoadingMore} onClick={loadMore} className="min-h-11 rounded-xl border border-[#cfd8ce] bg-white px-5 text-sm font-semibold text-[#1d4933] transition hover:bg-[#edf2eb] focus:outline-none focus:ring-4 focus:ring-[#477454]/20 disabled:cursor-wait disabled:opacity-60">{isLoadingMore ? 'Loading more...' : 'Load more complaints'}</button></div>}
        </>
      )}
    </div>
  );
}
