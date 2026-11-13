import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-rule bg-white p-6 text-center">
      <h1 className="font-display text-xl font-bold text-graphite">We couldn&apos;t find that</h1>
      <p className="mt-2 text-sm text-pencil">
        The booking or interview you&apos;re looking for may have been removed, or the link may be wrong or belong to someone else.
      </p>
      <Link href="/schedule" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-graphite px-5 text-sm font-semibold text-white">
        Back to your schedule
      </Link>
    </div>
  );
}
