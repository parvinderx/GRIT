/** Mirrors the hero slot so the page doesn't jump when content arrives. */
export default function Loading() {
  return (
    <div className="space-y-10" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="graph-paper rounded-xl border border-rule px-6 pb-8 pt-7">
        <div className="h-5 w-32 animate-pulse rounded bg-rule motion-reduce:animate-none" />
        <div className="mt-4 h-10 w-full max-w-md animate-pulse rounded bg-rule motion-reduce:animate-none" />
        <div className="mt-6 h-12 w-40 animate-pulse rounded-lg bg-rule motion-reduce:animate-none" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse border-b border-rule bg-rule-soft/60 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
