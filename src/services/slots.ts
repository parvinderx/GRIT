import { and, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Sql, TransactionSql } from "postgres";
import { db, sql } from "@/db";
import { interviewSlots, seasons } from "@/db/schema";
import { IST } from "@/lib/env";
import { serverNow } from "@/lib/clock";

/** luxon weekday (1=Mon..7=Sun) -> our schema weekday (0=Sun..6=Sat) */
function toSchemaWeekday(luxonWeekday: number): number {
  return luxonWeekday % 7;
}

interface Window {
  start: string; // "HH:MM"
  end: string;
}

type Querier = Sql | TransactionSql;

/**
 * Per-interviewer availability lock. Everything that rewrites an interviewer's
 * slots (saving hours, materialising) takes it inside its transaction, so a save
 * (delete + rules write + materialise) and the job's materialiser never interleave.
 * Transaction-scoped: released at COMMIT / ROLLBACK. Re-entrant within one transaction.
 */
export async function lockAvailability(tx: TransactionSql, interviewerId: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${"availability:" + interviewerId}))`;
}

interface SeasonGrid {
  grid: number;
  duration: number;
  horizon: number;
  gridStart: string; // "HH:MM"
  gridEnd: string;
  releaseHour: number;
}

async function seasonGrid(q: Querier): Promise<SeasonGrid | null> {
  const r = (
    await q<{ grid: number; duration: number; horizon: number; gs: string; ge: string; release: number }[]>`
      SELECT slot_grid_minutes grid, slot_duration_minutes duration, horizon_days horizon,
             to_char(grid_start_local, 'HH24:MI') gs, to_char(grid_end_local, 'HH24:MI') ge,
             day_release_hour_ist release
      FROM season_rules LIMIT 1`
  )[0];
  if (!r) return null;
  return { grid: r.grid, duration: r.duration, horizon: r.horizon, gridStart: r.gs, gridEnd: r.ge, releaseHour: r.release };
}

/**
 * Build interview_slots on the grid for the next horizon_days. Idempotent:
 * existing slots are left untouched. A day's slots become bookable at the 8 PM
 * IST release `horizon_days` earlier (the rolling window), so the newest day
 * opens tonight.
 *
 * Each interviewer is materialised under its availability lock:
 *  - with `tx`: inside the caller's transaction (the caller may already hold the
 *    lock, e.g. saveAvailability; taking it again is a no-op);
 *  - without: one short transaction per interviewer (in a sweep over all
 *    interviewers, a failing interviewer is logged and skipped).
 */
export async function materializeSlots(opts?: { interviewerId?: string; tx?: TransactionSql }): Promise<number> {
  const q: Querier = opts?.tx ?? sql;
  const ivs = opts?.interviewerId
    ? await q<{ id: string }[]>`SELECT id FROM interviewers WHERE active AND id = ${opts.interviewerId}`
    : await q<{ id: string }[]>`SELECT id FROM interviewers WHERE active ORDER BY id`;

  let created = 0;
  for (const iv of ivs) {
    if (opts?.tx) {
      created += await materializeOne(opts.tx, iv.id);
    } else if (opts?.interviewerId) {
      created += await sql.begin((tx) => materializeOne(tx, iv.id));
    } else {
      // Sweep over everyone (the job): one interviewer's failure mustn't stop the rest.
      try {
        created += await sql.begin((tx) => materializeOne(tx, iv.id));
      } catch (e) {
        console.error(`materializeSlots: interviewer ${iv.id} failed`, e);
      }
    }
  }
  return created;
}

async function materializeOne(tx: TransactionSql, interviewerId: string): Promise<number> {
  await lockAvailability(tx, interviewerId);
  const rules = await seasonGrid(tx);
  if (!rules) return 0;
  const { grid, duration, horizon } = rules;
  const now = (await tx<{ now: Date }[]>`SELECT app_now() now`)[0].now;
  const nowMs = now.getTime();
  const today = DateTime.fromJSDate(now).setZone(IST).startOf("day");

  // Same order everywhere (here, the editor preview in lib/slotGrid, bookedOutsideHours):
  // windows sorted by start, so overlapping windows dedupe the same way.
  const ivRules = await tx<{ weekday: number; s: string; e: string }[]>`
    SELECT weekday, to_char(start_local, 'HH24:MI') s, to_char(end_local, 'HH24:MI') e
    FROM availability_rules WHERE interviewer_id = ${interviewerId} AND active
    ORDER BY weekday, start_local, end_local`;
  const ivOverrides = await tx<{ date: string; kind: "ADD" | "REMOVE"; s: string | null; e: string | null }[]>`
    SELECT to_char(date, 'YYYY-MM-DD') date, kind, to_char(start_local, 'HH24:MI') s, to_char(end_local, 'HH24:MI') e
    FROM availability_overrides WHERE interviewer_id = ${interviewerId}
    ORDER BY date, start_local NULLS FIRST`;

  // Existing slot ranges in the horizon. The DB's gist EXCLUDE forbids overlapping
  // [start, buffer_end) ranges per interviewer among non-CANCELLED slots, so dedupe
  // by overlap against those only: a CANCELLED slot's time can be generated again.
  const rangeStart = today.toJSDate();
  const rangeEnd = today.plus({ days: horizon + 1 }).toJSDate();
  const existing = await tx<{ start_at: Date; buffer_end_at: Date }[]>`
    SELECT start_at, buffer_end_at FROM interview_slots
    WHERE interviewer_id = ${interviewerId} AND status <> 'CANCELLED'
      AND start_at >= ${rangeStart} AND start_at < ${rangeEnd}`;
  const ranges = existing.map((e) => ({ start: e.start_at.getTime(), end: e.buffer_end_at.getTime() }));
  const overlapsExisting = (start: number, end: number) => ranges.some((r) => start < r.end && r.start < end);

  const toInsert: {
    interviewer_id: string;
    start_at: Date;
    buffer_end_at: Date;
    status: "OPEN";
    audience: "ANY";
    bookable_from: Date;
  }[] = [];

  for (let d = 0; d <= horizon; d++) {
    const day = today.plus({ days: d });
    const date = day.toFormat("yyyy-MM-dd");
    const wd = toSchemaWeekday(day.weekday);

    if (ivOverrides.some((o) => o.kind === "REMOVE" && o.date === date && !o.s)) continue;

    const windows: Window[] = [
      ...ivRules.filter((r) => r.weekday === wd).map((r) => ({ start: r.s, end: r.e })),
      ...ivOverrides
        .filter((o) => o.kind === "ADD" && o.date === date && o.s && o.e)
        .map((o) => ({ start: o.s!, end: o.e! })),
    ].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    if (!windows.length) continue;

    // a day's slots become bookable at the 8 PM release `horizon` days earlier
    const bookableFrom = day
      .minus({ days: horizon })
      .set({ hour: rules.releaseHour, minute: 0, second: 0, millisecond: 0 })
      .toJSDate();

    const dayStartClamp = clampToTime(day, rules.gridStart);
    const dayEndClamp = clampToTime(day, rules.gridEnd);

    for (const w of windows) {
      let t = maxDT(clampToTime(day, w.start), dayStartClamp);
      const wEnd = minDT(clampToTime(day, w.end), dayEndClamp);
      while (t.plus({ minutes: duration }) <= wEnd) {
        const startAt = t.toJSDate();
        const bufferEndAt = t.plus({ minutes: grid }).toJSDate();
        const startMs = startAt.getTime();
        const endMs = bufferEndAt.getTime();
        if (startMs > nowMs && !overlapsExisting(startMs, endMs)) {
          ranges.push({ start: startMs, end: endMs });
          toInsert.push({
            interviewer_id: interviewerId,
            start_at: startAt,
            buffer_end_at: bufferEndAt,
            status: "OPEN",
            audience: "ANY",
            bookable_from: bookableFrom,
          });
        }
        t = t.plus({ minutes: grid });
      }
    }
  }

  if (toInsert.length) {
    await tx`INSERT INTO interview_slots ${tx(toInsert, "interviewer_id", "start_at", "buffer_end_at", "status", "audience", "bookable_from")}`;
  }
  return toInsert.length;
}

function clampToTime(day: DateTime, hhmm: string): DateTime {
  const [h, m] = hhmm.split(":").map(Number);
  return day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
}
function maxDT(a: DateTime, b: DateTime) {
  return a > b ? a : b;
}
function minDT(a: DateTime, b: DateTime) {
  return a < b ? a : b;
}

/** Earliest OPEN, currently-bookable slot start for display ("Earliest open: …"). */
export async function earliestOpenStart(): Promise<Date | null> {
  const now = await serverNow();
  const rows = await db
    .select({ startAt: interviewSlots.startAt })
    .from(interviewSlots)
    .where(and(eq(interviewSlots.status, "OPEN"), gte(interviewSlots.startAt, now)))
    .orderBy(interviewSlots.startAt)
    .limit(1);
  return rows[0]?.startAt ?? null;
}

export async function activeSeason() {
  return (await db.select().from(seasons).limit(1))[0];
}
