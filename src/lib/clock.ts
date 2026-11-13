import { sql } from "@/db";
import { DateTime } from "luxon";
import { IST } from "./env";

/**
 * The app clock. Business logic reads serverNow() (app side) / app_now() (SQL side),
 * never new Date() or now(). Both read the single sim_clock row:
 *  - REAL (the default): the real date and time.
 *  - SIM: a simulated moment, used only while demo tools jump the clock
 *    (DEV_TOOLS_ENABLED). setClockReal() goes back to real time.
 */

export async function serverNow(): Promise<Date> {
  const rows = await sql<{ now: Date }[]>`SELECT app_now() AS now`;
  return rows[0].now;
}

export async function getClock() {
  const rows = await sql<
    { mode: "SIM" | "REAL"; sim_now: Date; real_offset_seconds: number }[]
  >`SELECT mode, sim_now, real_offset_seconds FROM sim_clock WHERE id = true`;
  return rows[0];
}

export async function setClockAbsolute(iso: string): Promise<Date> {
  const dt = DateTime.fromISO(iso, { zone: IST });
  // Raw sql templates must pass timestamps as ISO strings (the Drizzle-wrapped
  // client doesn't serialize Date objects in tagged queries).
  const value = (dt.isValid ? dt.toISO() : new Date(iso).toISOString())!;
  await sql`UPDATE sim_clock SET mode = 'SIM', sim_now = ${value}::timestamptz, updated_at = now() WHERE id = true`;
  return serverNow();
}

/** Jump forward from the current app time (real or simulated); the clock becomes simulated. */
export async function advanceClock(seconds: number): Promise<Date> {
  await sql`
    UPDATE sim_clock
    SET sim_now = app_now() + make_interval(secs => ${seconds}), mode = 'SIM', updated_at = now()
    WHERE id = true`;
  return serverNow();
}

/** Back to the real date and time. */
export async function setClockReal(): Promise<Date> {
  await sql`UPDATE sim_clock SET mode = 'REAL', real_offset_seconds = 0, updated_at = now() WHERE id = true`;
  return serverNow();
}
