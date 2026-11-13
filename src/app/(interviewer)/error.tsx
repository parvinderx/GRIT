"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md rounded-xl border border-rule bg-white p-6 text-center">
      <h1 className="font-display text-xl font-bold text-graphite">Something went wrong loading this page</h1>
      <p className="mt-2 text-sm text-pencil">This is usually temporary. Try again, or go back to your schedule.</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => retry()} className="min-h-11 rounded-xl bg-graphite px-5 text-sm font-semibold text-white">
          Retry
        </button>
        <Link href="/schedule" className="text-sm font-medium text-ballpoint underline underline-offset-4">
          Back to your schedule
        </Link>
      </div>
    </div>
  );
}
