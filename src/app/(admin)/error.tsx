"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 text-center">
      <h1 className="font-heading text-xl font-bold text-ink">Something went wrong loading this page</h1>
      <p className="mt-2 text-sm text-ink-2">This is usually temporary. Try again, or go back to the overview.</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => retry()} className="min-h-11 rounded-xl bg-cobalt px-5 text-sm font-semibold text-white">
          Retry
        </button>
        <Link href="/overview" className="inline-flex min-h-11 items-center text-sm font-medium text-cobalt underline underline-offset-4">
          Back to the overview
        </Link>
      </div>
    </div>
  );
}
