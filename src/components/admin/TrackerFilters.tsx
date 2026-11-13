"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/** Track/badge/batch/campus/section/days-eligible/state selects + name search. Each change updates the URL query so
 *  the server re-filters (and the Export link inherits the same params). */
export function TrackerFilters({
  tracks,
  badges,
  batches,
  campuses,
  sections,
  eligibleBuckets,
  states,
}: {
  tracks: { code: string; name: string }[];
  badges: string[];
  batches: string[];
  campuses: string[];
  sections: string[];
  eligibleBuckets: { value: string; label: string }[];
  states: { value: string; label: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  // Re-sync the input when the URL's q changes underneath it (e.g. "Clear filters",
  // back/forward). Adjusting state during render avoids an extra effect pass.
  const [syncedQ, setSyncedQ] = useState(urlQ);
  if (syncedQ !== urlQ) {
    setSyncedQ(urlQ);
    setQ(urlQ);
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.delete("page"); // a new filter starts from page 1
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    router.push(`/tracker${next.toString() ? `?${next.toString()}` : ""}`);
  }

  /** Push q only when it differs from the URL, so blur after a clear doesn't re-add it. */
  function commitSearch() {
    const value = q.trim();
    if (value === urlQ) return;
    setParam("q", value);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    commitSearch();
  }

  const selectCls = "rounded-lg border border-border bg-card px-3 py-1.5 min-h-11 text-sm text-ink";

  return (
    <>
      <select aria-label="Track" className={selectCls} value={params.get("track") ?? "all"} onChange={(e) => setParam("track", e.target.value)}>
        <option value="all">All tracks</option>
        {tracks.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
      </select>
      <select aria-label="Badge" className={selectCls} value={params.get("badge") ?? "all"} onChange={(e) => setParam("badge", e.target.value)}>
        <option value="all">All badges</option>
        {badges.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select aria-label="Batch" className={selectCls} value={params.get("batch") ?? "all"} onChange={(e) => setParam("batch", e.target.value)}>
        <option value="all">All batches</option>
        {batches.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select aria-label="Campus" className={selectCls} value={params.get("campus") ?? "all"} onChange={(e) => setParam("campus", e.target.value)}>
        <option value="all">All campuses</option>
        {campuses.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select aria-label="Section" className={selectCls} value={params.get("section") ?? "all"} onChange={(e) => setParam("section", e.target.value)}>
        <option value="all">All sections</option>
        {sections.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <select aria-label="Days since eligible" className={selectCls} value={params.get("eligible") ?? "all"} onChange={(e) => setParam("eligible", e.target.value)}>
        <option value="all">Eligible: any time</option>
        {eligibleBuckets.map((b) => <option key={b.value} value={b.value}>Eligible {b.label}</option>)}
      </select>
      <select aria-label="State" className={selectCls} value={params.get("state") ?? "all"} onChange={(e) => setParam("state", e.target.value)}>
        <option value="all">All states</option>
        {states.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <form onSubmit={submitSearch} className="min-w-[180px] flex-1">
        <input
          aria-label="Search name or GRIT ID"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={commitSearch}
          placeholder="Search name or GRIT ID"
          className="w-full rounded-lg border border-border bg-card px-3 py-1.5 min-h-11 text-sm text-ink placeholder:text-ink-2"
        />
      </form>
    </>
  );
}
