/**
 * Pure slot-grid rules shared by the availability editor (live preview,
 * validation) and the availability API (server validation, booked-slot checks).
 *
 * MIRRORS src/services/slots.ts (materializeSlots). If you change how slots are
 * generated there, change `slotStartsForWindow` / `previewDay` here too:
 *   - a window is clamped to [grid_start_local, grid_end_local];
 *   - the first slot starts at the (clamped) window start;
 *   - the next one starts `slot_grid_minutes` later;
 *   - a slot is created only if start + slot_duration_minutes <= window end;
 *   - each slot occupies [start, start + slot_grid_minutes) and slots that
 *     would overlap one already placed that day (or an existing booked slot)
 *     are skipped;
 *   - a day's windows are processed in start order;
 *   - start times that have already passed are skipped.
 * No DB or framework imports, so it runs on both server and client.
 */

export interface GridRules {
  gridMinutes: number; // slot_grid_minutes (start-to-start step, includes buffer)
  durationMinutes: number; // slot_duration_minutes
  gridStart: string; // "HH:MM" grid_start_local
  gridEnd: string; // "HH:MM" grid_end_local
}

export const DEFAULT_GRID: GridRules = {
  gridMinutes: 40,
  durationMinutes: 30,
  gridStart: "09:00",
  gridEnd: "21:00",
};

