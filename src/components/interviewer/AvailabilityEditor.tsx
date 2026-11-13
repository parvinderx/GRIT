"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { AlertTriangle, Plus, Undo2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/primitives/ConfirmDialog";
import Link from "next/link";
import { btnClass } from "@/components/student/ui/Button";
import { AvailabilityCalendar } from "@/components/interviewer/AvailabilityCalendar";
import { requestJson } from "@/lib/clientFetch";
import { dateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  type GridRules,
  type TimeRange,
  describeSlots,
  endOptions,
  label12,
  nextFreeRange,
  previewDay,
  rangeLabel,
  startOptions,
  toMin,
  fromMin,
  validateDayRanges,
} from "@/lib/slotGrid";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Display order: Monday first (matches the calendar). Values are schema weekdays (0 = Sunday). */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export type Range = TimeRange;
export interface Override {
  date: string; // YYYY-MM-DD
  kind: "ADD" | "REMOVE";
  startLocal: string | null;
  endLocal: string | null;
}

interface Row extends Range {
  id: number;
}
type Weekly = Record<number, Row[]>;
type FieldError =
  | { scope: "weekly"; weekday: number; index: number; message: string }
  | { scope: "override"; date: string; message: string };
interface SaveResult {
  created: number;
  removed: number;
  createdLiveNow: number;
  createdLater: number;
  createdTooSoon: number;
  bookingCutoffHours: number;
  nextReleaseIso: string | null;
  bookedAffected: { startIso: string; studentFirstName?: string }[];
}

// Ranges added in the browser get ids from this counter. It starts high so they never
// collide with the position-based ids of saved ranges below.
let seq = 10_000;
const nextId = () => ++seq;

const withIds = (m: Record<number, Range[]>): Weekly =>
  // Saved ranges get ids from their position, so server and browser render the same ids (no hydration mismatch).
  Object.fromEntries(
    Object.entries(m).map(([wd, rs]) => [
      wd,
      rs.map((r, i) => ({ ...r, id: Number(wd) * 100 + i + 1 })),
    ]),
  ) as Weekly;

/** Stable, order-independent form of a day's ranges (for dirty checks). */
const norm = (rs: Range[]) =>
  rs
    .map((r) => `${r.startLocal}-${r.endLocal}`)
    .sort()
    .join(",");
const ovKey = (o: Override) =>
  `${o.date}|${o.kind}|${o.startLocal ?? ""}|${o.endLocal ?? ""}`;
const fmtDate = (iso: string) => DateTime.fromISO(iso).toFormat("ccc d LLL");
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Time picker. Module-scoped so it keeps its identity (and keyboard focus) across renders. */
function Select({
  id,
  value,
  onChange,
  label,
  options,
  invalid,
  describedBy,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: string[];
  invalid?: boolean;
  describedBy?: string;
}) {
  // Keep an off-grid saved value selectable so it isn't silently changed.
  const opts = options.includes(value)
    ? options
    : [...options, value].sort((a, b) => toMin(a) - toMin(b));
  return (
    <select
      id={id}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "min-h-11 rounded-lg border bg-white px-2 text-sm text-graphite",
        invalid ? "border-alert ring-1 ring-alert" : "border-rule",
      )}
    >
      {opts.map((t) => (
        <option key={t} value={t}>
          {label12(t)}
          {options.includes(t) ? "" : " (off grid)"}
        </option>
      ))}
    </select>
  );
}

function UnsavedTag({ children = "Unsaved" }: { children?: ReactNode }) {
  return (
    <span className="rounded-md border border-dashed border-amberline px-1.5 py-0.5 text-xs font-medium text-amberline">
      {children}
    </span>
  );
}

