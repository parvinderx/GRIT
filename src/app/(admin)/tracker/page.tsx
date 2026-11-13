import { staffBtn } from "@/components/primitives/staffButton";
import { TrackerRowActions } from "@/components/admin/TrackerRowActions";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import { requireAdminPage } from "@/lib/auth";
import {
  ELIGIBLE_BUCKETS,
  computeTrackerTiles,
  filterTrackerRows,
  getAdminTracker,
  resolveTrackerFilterContext,
  type DeadlineRisk,
  type TrackerRow,
} from "@/services/adminView";
import { DeadlineRiskBadge } from "@/components/admin/AdminBits";
import { SendReminderButton, type ReminderFilters } from "@/components/admin/ActionButtons";
import { TrackerFilters } from "@/components/admin/TrackerFilters";
import { StateChip } from "@/components/primitives/StatusChip";
import { TimeIST } from "@/components/primitives/TimeIST";
import { STATUS } from "@/lib/journey/statusConfig";
import type { JourneyState } from "@/lib/state-machine";
import { formatDayMonth, formatDayShort } from "@/lib/time";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const RISK_RANK: Record<DeadlineRisk, number> = { Critical: 3, High: 2, Watch: 1, OK: 0 };
type SortKey = "eligible" | "risk";
type Params = {
  risk?: string;
  notbooked?: string;
  overdue?: string;
  missed?: string;
  state?: string;
  track?: string;
  badge?: string;
  batch?: string;
  campus?: string;
  section?: string;
  eligible?: string;
  nobadge?: string;
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
};
const PARAM_KEYS = ["risk", "notbooked", "overdue", "missed", "state", "track", "badge", "batch", "campus", "section", "eligible", "nobadge", "q", "sort", "dir", "page"] as const;

function daysSince(iso: string | null, nowMs: number): number | null {
  return iso ? Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000)) : null;
}

function CaseStateLink({ row }: { row: TrackerRow }) {
  if (!row.caseId) return <StateChip state={row.state} />;
  return (
    <Link
      href={`/cases/${row.caseId}`}
      aria-label={`Open case ${row.caseCode ?? ""} (${STATUS[row.state].chipLabel})`}
      className="inline-flex min-h-11 items-center gap-0.5 rounded-full text-cobalt underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
    >
      <StateChip state={row.state} />
      <ChevronRight className="size-4" aria-hidden />
    </Link>
  );
}

