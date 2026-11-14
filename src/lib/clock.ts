import { sql } from "@/db";
import { DateTime } from "luxon";
import { IST } from "./env";

/**
 * The app clock. Business logic reads serverNow() (app side) / app_now() (SQL side),
 * never new Date() or now(). Both read the single sim_clock row:
 *  - REAL (the default): the real date and time, plus real_offset_seconds.
 *    Demo time jumps only change the offset, so after a jump the clock keeps
 *    running second by second, exactly like real time (countdowns, join windows
 *    and the background job timer all stay in step).
 *  - SIM: a frozen moment. Legacy; nothing sets it any more, but app_now() still
 *    honours it and any jump below switches back to a running clock.
 */

export async function serverNow(): Promise<Date> {
  const rows = await sql<{ now: Date }[]>`SELECT app_now() AS now`;
  return rows[0].now;
}

export type ClockState = { mode: "SIM" | "REAL"; offsetSeconds: number; shifted: boolean };

export async function getClock(): Promise<ClockState> {
  const rows = await sql<{ mode: "SIM" | "REAL"; offset: number }[]>`
    SELECT mode, real_offset_seconds::float8 AS offset FROM sim_clock WHERE id = true`;
  const r = rows[0];
  const offsetSeconds = Number(r.offset) || 0;
  return { mode: r.mode, offsetSeconds, shifted: r.mode === "SIM" || offsetSeconds !== 0 };
}

/**
 * Run the clock from `iso` onwards. The offset is rounded UP to the next whole
 * second, so app time never lands before the target (a job due exactly at the
 * target is always due straight after the jump).
 */
export async function setClockAbsolute(iso: string): Promise<Date> {
  const dt = DateTime.fromISO(iso, { zone: IST });
  // Raw sql templates must pass timestamps as ISO strings (the Drizzle-wrapped
  // client doesn't serialize Date objects in tagged queries).
  const value = (dt.isValid ? dt.toISO() : new Date(iso).toISOString())!;
  await sql`
    UPDATE sim_clock
    SET mode = 'REAL',
        real_offset_seconds = ceil(extract(epoch FROM (${value}::timestamptz - now())))::bigint,
        updated_at = now()
    WHERE id = true`;
  return serverNow();
}

/** Jump forward from the current app time; the clock keeps running afterwards. */
export async function advanceClock(seconds: number): Promise<Date> {
  await sql`
    UPDATE sim_clock
    SET real_offset_seconds = ceil(extract(epoch FROM (app_now() + make_interval(secs => ${seconds}) - now())))::bigint,
        mode = 'REAL',
        updated_at = now()
    WHERE id = true`;
  return serverNow();
}

/** Back to the real date and time. */
export async function setClockReal(): Promise<Date> {
  await sql`UPDATE sim_clock SET mode = 'REAL', real_offset_seconds = 0, updated_at = now() WHERE id = true`;
  return serverNow();
}