export interface TimeRange {
  startLocal: string; // "HH:MM"
  endLocal: string; // "HH:MM"
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:40" -> "9:40 AM" */
export function label12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "9:00 AM–12:00 PM" */
export function rangeLabel(r: TimeRange): string {
  return `${label12(r.startLocal)}–${label12(r.endLocal)}`;
}

/** Slot start minutes (minutes after midnight) one window creates, ignoring other windows. */
export function slotStartsForWindow(r: TimeRange, g: GridRules): number[] {
  const out: number[] = [];
  let t = Math.max(toMin(r.startLocal), toMin(g.gridStart));
  const end = Math.min(toMin(r.endLocal), toMin(g.gridEnd));
  if (g.gridMinutes <= 0) return out;
  while (t + g.durationMinutes <= end) {
    out.push(t);
    t += g.gridMinutes;
  }
  return out;
}

export interface PreviewOptions {
  /** Start minutes of slots that already exist that day and survive a save (booked /
   *  blocked). Each occupies [start, start + slot_grid_minutes), like a placed slot. */
  occupied?: number[];
  /** Only starts strictly after this minute of the day are created (materializeSlots
   *  skips start times that have passed). Use for today; omit for other days. */
  afterMin?: number;
}

/**
 * Slots a whole day of windows creates, skipping any slot that overlaps one already
 * placed (same as materializeSlots' overlap dedupe). Windows are processed in start
 * order (as materializeSlots does), but the result has one array of start minutes per
 * window in the order given.
 */
export function previewDay(windows: TimeRange[], g: GridRules, opts: PreviewOptions = {}): number[][] {
  const placed: number[] = [...(opts.occupied ?? [])];
  const out: number[][] = windows.map(() => []);
  const order = windows
    .map((w, i) => ({ w, i }))
    .sort((a, b) => a.w.startLocal.localeCompare(b.w.startLocal) || a.w.endLocal.localeCompare(b.w.endLocal));
  for (const { w, i } of order) {
    for (const s of slotStartsForWindow(w, g)) {
      if (opts.afterMin !== undefined && s <= opts.afterMin) continue;
      if (placed.some((p) => s < p + g.gridMinutes && p < s + g.gridMinutes)) continue;
      placed.push(s);
      out[i].push(s);
    }
  }
  return out;
}

/**
 * True if an interview starting at `startMin` fits inside one of the windows
 * (start within the window and start + slot_duration_minutes <= window end).
 * Containment, not grid membership: a booked slot made from older, differently
 * aligned hours still counts as inside hours that cover it.
 */
export function fitsInWindows(startMin: number, windows: TimeRange[], g: GridRules): boolean {
  return windows.some((w) => toMin(w.startLocal) <= startMin && startMin + g.durationMinutes <= toMin(w.endLocal));
}

/** "Creates 4 slots: 9:00, 9:40, 10:20, 11:00 AM" */
export function describeSlots(starts: number[]): string {
  if (starts.length === 0) return "Creates no slots";
  const labels = starts.map((s, i) => {
    const l = label12(fromMin(s));
    const nextAp = i < starts.length - 1 ? label12(fromMin(starts[i + 1])).slice(-2) : null;
    // Show AM/PM only on the last item of each AM/PM run: "9:00, 9:40, 11:00 AM, 12:20 PM".
    return nextAp === null || nextAp !== l.slice(-2) ? l : l.slice(0, -3);
  });
  return `Creates ${starts.length} slot${starts.length === 1 ? "" : "s"}: ${labels.join(", ")}`;
}

/** Start-time choices: every grid point from which at least one slot fits before grid end. */
export function startOptions(g: GridRules): string[] {
  const out: string[] = [];
  if (g.gridMinutes <= 0) return out;
  for (let t = toMin(g.gridStart); t + g.durationMinutes <= toMin(g.gridEnd); t += g.gridMinutes) out.push(fromMin(t));
  return out;
}

/** End-time choices: every grid point after grid start, up to and including grid end. */
export function endOptions(g: GridRules): string[] {
  const out: string[] = [];
  if (g.gridMinutes <= 0) return out;
  const end = toMin(g.gridEnd);
  let t = toMin(g.gridStart) + g.gridMinutes;
  for (; t <= end; t += g.gridMinutes) out.push(fromMin(t));
  if (out[out.length - 1] !== g.gridEnd) out.push(g.gridEnd);
  return out;
}

/**
 * Per-range error messages for one day's ranges (index -> message). Checks:
 * end after start, creates at least one slot, no overlap with another range.
 */
export function validateDayRanges(ranges: TimeRange[], g: GridRules): Map<number, string> {
  const errs = new Map<number, string>();
  ranges.forEach((r, i) => {
    const s = toMin(r.startLocal);
    const e = toMin(r.endLocal);
    if (e <= s) {
      errs.set(i, "End time must be after start time.");
      return;
    }
    if (slotStartsForWindow(r, g).length === 0) {
      errs.set(
        i,
        `Too short or outside ${label12(g.gridStart)}–${label12(g.gridEnd)}: a ${g.durationMinutes}-min interview doesn't fit.`
      );
      return;
    }
    for (let j = 0; j < ranges.length; j++) {
      if (j === i) continue;
      const o = ranges[j];
      const os = toMin(o.startLocal);
      const oe = toMin(o.endLocal);
      if (oe <= os) continue;
      if (s < oe && os < e) {
        errs.set(i, s === os && e === oe ? `Same as your other ${rangeLabel(o)} hours. Remove one.` : `Overlaps your ${rangeLabel(o)} hours.`);
        return;
      }
    }
  });
  return errs;
}

/**
 * A default new range: the first free gap after the last range (falling back to
 * any earlier gap) that fits at least one slot, up to 4 slots long. Null when the
 * day has no room left.
 */
export function nextFreeRange(ranges: TimeRange[], g: GridRules): TimeRange | null {
  const starts = startOptions(g).map(toMin);
  const ends = endOptions(g).map(toMin);
  const busy = ranges
    .map((r) => ({ s: toMin(r.startLocal), e: toMin(r.endLocal) }))
    .filter((r) => r.e > r.s)
    .sort((a, b) => a.s - b.s);
  const free = (s: number, e: number) => busy.every((b) => !(s < b.e && b.s < e));
  const lastEnd = busy.length ? Math.max(...busy.map((b) => b.e)) : 0;
  const ordered = [...starts.filter((s) => s >= lastEnd), ...starts.filter((s) => s < lastEnd)];
  for (const s of ordered) {
    if (!free(s, s + g.durationMinutes)) continue;
    // longest end (max 4 grid steps) that stays free
    let best: number | null = null;
    for (const e of ends) {
      if (e < s + g.durationMinutes) continue;
      if (e > s + 4 * g.gridMinutes) break;
      if (!free(s, e)) break;
      best = e;
    }
    if (best !== null) return { startLocal: fromMin(s), endLocal: fromMin(best) };
  }
  return null;
}
