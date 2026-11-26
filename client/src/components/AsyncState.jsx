export function LoadingState({ children = 'Loading...' }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm text-[#385743]">
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-[#cfd8ce] border-t-[#1d4933]" />
      {children}
    </p>
  );
}

export function Skeleton({ className = '' }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-lg bg-[#e7ebe3] motion-reduce:animate-none ${className}`} />;
}

export function ErrorState({ children, onRetry, retryLabel = 'Try again' }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-[#e9c9c2] bg-[#fff5f2] px-4 py-3 text-sm text-[#8b3c2d]"
    >
      <p>{children}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg font-semibold underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-[#8b3c2d]/40"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children = 'There is nothing to show yet.' }) {
  return <p className="rounded-xl border border-dashed border-[#d9ded5] px-4 py-6 text-center text-sm text-[#68736a]">{children}</p>;
}
