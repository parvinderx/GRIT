import { DateTime } from "luxon";
import { sql } from "@/db";
import { ApiError, pgCode } from "@/lib/errors";
import { IST } from "@/lib/env";
import { lockAvailability, materializeSlots } from "@/services/slots";
import {
  DEFAULT_GRID,
  type GridRules,
  type TimeRange,
  fitsInWindows,
  label12,
  rangeLabel,
  validateDayRanges,
} from "@/lib/slotGrid";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface AvailabilityConfig {
  grid: GridRules;
  horizonDays: number;
  releaseHourIst: number;
  /** Today in IST by the app clock, YYYY-MM-DD. */
  today: string;
  /** Minutes since IST midnight now (app clock), with fractions: today's slots at or
   *  before this minute aren't created any more. */
  nowMinute: number;
  /** season_rules.booking_cutoff_hours: booking closes this long before a start. */
  bookingCutoffHours: number;
  /** Badge deadline (IST date), YYYY-MM-DD, or null with no season. */
  deadlineDate: string | null;
  /** Last date interviews can run (IST), YYYY-MM-DD, or null with no season. */
  lastInterviewDate: string | null;
}

/** Season grid rules + dates the availability editor needs. Falls back to defaults. */
export async function getAvailabilityConfig(): Promise<AvailabilityConfig> {
  const rows = await sql<
    {
      grid: number;
      duration: number;
      gs: string;
      ge: string;
      release: number;
      horizon: number;
      deadline: string;
      last_interview: string;
      cutoff: number;
    }[]
  >`
    SELECT r.slot_grid_minutes grid, r.slot_duration_minutes duration,
           to_char(r.grid_start_local, 'HH24:MI') gs, to_char(r.grid_end_local, 'HH24:MI') ge,
           r.day_release_hour_ist release, r.horizon_days horizon, r.booking_cutoff_hours cutoff,
           to_char(s.deadline_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') deadline,
           to_char(s.last_interview_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') last_interview
    FROM season_rules r JOIN seasons s ON s.id = r.season_id
    LIMIT 1`;
  const clock = (await sql<{ d: string; m: number }[]>`
    SELECT to_char((app_now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') d,
           (extract(epoch FROM (app_now() AT TIME ZONE 'Asia/Kolkata')::time) / 60)::float8 m`)[0];
  const today = clock.d;
  const nowMinute = Number(clock.m);
  const r = rows[0];
  if (!r) {
    return { grid: DEFAULT_GRID, horizonDays: 14, releaseHourIst: 20, today, nowMinute, bookingCutoffHours: 3, deadlineDate: null, lastInterviewDate: null };
  }
  return {
    grid: { gridMinutes: r.grid, durationMinutes: r.duration, gridStart: r.gs, gridEnd: r.ge },
    horizonDays: r.horizon,
    releaseHourIst: r.release,
    today,
    nowMinute,
    bookingCutoffHours: r.cutoff,
    deadlineDate: r.deadline,
    lastInterviewDate: r.last_interview,
  };
}

export interface WeeklyInput {
  weekday: number;
  startLocal: string;
  endLocal: string;
}
export interface OverrideInput {
  date: string;
  kind: "ADD" | "REMOVE";
  startLocal?: string | null;
  endLocal?: string | null;
}

export type FieldError =
  | { scope: "weekly"; weekday: number; index: number; message: string }
  | { scope: "override"; date: string; message: string };

