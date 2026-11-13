import Link from "next/link";

/** Root 404: unmatched URLs and notFound() outside the role groups. */
export default function NotFound() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-2">Page not found</p>
        <h1 className="mt-2 font-heading text-xl font-bold text-ink">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-sm text-ink-2">The link may be wrong or out of date. Head back to the start and pick up from there.</p>
        <Link href="/" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-cobalt px-5 text-sm font-semibold text-white">
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
