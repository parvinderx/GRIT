"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import "./globals.css";

/** Replaces the root layout when it fails, so it renders its own <html>/<body>. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-paper px-4 text-ink">
        <title>Something went wrong · GRIT</title>
        <main className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-2">GRIT · Interview Scheduling</p>
          <h1 className="mt-2 text-xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-2">This is usually temporary. Try again, or start over from the home page.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={() => retry()} className="min-h-11 rounded-xl bg-cobalt px-5 text-sm font-semibold text-white">
              Try again
            </button>
            {/* Plain <a>: the root layout (and the router) may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="text-sm font-medium text-cobalt underline underline-offset-4">
              Go to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