export function AvailabilityEditor({
  initialWeekly,
  initialOverrides,
  grid,
  today,
  nowMinute,
  keptSlots,
  deadlineDate,
  lastInterviewDate,
  sidebar,
}: {
  initialWeekly: { weekday: number; startLocal: string; endLocal: string }[];
  initialOverrides: Override[];
  grid: GridRules;
  /** Today in IST (app clock), YYYY-MM-DD. */
  today: string;
  /** Minutes since IST midnight (app clock): today's earlier start times aren't created. */
  nowMinute: number;
  /** Future booked / blocked slots (IST date + start minute). A save keeps them, so new
   *  slots that would overlap them aren't created (same as materializeSlots). */
  keptSlots: { date: string; startMin: number }[];
  deadlineDate: string | null;
  /** Latest date an override can be set for (last interview day), YYYY-MM-DD. */
  lastInterviewDate: string | null;
  sidebar?: ReactNode;
}) {
  const router = useRouter();
  const uid = useId();
  const editorRef = useRef<HTMLDivElement>(null);

  const startOpts = useMemo(() => startOptions(grid), [grid]);
  const endOpts = useMemo(() => endOptions(grid), [grid]);

  const baseWeekly = useMemo<Record<number, Range[]>>(() => {
    const m: Record<number, Range[]> = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };
    for (const w of initialWeekly) {
      (m[w.weekday] ??= []).push({
        startLocal: w.startLocal.slice(0, 5),
        endLocal: w.endLocal.slice(0, 5),
      });
    }
    return m;
  }, [initialWeekly]);

  const [tab, setTab] = useState<"weekly" | "overrides">("weekly");
  const [weekly, setWeekly] = useState<Weekly>(() => withIds(baseWeekly));
  const [overrides, setOverrides] = useState<Override[]>(() =>
    structuredClone(initialOverrides),
  );
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Unsaved-change tracking ───────────────────────────────────────────────
  const changedDays = useMemo(
    () => ORDER.filter((wd) => norm(weekly[wd]) !== norm(baseWeekly[wd] ?? [])),
    [weekly, baseWeekly],
  );
  const initialKeys = useMemo(
    () => new Set(initialOverrides.map(ovKey)),
    [initialOverrides],
  );
  const currentKeys = useMemo(() => new Set(overrides.map(ovKey)), [overrides]);
  const removedOverrides = useMemo(
    () => initialOverrides.filter((o) => !currentKeys.has(ovKey(o))),
    [initialOverrides, currentKeys],
  );
  const addedCount = overrides.filter((o) => !initialKeys.has(ovKey(o))).length;
  const unsavedWeekly = changedDays.length;
  const unsavedOverrides = addedCount + removedOverrides.length;
  const unsaved = unsavedWeekly + unsavedOverrides;
  const dirty = unsaved > 0;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // In-app navigation (Next <Link>s don't fire beforeunload): while dirty, catch clicks
  // on same-origin links before the router does and ask first.
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a =
        e.target instanceof Element
          ? e.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !a ||
        (a.target && a.target !== "_self") ||
        a.hasAttribute("download")
      )
        return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page (e.g. a #hash link): nothing is lost.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveHref(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  // ── Preview parity with materializeSlots ──────────────────────────────────
  // Kept (booked / blocked) slot starts by date; today's starts before now are skipped.
  const keptByDate = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const k of keptSlots)
      m.set(k.date, [...(m.get(k.date) ?? []), k.startMin]);
    return m;
  }, [keptSlots]);

  // ── Validation (same rules as the server: src/lib/slotGrid.ts) ────────────
  const weeklyErrors = useMemo(() => {
    const out: Record<number, Map<number, string>> = {};
    for (const wd of ORDER) out[wd] = validateDayRanges(weekly[wd], grid);
    for (const e of serverErrors) {
      if (e.scope === "weekly" && !out[e.weekday]?.has(e.index))
        out[e.weekday]?.set(e.index, e.message);
    }
    return out;
  }, [weekly, grid, serverErrors]);
  const overrideServerErrors = useMemo(
    () =>
      new Map(
        serverErrors.flatMap((e) =>
          e.scope === "override" ? [[e.date, e.message] as const] : [],
        ),
      ),
    [serverErrors],
  );
  const errorCount =
    ORDER.reduce((n, wd) => n + weeklyErrors[wd].size, 0) +
    overrideServerErrors.size;

  function editWeekly(fn: (w: Weekly) => Weekly) {
    setWeekly(fn);
    setServerErrors((s) => s.filter((e) => e.scope !== "weekly"));
  }
  function addRange(wd: number) {
    const r = nextFreeRange(weekly[wd], grid);
    if (!r) return;
    editWeekly((w) => ({ ...w, [wd]: [...w[wd], { ...r, id: nextId() }] }));
  }
  function removeRange(wd: number, id: number) {
    editWeekly((w) => ({ ...w, [wd]: w[wd].filter((x) => x.id !== id) }));
  }
  function setRange(
    wd: number,
    id: number,
    field: "startLocal" | "endLocal",
    value: string,
  ) {
    editWeekly((w) => ({
      ...w,
      [wd]: w[wd].map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    }));
  }

  function focusFirstInvalid() {
    requestAnimationFrame(() => {
      const el = editorRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      );
      if (!el) return;
      const panel = el.closest<HTMLElement>('[role="tabpanel"]');
      if (panel?.hidden) {
        setTab(panel.dataset.tab as "weekly" | "overrides");
        requestAnimationFrame(() => el.focus());
      } else el.focus();
    });
  }

  async function save() {
    if (errorCount > 0) {
      toast.error(
        `Fix ${plural(errorCount, "problem")} before saving. Each one is marked next to the hours.`,
      );
      focusFirstInvalid();
      return;
    }
    setBusy(true);
    setResult(null);
    const weeklyFlat = ORDER.flatMap((wd) =>
      weekly[wd].map((r) => ({
        weekday: wd,
        startLocal: r.startLocal,
        endLocal: r.endLocal,
      })),
    );
    const r = await requestJson<SaveResult & { errors?: FieldError[] }>(
      "PUT",
      "/api/v1/interviewer/availability",
      {
        body: { weekly: weeklyFlat, overrides },
      },
    );
    setBusy(false);
    if (r.ok) {
      const res: SaveResult = {
        created: r.data.created ?? 0,
        removed: r.data.removed ?? 0,
        createdLiveNow: r.data.createdLiveNow ?? 0,
        createdLater: r.data.createdLater ?? 0,
        createdTooSoon: r.data.createdTooSoon ?? 0,
        bookingCutoffHours: r.data.bookingCutoffHours ?? 0,
        nextReleaseIso: r.data.nextReleaseIso ?? null,
        bookedAffected: r.data.bookedAffected ?? [],
      };
      setServerErrors([]);
      setResult(res);
      toast.success(saveSummary(res));
      router.refresh();
    } else {
      const errs = Array.isArray(r.data.errors) ? r.data.errors : [];
      setServerErrors(errs);
      toast.error(r.message ?? "Couldn't save. Try again.");
      if (errs.length) focusFirstInvalid();
    }
  }

  function discard() {
    setWeekly(withIds(baseWeekly));
    setOverrides(structuredClone(initialOverrides));
    setServerErrors([]);
  }

  // ── Overrides ──────────────────────────────────────────────────────────────
  const [ovDate, setOvDate] = useState("");
  const [ovKind, setOvKind] = useState<"ADD" | "REMOVE">("REMOVE");
  const [ovStart, setOvStart] = useState(() => startOpts[0] ?? grid.gridStart);
  const [ovEnd, setOvEnd] = useState(() =>
    fromMin(
      Math.min(
        toMin(startOpts[0] ?? grid.gridStart) + 4 * grid.gridMinutes,
        toMin(grid.gridEnd),
      ),
    ),
  );
  const [ovErrors, setOvErrors] = useState<{ date?: string; range?: string }>(
    {},
  );

  const ovWeekday = ovDate ? DateTime.fromISO(ovDate).weekday % 7 : null;
  const ovPreview = useMemo(() => {
    if (ovKind !== "ADD" || ovWeekday === null) return null;
    const base = weekly[ovWeekday] ?? [];
    const all = previewDay(
      [...base, { startLocal: ovStart, endLocal: ovEnd }],
      grid,
      {
        occupied: keptByDate.get(ovDate) ?? [],
        afterMin: ovDate === today ? nowMinute : undefined,
      },
    );
    return all[all.length - 1];
  }, [
    ovKind,
    ovWeekday,
    ovDate,
    weekly,
    ovStart,
    ovEnd,
    grid,
    keptByDate,
    today,
    nowMinute,
  ]);

  function addOverride() {
    const errs: { date?: string; range?: string } = {};
    if (!ovDate) errs.date = "Pick a date.";
    else if (ovDate < today)
      errs.date = `Pick today (${fmtDate(today)}) or a later date.`;
    else if (lastInterviewDate && ovDate > lastInterviewDate)
      errs.date = `Pick a date on or before ${fmtDate(lastInterviewDate)}, the last interview day.`;
    else if (overrides.some((o) => o.date === ovDate))
      errs.date = `${fmtDate(ovDate)} already has an override. Remove it first.`;
    if (ovKind === "ADD") {
      const msg = validateDayRanges(
        [{ startLocal: ovStart, endLocal: ovEnd }],
        grid,
      ).get(0);
      if (msg) errs.range = msg;
    }
    setOvErrors(errs);
    if (errs.date || errs.range) {
      requestAnimationFrame(() =>
        document
          .getElementById(errs.date ? `${uid}-ovdate` : `${uid}-ovstart`)
          ?.focus(),
      );
      return;
    }
    const next: Override =
      ovKind === "ADD"
        ? { date: ovDate, kind: "ADD", startLocal: ovStart, endLocal: ovEnd }
        : { date: ovDate, kind: "REMOVE", startLocal: null, endLocal: null };
    setOverrides((o) =>
      [...o, next].sort((a, b) => a.date.localeCompare(b.date)),
    );
    setOvDate("");
  }
  function removeOverride(o: Override) {
    setOverrides((list) => list.filter((x) => ovKey(x) !== ovKey(o)));
    setServerErrors((s) =>
      s.filter((e) => !(e.scope === "override" && e.date === o.date)),
    );
  }
  function undoRemove(o: Override) {
    if (overrides.some((x) => x.date === o.date)) {
      toast.error(
        `${fmtDate(o.date)} already has a new override. Remove that one first.`,
      );
      return;
    }
    setOverrides((list) =>
      [...list, o].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }

  const overrideRows = useMemo(
    () =>
      [
        ...overrides.map((o) => ({
          o,
          removed: false,
          unsaved: !initialKeys.has(ovKey(o)),
        })),
        ...removedOverrides.map((o) => ({ o, removed: true, unsaved: true })),
      ].sort(
        (a, b) =>
          a.o.date.localeCompare(b.o.date) ||
          Number(a.removed) - Number(b.removed),
      ),
    [overrides, removedOverrides, initialKeys],
  );
  const calendarMarks = useMemo(
    () =>
      overrides.map((o) => ({
        date: o.date,
        kind: o.kind,
        unsaved: !initialKeys.has(ovKey(o)),
      })),
    [overrides, initialKeys],
  );

  // ── Tabs (WAI-ARIA tabs, automatic activation) ────────────────────────────
  const tabs = [
    {
      id: "weekly" as const,
      label: "Weekly hours",
      count: null,
      unsaved: unsavedWeekly,
    },
    {
      id: "overrides" as const,
      label: "Date overrides",
      count: overrides.length,
      unsaved: unsavedOverrides,
    },
  ];
  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === tab);
    const n =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : e.key === "ArrowRight"
            ? (i + 1) % tabs.length
            : (i - 1 + tabs.length) % tabs.length;
    setTab(tabs[n].id);
    document.getElementById(`${uid}-tab-${tabs[n].id}`)?.focus();
  }

  /**
   * The weekly preview is the pattern; the next occurrence of the day (within the coming
   * week) can create fewer slots: a booked slot already holds the time, today's earlier
   * times have passed, or a date override applies. Says so, or returns null if it's the same.
   */
  function nextOccurrenceNote(
    wd: number,
    ranges: Range[],
    pattern: number[][],
  ): string | null {
    if (ranges.length === 0) return null;
    const t = DateTime.fromISO(today);
    const date = t.plus({ days: (wd - (t.weekday % 7) + 7) % 7 }).toISODate()!;
    const label =
      date === today ? `Today (${fmtDate(date)})` : `Next ${fmtDate(date)}`;
    const ov = overrides.find((o) => o.date === date);
    if (ov?.kind === "REMOVE")
      return `${label} is a day off (date override), so no slots that day.`;
    const extra =
      ov?.kind === "ADD" && ov.startLocal && ov.endLocal
        ? [{ startLocal: ov.startLocal, endLocal: ov.endLocal }]
        : [];
    const occupied = keptByDate.get(date) ?? [];
    const afterMin = date === today ? nowMinute : undefined;
    const actual = previewDay([...ranges, ...extra], grid, {
      occupied,
      afterMin,
    }).slice(0, ranges.length);
    const patternStarts = pattern.flat();
    const actualStarts = actual.flat();
    if (
      patternStarts.length === actualStarts.length &&
      patternStarts.every((s) => actualStarts.includes(s))
    )
      return null;
    const booked = occupied.filter((b) =>
      patternStarts.some(
        (s) => s < b + grid.gridMinutes && b < s + grid.gridMinutes,
      ),
    );
    const passed =
      afterMin !== undefined && patternStarts.some((s) => s <= afterMin);
    const why = [
      booked.length
        ? `${booked.map((b) => label12(fromMin(b))).join(", ")} already booked`
        : null,
      passed ? "earlier times have passed" : null,
      extra.length ? "extra hours that date" : null,
    ].filter(Boolean);
    return `${label}: ${plural(actualStarts.length, "new slot")}${why.length ? ` (${why.join("; ")})` : ""}.`;
  }

  const statusId = `${uid}-status`;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div ref={editorRef}>
        <div
          role="tablist"
          aria-label="Availability"
          onKeyDown={onTabKeyDown}
          className="mb-4 flex flex-wrap gap-1 border-b border-rule"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`${uid}-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              aria-controls={`${uid}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative -mb-px inline-flex min-h-11 items-center gap-2 border-b-[3px] px-3 font-bold",
                tab === t.id
                  ? "border-graphite text-graphite"
                  : "border-transparent text-pencil hover:text-graphite",
              )}
            >
              {t.label}
              {t.count ? ` (${t.count})` : ""}
              {t.unsaved > 0 && <UnsavedTag>{t.unsaved} unsaved</UnsavedTag>}
            </button>
          ))}
        </div>

        {/* Weekly hours */}
        <div
          role="tabpanel"
          id={`${uid}-panel-weekly`}
          aria-labelledby={`${uid}-tab-weekly`}
          data-tab="weekly"
          hidden={tab !== "weekly"}
          tabIndex={0}
          className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ballpoint"
        >
          {ORDER.map((wd) => {
            const ranges = weekly[wd];
            const errs = weeklyErrors[wd];
            const preview = previewDay(ranges, grid);
            const nextNote =
              errs.size === 0 ? nextOccurrenceNote(wd, ranges, preview) : null;
            const free = nextFreeRange(ranges, grid);
            const changed = changedDays.includes(wd);
            return (
              <div
                key={wd}
                className="grid gap-x-5 gap-y-2 px-5 py-3 sm:grid-cols-[5.5rem_1fr]"
              >
                <div className="flex items-center gap-2 sm:min-h-11">
                  <span className="font-bold text-graphite">{DAYS[wd]}</span>
                  {changed && <UnsavedTag />}
                </div>
                <div className="flex flex-col gap-2">
                  {ranges.length === 0 && (
                    <div className="flex min-h-11 flex-wrap items-center gap-x-4">
                      <span className="text-pencil">Not available</span>
                      <button
                        type="button"
                        onClick={() => addRange(wd)}
                        className="inline-flex min-h-11 items-center gap-1 font-semibold text-ballpoint underline underline-offset-4"
                      >
                        <Plus className="size-4" aria-hidden="true" /> Add hours
                      </button>
                    </div>
                  )}
                  {ranges.map((r, i) => {
                    const err = errs.get(i);
                    const errId = `${uid}-err-${r.id}`;
                    const prevId = `${uid}-prev-${r.id}`;
                    const describedBy = err ? `${errId} ${prevId}` : prevId;
                    const name = `${DAYS[wd]}, hours ${i + 1}`;
                    const starts = preview[i] ?? [];
                    const last = i === ranges.length - 1;
                    return (
                      <div key={r.id}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <Select
                            label={`${name}, start time`}
                            value={r.startLocal}
                            options={startOpts}
                            invalid={!!err}
                            describedBy={describedBy}
                            onChange={(v) =>
                              setRange(wd, r.id, "startLocal", v)
                            }
                          />
                          <span className="text-pencil" aria-hidden="true">
                            to
                          </span>
                          <Select
                            label={`${name}, end time`}
                            value={r.endLocal}
                            options={endOpts}
                            invalid={!!err}
                            describedBy={describedBy}
                            onChange={(v) => setRange(wd, r.id, "endLocal", v)}
                          />
                          <button
                            type="button"
                            onClick={() => removeRange(wd, r.id)}
                            aria-label={`Remove ${name} (${rangeLabel(r)})`}
                            title="Remove these hours"
                            className="inline-flex size-11 items-center justify-center rounded-lg text-pencil hover:bg-rule-soft hover:text-graphite"
                          >
                            <X className="size-4" aria-hidden="true" />
                          </button>
                          <span
                            className="text-[14px] text-pencil"
                            aria-hidden="true"
                          >
                            {err
                              ? ""
                              : starts.length === 0
                                ? "No interviews fit"
                                : `${plural(starts.length, "interview")}`}
                          </span>
                          {last && free && (
                            <button
                              type="button"
                              onClick={() => addRange(wd)}
                              className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-ballpoint"
                            >
                              <Plus className="size-4" aria-hidden="true" /> Add
                              more hours
                            </button>
                          )}
                        </div>
                        {err && (
                          <p
                            id={errId}
                            className="mt-1 flex items-start gap-1 text-sm text-alert"
                          >
                            <AlertTriangle
                              className="mt-0.5 size-4 shrink-0"
                              aria-hidden="true"
                            />
                            {err}
                          </p>
                        )}
                        {/* The full list of times stays available to screen readers and on hover. */}
                        <p id={prevId} className="sr-only">
                          {err
                            ? "Fix this range to see its slots."
                            : `${describeSlots(starts)}.`}
                        </p>
                      </div>
                    );
                  })}
                  {nextNote && (
                    <p className="text-[14px] text-amberline">{nextNote}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Date overrides */}
        <div
          role="tabpanel"
          id={`${uid}-panel-overrides`}
          aria-labelledby={`${uid}-tab-overrides`}
          data-tab="overrides"
          hidden={tab !== "overrides"}
          className="space-y-4"
        >
          <div className="rounded-xl border border-rule bg-white p-5">
            <p className="font-display text-sm font-semibold text-graphite">
              Add a date override
            </p>
            <p className="mt-1 text-xs text-pencil">
              A day off removes all your hours that date. Extra hours add to
              your weekly hours. Nothing changes until you save.
            </p>
            <div className="mt-3 flex flex-wrap items-start gap-2">
              <input
                id={`${uid}-ovdate`}
                type="date"
                aria-label="Override date"
                aria-invalid={!!ovErrors.date || undefined}
                aria-describedby={
                  ovErrors.date ? `${uid}-ovdate-err` : undefined
                }
                value={ovDate}
                min={today}
                max={lastInterviewDate ?? undefined}
                onChange={(e) => {
                  setOvDate(e.target.value);
                  setOvErrors((x) => ({ ...x, date: undefined }));
                }}
                className={cn(
                  "min-h-11 rounded-lg border bg-white px-2 text-sm text-graphite",
                  ovErrors.date
                    ? "border-alert ring-1 ring-alert"
                    : "border-rule",
                )}
              />
              <select
                aria-label="Override type"
                value={ovKind}
                onChange={(e) => {
                  setOvKind(e.target.value as "ADD" | "REMOVE");
                  setOvErrors((x) => ({ ...x, range: undefined }));
                }}
                className="min-h-11 rounded-lg border border-rule bg-white px-2 text-sm text-graphite"
              >
                <option value="REMOVE">Day off</option>
                <option value="ADD">Extra hours</option>
              </select>
              {ovKind === "ADD" && (
                <div className="flex items-center gap-2">
                  <Select
                    id={`${uid}-ovstart`}
                    label="Override start time"
                    value={ovStart}
                    options={startOpts}
                    invalid={!!ovErrors.range}
                    describedBy={`${ovErrors.range ? `${uid}-ovrange-err ` : ""}${uid}-ovprev`}
                    onChange={(v) => {
                      setOvStart(v);
                      setOvErrors((x) => ({ ...x, range: undefined }));
                    }}
                  />
                  <span className="text-pencil" aria-hidden="true">
                    –
                  </span>
                  <Select
                    label="Override end time"
                    value={ovEnd}
                    options={endOpts}
                    invalid={!!ovErrors.range}
                    describedBy={`${ovErrors.range ? `${uid}-ovrange-err ` : ""}${uid}-ovprev`}
                    onChange={(v) => {
                      setOvEnd(v);
                      setOvErrors((x) => ({ ...x, range: undefined }));
                    }}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={addOverride}
                className={btnClass("outline", "min-h-11 px-4 text-[15px]")}
              >
                <Plus className="size-4" aria-hidden="true" /> Add to list
              </button>
            </div>
            {ovErrors.date && (
              <p
                id={`${uid}-ovdate-err`}
                className="mt-2 flex items-start gap-1 text-sm text-alert"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                {ovErrors.date}
              </p>
            )}
            {ovKind === "ADD" && ovErrors.range && (
              <p
                id={`${uid}-ovrange-err`}
                className="mt-2 flex items-start gap-1 text-sm text-alert"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                {ovErrors.range}
              </p>
            )}
            {ovKind === "ADD" && (
              <p id={`${uid}-ovprev`} className="mt-2 text-xs text-pencil">
                {ovPreview === null
                  ? "Pick a date to see the extra slots."
                  : ovPreview.length === 0
                    ? "Creates no extra slots on that date (too short, or already covered by your weekly hours)."
                    : `${describeSlots(ovPreview)} on ${fmtDate(ovDate)}.`}
              </p>
            )}
          </div>

          <ul
            className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-white"
            aria-label="Date overrides"
          >
            {overrideRows.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-pencil">
                No date overrides.
              </li>
            )}
            {overrideRows.map(({ o, removed, unsaved: pending }) => {
              const err = overrideServerErrors.get(o.date);
              const errId = `${uid}-overr-${o.date}`;
              const what =
                o.kind === "REMOVE"
                  ? "day off"
                  : `extra hours ${label12(o.startLocal!)}–${label12(o.endLocal!)}`;
              return (
                <li key={`${ovKey(o)}-${removed}`} className="px-5 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={cn(
                        "flex flex-wrap items-center gap-2 text-sm text-graphite",
                        removed && "text-pencil",
                      )}
                    >
                      <span
                        className={cn(
                          "font-semibold",
                          removed && "line-through",
                        )}
                      >
                        {fmtDate(o.date)}
                      </span>
                      {o.kind === "REMOVE" ? (
                        <span
                          className={cn(
                            "rounded-md bg-rule-soft px-2 py-0.5 text-xs text-pencil",
                            removed && "line-through",
                          )}
                        >
                          Day off
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "rounded-md bg-ballpoint-soft px-2 py-0.5 text-xs text-ballpoint",
                            removed && "line-through",
                          )}
                        >
                          Extra {label12(o.startLocal!)}–{label12(o.endLocal!)}
                        </span>
                      )}
                      {pending && (
                        <UnsavedTag>
                          {removed ? "Removing · unsaved" : "Unsaved"}
                        </UnsavedTag>
                      )}
                    </span>
                    {removed ? (
                      <button
                        type="button"
                        onClick={() => undoRemove(o)}
                        aria-label={`Undo removing ${fmtDate(o.date)} ${what}`}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-ballpoint hover:bg-rule-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ballpoint"
                      >
                        <Undo2 className="size-4" aria-hidden="true" /> Undo
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeOverride(o)}
                        aria-label={`Remove override: ${fmtDate(o.date)} ${what}`}
                        aria-describedby={err ? errId : undefined}
                        className="inline-flex size-11 items-center justify-center rounded-lg text-pencil hover:bg-rule-soft hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ballpoint"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {err && (
                    <p
                      id={errId}
                      className="mt-1 flex items-start gap-1 text-sm text-alert"
                    >
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      {err}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Save bar */}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-rule-soft p-4">
          <div
            className="min-w-[14rem] flex-1 text-sm text-graphite"
            id={statusId}
            aria-live="polite"
          >
            {dirty ? (
              <p className="font-semibold">
                {plural(unsaved, "unsaved change")}
                {errorCount > 0 && (
                  <span className="font-normal text-alert">
                    {" "}
                    · {plural(errorCount, "problem")} to fix
                  </span>
                )}
              </p>
            ) : (
              <p>All changes saved.</p>
            )}
            <p className="text-xs text-pencil">
              Changing hours never cancels a booked interview.
            </p>
          </div>
          <div className="flex gap-3">
            <ConfirmDialog
              trigger={(open) => (
                <button
                  type="button"
                  onClick={open}
                  disabled={!dirty || busy}
                  className={btnClass("outline", "min-h-11 px-4 text-[15px]")}
                >
                  Discard
                </button>
              )}
              title="Discard unsaved changes?"
              impact="Your weekly hours and date overrides go back to the last saved version."
              confirmLabel="Discard changes"
              tone="notebook"
              onConfirm={() => discard()}
            />
            <button
              type="button"
              onClick={save}
              disabled={!dirty || busy}
              aria-describedby={statusId}
              className={btnClass(
                dirty ? "next" : "outline",
                "min-h-11 px-5 text-[15px]",
              )}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        {result && (
          <div role="status" className="mt-3 space-y-2">
            <p className="rounded-xl border border-mint/40 bg-mint-soft p-3 text-sm text-graphite">
              {saveSummary(result)}
            </p>
            {result.bookedAffected.length > 0 && (
              <div className="rounded-xl border border-amberline/40 bg-amberline-soft p-3 text-sm text-graphite">
                <p className="flex items-start gap-2 font-semibold">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-amberline"
                    aria-hidden="true"
                  />
                  These booked interviews are outside your new hours and stay
                  booked:
                </p>
                <ul className="mt-1 list-disc pl-10">
                  {result.bookedAffected.map((b) => (
                    <li key={b.startIso}>
                      {dateTime(b.startIso)}
                      {b.studentFirstName ? ` · ${b.studentFirstName}` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 pl-6">
                  Can&apos;t take them?{" "}
                  <a
                    href={`mailto:interview-team@panseeds.in?subject=${encodeURIComponent("Booked interviews outside my new hours")}&body=${encodeURIComponent(
                      result.bookedAffected
                        .map(
                          (b) =>
                            `${dateTime(b.startIso)}${b.studentFirstName ? `, ${b.studentFirstName}` : ""}`,
                        )
                        .join("\n"),
                    )}`}
                    className="font-semibold text-ballpoint underline underline-offset-4"
                  >
                    Message the interview team
                  </a>{" "}
                  with these times.
                </p>
              </div>
            )}
            <Link
              href="/schedule"
              className={btnClass("outline", "min-h-11 px-4 text-[15px]")}
            >
              Back to today
            </Link>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={leaveHref !== null}
        onOpenChange={(o) => {
          if (!o) setLeaveHref(null);
        }}
        title="Leave without saving?"
        impact={`You have ${plural(unsaved, "unsaved change")}. If you leave this page now, ${unsaved === 1 ? "it is" : "they are"} lost.`}
        confirmLabel="Leave without saving"
        tone="notebook"
        onConfirm={() => {
          const href = leaveHref;
          setLeaveHref(null);
          if (href) router.push(href);
        }}
      />

      <aside className="space-y-4">
        <AvailabilityCalendar
          today={today}
          deadlineDate={deadlineDate}
          marks={calendarMarks}
        />
        {sidebar}
      </aside>
    </div>
  );
}

function saveSummary(r: SaveResult): string {
  const changes =
    r.created || r.removed
      ? `${plural(r.created, "slot")} added, ${r.removed} removed.`
      : "No slots added or removed.";
  let when = "";
  if (r.created > 0) {
    const at = r.nextReleaseIso ? dateTime(r.nextReleaseIso) : null;
    const one = r.created === 1;
    if (r.createdLiveNow === r.created)
      when = one
        ? " It's open for booking now."
        : " They're open for booking now.";
    else if (r.createdLater === r.created)
      when = at ? ` ${one ? "It goes" : "They go"} live from ${at}.` : "";
    else {
      const parts = [
        r.createdLiveNow ? `${r.createdLiveNow} open for booking now` : null,
        r.createdLater
          ? `${r.createdLater} go${r.createdLater === 1 ? "es" : ""} live${at ? ` from ${at}` : " at a later release"}`
          : null,
        r.createdTooSoon
          ? `${r.createdTooSoon} start${r.createdTooSoon === 1 ? "s" : ""} too soon to book (booking closes ${r.bookingCutoffHours} h before)`
          : null,
      ].filter(Boolean);
      when = ` ${parts.join("; ")}.`;
    }
  }
  const booked = r.bookedAffected.length
    ? ` ${plural(r.bookedAffected.length, "booked interview")} outside your new hours stay${r.bookedAffected.length === 1 ? "s" : ""} booked.`
    : "";
  return `Saved. ${changes}${when}${booked}`;
}