export default async function TrackerPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const state = sp.state && sp.state in STATUS ? (sp.state as JourneyState) : undefined;
  const filters = { ...sp, state };
  const [t, fctx] = await Promise.all([getAdminTracker(), resolveTrackerFilterContext(filters, { forTiles: true })]);
  const overdueByJourney = new Map(fctx.overdue.map((o) => [o.journeyId, o]));
  const showOverdue = sp.overdue === "1";
  const nowMs = new Date(t.serverTimeIso).getTime();

  const days = Math.max(0, Math.ceil((new Date(t.deadlineIso).getTime() - nowMs) / 86_400_000));
  const deadlineDay = formatDayMonth(t.deadlineIso);
  const filtered = filterTrackerRows(t.rows, filters, fctx);
  const tileCounts = computeTrackerTiles(t.rows, filters, fctx);

  // Sorting (default: track → badge level → name, as the service returns them).
  const sort: SortKey | undefined = sp.sort === "eligible" || sp.sort === "risk" ? sp.sort : undefined;
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const sorted = [...filtered];
  if (sort) {
    const sign = dir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      if (sort === "risk") return sign * (RISK_RANK[a.risk] - RISK_RANK[b.risk]);
      const da = daysSince(a.eligibleSinceIso, nowMs);
      const db = daysSince(b.eligibleSinceIso, nowMs);
      if (da === null && db === null) return 0;
      if (da === null) return 1; // not eligible → always last
      if (db === null) return -1;
      return sign * (da - db);
    });
  }

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(1, requested), pageCount) : 1;
  const rows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const badges = [...new Set(t.rows.map((r) => r.badgeName))].sort();
  const batches = [...new Set(t.rows.map((r) => r.batch).filter((b): b is string => !!b))].sort();
  const campuses = [...new Set(t.rows.map((r) => r.campus).filter((c): c is string => !!c))].sort();
  const sections = [...new Set(t.rows.map((r) => r.section).filter((x): x is string => !!x))].sort();
  const states = (Object.keys(STATUS) as JourneyState[]).map((s) => ({ value: s, label: STATUS[s].chipLabel }));

  const current = new URLSearchParams();
  for (const k of PARAM_KEYS) {
    const v = k === "state" ? state : sp[k];
    if (v) current.set(k, v);
  }
  /** Build a tracker URL from the current params with some changed (null = remove). Filter changes reset the page. */
  const hrefWith = (changes: Record<string, string | null>, keepPage = false) => {
    const p = new URLSearchParams(current);
    if (!keepPage) p.delete("page");
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return `/tracker${s ? `?${s}` : ""}`;
  };
  const toggle = (key: string, value = "1") => hrefWith({ [key]: current.get(key) === value ? null : value });

  const exportParams = new URLSearchParams(current);
  for (const k of ["sort", "dir", "page"]) exportParams.delete(k);
  const exportHref = `/api/v1/admin/tracker/export${exportParams.toString() ? `?${exportParams.toString()}` : ""}`;

  // Reminder goes to every not-booked student matching the filters — all pages, not just this one.
  // The server re-resolves the recipients from these same filters; this count is what the dialog shows.
  const reminderCount = new Set(filtered.filter((r) => r.notBooked).map((r) => r.studentId)).size;
  const reminderFilters: ReminderFilters = {};
  for (const k of ["track", "badge", "batch", "campus", "section", "eligible", "nobadge", "risk", "q", "state", "overdue", "missed"] as const) {
    const v = k === "state" ? state : sp[k];
    if (v) reminderFilters[k] = v;
  }
  const filterParts = [
    sp.track && sp.track !== "all" ? t.tracks.find((x) => x.code === sp.track)?.name ?? sp.track : null,
    sp.badge && sp.badge !== "all" ? sp.badge : null,
    sp.batch && sp.batch !== "all" ? `batch ${sp.batch}` : null,
    sp.campus && sp.campus !== "all" ? sp.campus : null,
    sp.section && sp.section !== "all" ? `section ${sp.section}` : null,
    ELIGIBLE_BUCKETS.find((b) => b.value === sp.eligible) ? `eligible ${ELIGIBLE_BUCKETS.find((b) => b.value === sp.eligible)!.label}` : null,
    sp.nobadge === "1" ? "no badge" : null,
    state ? STATUS[state].chipLabel : null,
    sp.risk === "1" ? "deadline risk" : null,
    sp.overdue === "1" ? "outcome overdue" : null,
    sp.missed === "48h" ? "missed in the last 48 h" : null,
    sp.q?.trim() ? `matching "${sp.q.trim()}"` : null,
  ].filter(Boolean);
  const filterSummary = filterParts.length ? filterParts.join(" · ") : "all tracks";

  const noBadgeOn = sp.nobadge === "1" && sp.notbooked === "1";
  const tiles: { label: string; value: number; href: string; active: boolean; alert?: boolean }[] = [
    { label: "Eligible", value: tileCounts.eligible, href: toggle("state", "ELIGIBLE"), active: state === "ELIGIBLE" },
    { label: "Booked", value: tileCounts.booked, href: toggle("state", "BOOKED"), active: state === "BOOKED" },
    { label: "Not booked", value: tileCounts.notBooked, href: toggle("notbooked"), active: sp.notbooked === "1" },
    { label: "No badge · not booked", value: tileCounts.noBadgeNotBooked, href: hrefWith({ nobadge: noBadgeOn ? null : "1", notbooked: noBadgeOn ? null : "1" }), active: noBadgeOn },
    { label: "Result pending", value: tileCounts.resultPending, href: toggle("state", "AWAITING_RESULT"), active: state === "AWAITING_RESULT" },
    { label: "Outcomes overdue", value: tileCounts.outcomesOverdue, href: toggle("overdue"), active: sp.overdue === "1", alert: true },
    { label: "At risk · Critical + High", value: tileCounts.atRisk, href: toggle("risk"), active: sp.risk === "1", alert: true },
  ];

  const sortHeader = (key: SortKey, label: string) => {
    const active = sort === key;
    const nextDir = active ? (dir === "desc" ? "asc" : "desc") : "desc";
    const Arrow = !active ? ArrowUpDown : dir === "desc" ? ArrowDown : ArrowUp;
    return (
      <th key={key} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-1 font-medium">
        <Link
          href={hrefWith({ sort: key, dir: nextDir })}
          className={cn("inline-flex min-h-11 items-center gap-1 uppercase hover:text-ink", active && "text-ink")}
        >
          {label}
          <Arrow className="size-3.5" aria-hidden />
          <span className="sr-only">, sort {nextDir === "desc" ? "descending" : "ascending"}</span>
        </Link>
      </th>
    );
  };

  const pillCls = (on: boolean) =>
    cn("inline-flex min-h-11 items-center rounded-lg border px-3 text-sm", on ? "border-cobalt bg-cobalt/5 text-cobalt" : "border-border bg-card text-ink");
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold text-ink">Booking tracker</h1>
          <p className="text-ink-2">Who is eligible, who has booked and who hasn&apos;t · {formatDayShort(t.serverTimeIso)}</p>
        </div>
        <span className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper">
          <span className="font-bold text-paper">{days}</span> {days === 1 ? "day" : "days"} to the {deadlineDay} badge deadline
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            aria-current={tile.active ? "true" : undefined}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt",
              tile.active ? "border-cobalt ring-1 ring-cobalt" : tile.alert && tile.value > 0 ? "border-alert/40" : "border-border"
            )}
          >
            <span className="block text-xs font-medium text-ink-2">{tile.label}</span>
            <span className="flex items-baseline gap-1">
              <span className={cn("font-heading text-3xl font-bold", tile.alert && tile.value > 0 ? "text-alert" : "text-ink")}>
                {tile.value.toLocaleString("en-IN")}
              </span>
              <span className="text-xs text-ink-2">{tile.value === 1 ? "student" : "students"}</span>
            </span>
            <span className="text-xs text-cobalt">{tile.active ? "Filter on · tap to clear" : "Show these"}</span>
          </Link>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TrackerFilters
          tracks={t.tracks}
          badges={badges}
          batches={batches}
          campuses={campuses}
          sections={sections}
          eligibleBuckets={ELIGIBLE_BUCKETS}
          states={states}
        />
        <Link href={toggle("notbooked")} aria-current={sp.notbooked === "1" ? "true" : undefined} className={pillCls(sp.notbooked === "1")}>
          Not booked only
        </Link>
        <Link href={toggle("risk")} aria-current={sp.risk === "1" ? "true" : undefined} className={pillCls(sp.risk === "1")}>
          Deadline risk
        </Link>
        {sp.overdue === "1" && (
          <Link href={toggle("overdue")} aria-current="true" className={pillCls(true)}>
            Outcome overdue · clear
          </Link>
        )}
        {sp.missed === "48h" && (
          <Link href={toggle("missed", "48h")} aria-current="true" className={pillCls(true)}>
            Missed in the last 48 h · clear
          </Link>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SendReminderButton count={reminderCount} filters={reminderFilters} filterSummary={filterSummary} />
        <a href={exportHref} download className={staffBtn.secondary}>Export</a>
        <p className="ml-auto text-sm text-ink-2" aria-live="polite">
          {total === 0
            ? "No students match"
            : total <= PAGE_SIZE
              ? `Showing ${total.toLocaleString("en-IN")} of ${t.rows.length.toLocaleString("en-IN")}`
              : `Showing ${first}–${last} of ${total.toLocaleString("en-IN")}`}
          {total > 0 && total !== t.rows.length && total > PAGE_SIZE ? ` (${t.rows.length.toLocaleString("en-IN")} in total)` : ""}
        </p>
      </div>

      {total === 0 && (
        <div className="rounded-2xl border border-border bg-card px-3 py-10 text-center">
          <p className="font-medium text-ink">No students match these filters</p>
          <Link href="/tracker" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-cobalt underline underline-offset-4">
            Clear filters
          </Link>
        </div>
      )}

      {total > 0 && (
        <>
          {/* Mobile: one card per student */}
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => {
              const d = daysSince(r.eligibleSinceIso, nowMs);
              const od = overdueByJourney.get(r.journeyId);
              return (
                <li key={r.journeyId} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{r.studentName}</p>
                      <p className="font-mono text-xs text-ink-2">{r.gritIdMasked}{r.batch ? ` · ${r.batch}` : ""}{r.section ? ` · ${r.section}` : ""}</p>
                    </div>
                    <DeadlineRiskBadge risk={r.risk} />
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{r.trackName} · {r.badgeName}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <CaseStateLink row={r} />
                    {d !== null && r.eligibleSinceIso && (
                      <span className="text-xs text-ink-2">
                        Eligible {d} {d === 1 ? "day" : "days"} · since {formatDayShort(r.eligibleSinceIso)}
                      </span>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-ink-2">
                    <dt>Booking</dt>
                    <dd className="text-ink">{r.bookingStartIso ? <TimeIST value={r.bookingStartIso} /> : "Not booked"}</dd>
                    {showOverdue && od && (
                      <>
                        <dt>Outcome due</dt>
                        <dd className="text-ink">{od.interviewerName} · since <TimeIST value={od.dueIso} /></dd>
                      </>
                    )}
                    <dt>Attempts</dt>
                    <dd className="text-ink">{r.attemptsUsed}/{r.maxAttempts}</dd>
                    <dt>Last reminder</dt>
                    <dd className="text-ink">{r.lastReminderIso ? formatDayShort(r.lastReminderIso) : "—"}</dd>
                  </dl>
                  <div className="mt-2 flex justify-end">
                    <TrackerRowActions
                      journeyId={r.journeyId}
                      studentName={r.studentName}
                      state={r.state}
                      liveBookingId={r.liveBookingId}
                      studentHasLiveBooking={r.studentHasLiveBooking}
                      interviewerName={r.interviewerName}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          {/* md+: full table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-2">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Student</th>
                  <th className="px-3 py-2.5 font-medium">Track · badge</th>
                  <th className="px-3 py-2.5 font-medium">State</th>
                  {sortHeader("eligible", "Eligible since")}
                  <th className="px-3 py-2.5 font-medium">Booking (IST)</th>
                  {showOverdue && <th className="px-3 py-2.5 font-medium">Interviewer · due since</th>}
                  <th className="px-3 py-2.5 font-medium">Attempts</th>
                  {sortHeader("risk", "Deadline risk")}
                  <th className="px-3 py-2.5 font-medium">Last reminder</th>
                  <th className="px-3 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = daysSince(r.eligibleSinceIso, nowMs);
                  const od = overdueByJourney.get(r.journeyId);
                  return (
                    <tr key={r.journeyId} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-ink">{r.studentName}</div>
                        <div className="font-mono text-xs text-ink-2">{r.gritIdMasked}{r.batch ? ` · ${r.batch}` : ""}{r.section ? ` · ${r.section}` : ""}</div>
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{r.trackName} · {r.badgeName}</td>
                      <td className="px-3 py-2.5"><CaseStateLink row={r} /></td>
                      <td className="px-3 py-2.5 text-ink-2">
                        {r.eligibleSinceIso ? (
                          <>
                            <span className="block text-ink">{d} {d === 1 ? "day" : "days"}</span>
                            <span className="text-xs">{formatDayShort(r.eligibleSinceIso)}</span>
                          </>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{r.bookingStartIso ? <TimeIST value={r.bookingStartIso} /> : "Not booked"}</td>
                      {showOverdue && (
                        <td className="px-3 py-2.5 text-ink-2">
                          {od ? (
                            <>
                              <span className="block text-ink">{od.interviewerName}</span>
                              <span className="text-xs"><TimeIST value={od.dueIso} /></span>
                            </>
                          ) : "—"}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-ink-2">{r.attemptsUsed}/{r.maxAttempts}</td>
                      <td className="px-3 py-2.5"><DeadlineRiskBadge risk={r.risk} /></td>
                      <td className="px-3 py-2.5 text-ink-2">{r.lastReminderIso ? formatDayShort(r.lastReminderIso) : "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        <TrackerRowActions
                          journeyId={r.journeyId}
                          studentName={r.studentName}
                          state={r.state}
                          liveBookingId={r.liveBookingId}
                          studentHasLiveBooking={r.studentHasLiveBooking}
                          interviewerName={r.interviewerName}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <nav aria-label="Pages" className="mt-3 flex flex-wrap items-center justify-between gap-2">
              {page > 1 ? (
                <Link href={hrefWith({ page: String(page - 1) }, true)} className={staffBtn.secondary}>Previous 50</Link>
              ) : <span />}
              <span className="text-sm text-ink-2">Page {page} of {pageCount}</span>
              {page < pageCount ? (
                <Link href={hrefWith({ page: String(page + 1) }, true)} className={staffBtn.secondary}>Next 50</Link>
              ) : <span />}
            </nav>
          )}
        </>
      )}

      <details className="mt-4 rounded-xl border border-border bg-card px-4 py-2 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink">What do risk levels mean?</summary>
        <p className="mb-2 text-ink-2">Checked in this order, against the {deadlineDay} deadline:</p>
        <dl className="mb-2 grid gap-2 text-ink-2 sm:grid-cols-[auto_1fr]">
          <dt><DeadlineRiskBadge risk="OK" /></dt>
          <dd>The student already holds an active badge (on any track).</dd>
          <dt><DeadlineRiskBadge risk="Critical" /></dt>
          <dd>No badge, and booking is closed, or they&apos;re in a cooldown (not cleared, missed, retake later) that ends after the deadline.</dd>
          <dt><DeadlineRiskBadge risk="Watch" /></dt>
          <dd>No badge, in a cooldown that ends before the deadline.</dd>
          <dt><DeadlineRiskBadge risk="High" /></dt>
          <dd>
            No badge, no interview booked on any track, and ready to book for more than 7 days: eligible that long, or their cooldown
            ended that long ago (the cooldown job moves them to eligible).
          </dd>
          <dt><DeadlineRiskBadge risk="OK" /></dt>
          <dd>Everyone else (booked on some track, result pending, under review, locked).</dd>
        </dl>
      </details>
      <p className="mt-2 text-xs text-ink-2">
        Tile counts are students (a student has one row per badge) and follow the other filters you&apos;ve set. GRIT IDs are shown masked.
      </p>
    </div>
  );
}