export interface SaveResult {
  /** Open slots that didn't exist before this save. */
  created: number;
  /** Future open slots that existed before and are gone now. */
  removed: number;
  /** Of `created`, how many students can book right now: their day is released and
   *  they start after the booking cutoff (season_rules.booking_cutoff_hours). */
  createdLiveNow: number;
  /** Of `created`, how many open at a later daily release. */
  createdLater: number;
  /** Of `created`, released but starting inside the booking cutoff: students can't book them. */
  createdTooSoon: number;
  bookingCutoffHours: number;
  /** Earliest release time of the `createdLater` slots, or null. */
  nextReleaseIso: string | null;
  /** Future BOOKED slots outside the new hours. They are NOT cancelled. */
  bookedAffected: { startIso: string; studentFirstName?: string }[];
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates the whole payload; throws 422 with per-field `errors` if anything is wrong. */
function validate(
  weekly: WeeklyInput[],
  overrides: OverrideInput[] | undefined,
  cfg: AvailabilityConfig
): void {
  const errors: FieldError[] = [];

  // Shape first: positions in `byDay` follow the client's order within each weekday.
  const byDay = new Map<number, TimeRange[]>();
  for (const w of weekly) {
    if (!w || typeof w !== "object") throw new ApiError(422, "INVALID", "Each weekly range must be an object.");
    if (!Number.isInteger(w.weekday) || w.weekday < 0 || w.weekday > 6)
      throw new ApiError(422, "INVALID", "Weekday must be 0–6.");
    if (typeof w.startLocal !== "string" || typeof w.endLocal !== "string" || !TIME_RE.test(w.startLocal) || !TIME_RE.test(w.endLocal))
      throw new ApiError(422, "INVALID", "Times must be HH:MM (24h).");
    const list = byDay.get(w.weekday) ?? [];
    list.push({ startLocal: w.startLocal, endLocal: w.endLocal });
    byDay.set(w.weekday, list);
  }
  for (const [wd, ranges] of byDay) {
    for (const [index, message] of validateDayRanges(ranges, cfg.grid)) {
      errors.push({ scope: "weekly", weekday: wd, index, message: `${WEEKDAYS[wd]} ${rangeLabel(ranges[index])}: ${message}` });
    }
  }

  if (overrides) {
    const seen = new Set<string>();
    for (const o of overrides) {
      if (!o || typeof o !== "object") throw new ApiError(422, "INVALID", "Each override must be an object.");
      if (typeof o.date !== "string" || !DATE_RE.test(o.date) || !DateTime.fromISO(o.date).isValid)
        throw new ApiError(422, "INVALID", "Override date must be YYYY-MM-DD.");
      if (o.kind !== "ADD" && o.kind !== "REMOVE") throw new ApiError(422, "INVALID", "Override kind must be ADD or REMOVE.");
      const day = DateTime.fromISO(o.date).toFormat("ccc d LLL");
      if (seen.has(o.date)) {
        errors.push({ scope: "override", date: o.date, message: `${day}: only one override per date.` });
        continue;
      }
      seen.add(o.date);
      if (o.date < cfg.today) {
        errors.push({ scope: "override", date: o.date, message: `${day} is in the past.` });
        continue;
      }
      if (cfg.lastInterviewDate && o.date > cfg.lastInterviewDate) {
        errors.push({ scope: "override", date: o.date, message: `${day} is after the last interview day of the season.` });
        continue;
      }
      if (o.kind === "ADD") {
        if (!o.startLocal || !o.endLocal || !TIME_RE.test(o.startLocal) || !TIME_RE.test(o.endLocal)) {
          errors.push({ scope: "override", date: o.date, message: `${day}: extra hours need a valid start and end time.` });
          continue;
        }
        const msg = validateDayRanges([{ startLocal: o.startLocal, endLocal: o.endLocal }], cfg.grid).get(0);
        if (msg) errors.push({ scope: "override", date: o.date, message: `${day}: ${msg}` });
      }
    }
  }

  if (errors.length) {
    const first = errors[0].message;
    const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
    throw new ApiError(422, "INVALID_AVAILABILITY", `${first}${more}`, { errors });
  }
}

/** 409 for an overlap (23P01) raised while rewriting an interviewer's slots. */
export function availabilityConflict(): ApiError {
  return new ApiError(
    409,
    "AVAILABILITY_CONFLICT",
    "Your slots changed while saving (another save or the scheduler ran at the same time). Reload the page and save again."
  );
}

/**
 * Replace an interviewer's weekly hours (and, if given, future date overrides),
 * drop their future OPEN slots and re-materialize — all in ONE transaction under
 * the per-interviewer availability lock, so a failure leaves everything as it was
 * and the job's materialiser can't interleave. BOOKED / BLOCKED slots are never
 * touched: booked interviews outside the new hours stay booked and are returned in
 * `bookedAffected` so the interviewer can contact the team.
 *
 * A future OPEN slot that an old (cancelled) booking still points at can't be
 * deleted (bookings.slot_id has no ON DELETE), so it is marked CANCELLED instead;
 * CANCELLED slots don't block a new slot at the same time (gist EXCLUDE and
 * materializeSlots both ignore them).
 */
export async function saveAvailability(
  interviewerId: string,
  weekly: WeeklyInput[],
  overrides: OverrideInput[] | undefined
): Promise<SaveResult> {
  const cfg = await getAvailabilityConfig();
  validate(weekly, overrides, cfg);

  type SlotRow = { start_at: Date; bookable_from: Date; released: boolean; bookable: boolean };
  let before: number[];
  let after: SlotRow[];
  try {
    ({ before, after } = await sql.begin(async (tx) => {
      // Serialise saves per interviewer (spec: "Serialised per interviewer").
      await lockAvailability(tx, interviewerId);
      const prev = await tx<{ start_at: Date }[]>`
        SELECT start_at FROM interview_slots
        WHERE interviewer_id = ${interviewerId} AND status = 'OPEN' AND start_at > app_now()`;
      await tx`DELETE FROM availability_rules WHERE interviewer_id = ${interviewerId}`;
      // Drop future OPEN (unbooked) slots so removed hours actually disappear;
      // BOOKED slots are never touched here. Slots an old booking still references
      // are retired (CANCELLED) rather than deleted.
      await tx`
        UPDATE interview_slots s SET status = 'CANCELLED', version = s.version + 1
        WHERE s.interviewer_id = ${interviewerId} AND s.status = 'OPEN' AND s.start_at > app_now()
          AND EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id)`;
      await tx`
        DELETE FROM interview_slots s
        WHERE s.interviewer_id = ${interviewerId} AND s.status = 'OPEN' AND s.start_at > app_now()
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id)`;
      for (const w of weekly) {
        await tx`
          INSERT INTO availability_rules (interviewer_id, weekday, start_local, end_local, active)
          VALUES (${interviewerId}, ${w.weekday}, ${w.startLocal}, ${w.endLocal}, true)`;
      }
      if (overrides) {
        await tx`DELETE FROM availability_overrides WHERE interviewer_id = ${interviewerId} AND date >= (app_now() AT TIME ZONE 'Asia/Kolkata')::date`;
        for (const o of overrides) {
          await tx`
            INSERT INTO availability_overrides (interviewer_id, date, kind, start_local, end_local)
            VALUES (${interviewerId}, ${o.date}, ${o.kind}, ${o.kind === "ADD" ? (o.startLocal ?? null) : null}, ${o.kind === "ADD" ? (o.endLocal ?? null) : null})`;
        }
      }

      await materializeSlots({ interviewerId, tx });

      // "Bookable now" = released AND outside the booking cutoff (what students can
      // actually pick right now; see services/availability.getAvailableTimes).
      const rows = await tx<SlotRow[]>`
        SELECT s.start_at, s.bookable_from, s.bookable_from <= app_now() AS released,
               (s.bookable_from <= app_now()
                AND s.start_at >= app_now() + make_interval(hours => ${cfg.bookingCutoffHours})) AS bookable
        FROM interview_slots s
        WHERE s.interviewer_id = ${interviewerId} AND s.status = 'OPEN' AND s.start_at > app_now()`;
      return { before: prev.map((p) => p.start_at.getTime()), after: rows };
    }));
  } catch (e) {
    if (pgCode(e) === "23P01") throw availabilityConflict();
    throw e;
  }

  const beforeSet = new Set(before);
  const afterSet = new Set(after.map((a) => a.start_at.getTime()));
  const added = after.filter((a) => !beforeSet.has(a.start_at.getTime()));
  const removed = before.filter((b) => !afterSet.has(b)).length;
  const later = added.filter((a) => !a.released);

  return {
    created: added.length,
    removed,
    createdLiveNow: added.filter((a) => a.bookable).length,
    createdLater: later.length,
    createdTooSoon: added.filter((a) => a.released && !a.bookable).length,
    bookingCutoffHours: cfg.bookingCutoffHours,
    nextReleaseIso: later.length ? new Date(Math.min(...later.map((a) => a.bookable_from.getTime()))).toISOString() : null,
    bookedAffected: await bookedOutsideHours(interviewerId, cfg.grid),
  };
}

/** Future BOOKED slots that don't fit inside the current rules + overrides any more. */
async function bookedOutsideHours(interviewerId: string, grid: GridRules): Promise<SaveResult["bookedAffected"]> {
  const rules = await sql<{ weekday: number; s: string; e: string }[]>`
    SELECT weekday, to_char(start_local, 'HH24:MI') s, to_char(end_local, 'HH24:MI') e
    FROM availability_rules WHERE interviewer_id = ${interviewerId} AND active
    ORDER BY weekday, start_local, end_local`;
  const ovs = await sql<{ date: string; kind: "ADD" | "REMOVE"; s: string | null; e: string | null }[]>`
    SELECT to_char(date, 'YYYY-MM-DD') date, kind, to_char(start_local, 'HH24:MI') s, to_char(end_local, 'HH24:MI') e
    FROM availability_overrides WHERE interviewer_id = ${interviewerId}
    ORDER BY date, start_local NULLS FIRST`;
  const booked = await sql<{ start_at: Date; display_name: string | null }[]>`
    SELECT DISTINCT ON (s.id) s.start_at, u.display_name
    FROM interview_slots s
    LEFT JOIN bookings b ON b.slot_id = s.id AND b.status IN ('CONFIRMED', 'IN_PROGRESS')
    LEFT JOIN students st ON st.id = b.student_id
    LEFT JOIN users u ON u.id = st.user_id
    WHERE s.interviewer_id = ${interviewerId} AND s.status = 'BOOKED' AND s.start_at > app_now()
    ORDER BY s.id, b.created_at DESC`;

  const out: SaveResult["bookedAffected"] = [];
  for (const b of booked) {
    const dt = DateTime.fromJSDate(b.start_at).setZone(IST);
    const date = dt.toFormat("yyyy-MM-dd");
    const wd = dt.weekday % 7; // luxon 1=Mon..7=Sun -> 0=Sun..6=Sat (as slots.ts)
    const dayOff = ovs.some((o) => o.kind === "REMOVE" && o.date === date && !o.s);
    const windows: TimeRange[] = dayOff
      ? []
      : [
          ...rules.filter((r) => r.weekday === wd).map((r) => ({ startLocal: r.s, endLocal: r.e })),
          ...ovs
            .filter((o) => o.kind === "ADD" && o.date === date && o.s && o.e)
            .map((o) => ({ startLocal: o.s!, endLocal: o.e! })),
        ];
    if (!fitsInWindows(dt.hour * 60 + dt.minute, windows, grid)) {
      const first = b.display_name?.trim().split(/\s+/)[0];
      out.push({ startIso: b.start_at.toISOString(), ...(first ? { studentFirstName: first } : {}) });
    }
  }
  return out.sort((a, b) => a.startIso.localeCompare(b.startIso));
}

/** "9:00 AM" style label of a release hour (e.g. 20 -> "8:00 PM"). */
export function releaseLabel(hour: number): string {
  return label12(`${String(hour).padStart(2, "0")}:00`);
}
