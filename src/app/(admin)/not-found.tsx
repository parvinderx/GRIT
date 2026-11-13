import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 text-center">
      <h1 className="font-heading text-xl font-bold text-ink">We couldn&apos;t find that</h1>
      <p className="mt-2 text-sm text-ink-2">
        The student, booking or case you&apos;re looking for may have been removed, or the link may be wrong or belong to someone else.
      </p>
      <Link href="/overview" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-cobalt px-5 text-sm font-semibold text-white">
        Back to the overview
      </Link>
    </div>
  );
}
