import { Link, useParams } from 'react-router-dom';
import { adminNavigationItems } from '../../layouts/AdminLayout.jsx';

export default function AdminSectionPlaceholder() {
  const { section } = useParams();
  const sectionItem = adminNavigationItems.find((item) => item.path === section);
  const sectionName = sectionItem?.label || 'Admin section';

  return (
    <section className="mx-auto max-w-3xl rounded-3xl border border-[#e5e2d5] bg-white p-6 shadow-sm sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a7832]">
        Administration
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#20382a] sm:text-3xl">
        {sectionName} is coming soon
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#68736a]">
        This section is not part of the current Admin Dashboard phase.
      </p>
      <Link
        to="/admin"
        className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[#1d4933] px-5 text-sm font-semibold text-white transition hover:bg-[#163b29] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#477454]/25"
      >
        Back to overview
      </Link>
    </section>
  );
}
