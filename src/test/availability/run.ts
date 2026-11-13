/**
 * Availability-save harness against the real PostgreSQL database. Creates isolated
 * test data (sso_subject prefix ATEST-), runs the checks, then cleans up. Never
 * resets the database; it only touches rows it created.
 *
 *   npm run test:availability
 *
 * 1. Saving hours when a future OPEN slot is still referenced by a cancelled booking
 *    succeeds (no FK 23503): the referenced slot is retired as CANCELLED, unreferenced
 *    ones are deleted, and the time can be generated again later.
 * 2. Concurrent saves and materialiser runs for one interviewer all succeed and leave
 *    a consistent state: every future OPEN slot fits the saved hours, and nothing is
 *    left for the materialiser to add.
 */
import { DateTime } from "luxon";
import { sql } from "@/db";
import { IST } from "@/lib/env";
import { DEFAULT_GRID, fitsInWindows, type TimeRange } from "@/lib/slotGrid";
import { getAvailabilityConfig, saveAvailability, type WeeklyInput } from "@/services/availabilityEditor";
import { materializeSlots } from "@/services/slots";

const MARK = "ATEST-";
let seq = 0;
const uid = () => `${MARK}${Date.now()}-${seq++}`;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name} — ${detail}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} — ${detail}`);
  }
}

const everyDay = (startLocal: string, endLocal: string): WeeklyInput[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startLocal, endLocal }));

async function mkInterviewer() {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (sso_subject, display_name) VALUES (${uid()}, 'ATEST Interviewer') RETURNING id`;
  await sql`INSERT INTO user_roles (user_id, role) VALUES (${u.id}, 'INTERVIEWER')`;
  const [iv] = await sql<{ id: string }[]>`
    INSERT INTO interviewers (user_id, display_name) VALUES (${u.id}, 'ATEST IV') RETURNING id`;
  return iv.id;
}

async function mkStudentJourney() {
  const season = (await sql<{ id: string }[]>`SELECT id FROM seasons LIMIT 1`)[0].id;
  const badge = (await sql<{ id: string }[]>`SELECT id FROM badges ORDER BY level, id LIMIT 1`)[0].id;
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (sso_subject, display_name) VALUES (${uid()}, 'ATEST Student') RETURNING id`;
  const [st] = await sql<{ id: string }[]>`
    INSERT INTO students (user_id, grit_id, base_miles) VALUES (${u.id}, ${uid()}, 0) RETURNING id`;
  const [j] = await sql<{ id: string }[]>`
    INSERT INTO interview_journeys (student_id, badge_id, season_id, state, state_reason)
    VALUES (${st.id}, ${badge}, ${season}, 'ELIGIBLE', 'ready') RETURNING id`;
  return { studentId: st.id, journeyId: j.id };
}

async function futureSlots(interviewerId: string, status: string) {
  return sql<{ id: string; start_at: Date }[]>`
    SELECT id, start_at FROM interview_slots
    WHERE interviewer_id = ${interviewerId} AND status = ${status} AND start_at > app_now()
    ORDER BY start_at`;
}

// ── Check 1: referenced OPEN slot doesn't break the save ──────────────────────
async function check1() {
  const iv = await mkInterviewer();
  await saveAvailability(iv, everyDay("10:00", "12:00"), undefined);
  const open = await futureSlots(iv, "OPEN");
  if (!open.length) {
    check("setup", false, "no OPEN slots were created for 10:00–12:00 (season grid?)");
    return;
  }
  // A student booked this slot and cancelled: the slot is OPEN again but the
  // cancelled booking still points at it.
  const target = open[0];
  const s = await mkStudentJourney();
  await sql`
    INSERT INTO bookings (journey_id, student_id, slot_id, interviewer_id, start_at, status, booking_code)
    VALUES (${s.journeyId}, ${s.studentId}, ${target.id}, ${iv}, ${target.start_at}, 'CANCELLED', 'ATEST1')`;

  let err: unknown = null;
  try {
    await saveAvailability(iv, everyDay("14:00", "16:00"), undefined);
  } catch (e) {
    err = e;
  }
  check("save with a referenced OPEN slot", err === null, err ? `threw ${String((err as Error).message ?? err)}` : "saved");

  const row = (await sql<{ status: string }[]>`SELECT status FROM interview_slots WHERE id = ${target.id}`)[0];
  check("referenced slot retired", row?.status === "CANCELLED", `status=${row?.status ?? "deleted"}`);
  const stray = (await futureSlots(iv, "OPEN")).filter((x) => DateTime.fromJSDate(x.start_at).setZone(IST).hour < 12);
  check("old hours gone", stray.length === 0, `${stray.length} OPEN slots left before 12:00`);

  // Back to the old hours: the retired slot's time is generated again.
  await saveAvailability(iv, everyDay("10:00", "12:00"), undefined);
  const again = (await futureSlots(iv, "OPEN")).some((x) => x.start_at.getTime() === target.start_at.getTime());
  check("retired time regenerated", again, again ? "new OPEN slot at the same time" : "no OPEN slot at that time");
}

// ── Check 2: concurrent saves + materialiser runs stay consistent ─────────────
async function check2() {
  const iv = await mkInterviewer();
  const hours: [string, string][] = [
    ["09:00", "11:00"],
    ["13:00", "15:00"],
    ["17:00", "19:00"],
  ];
  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < 12; i++) {
    const [a, b] = hours[i % hours.length];
    ops.push(saveAvailability(iv, everyDay(a, b), undefined));
    ops.push(materializeSlots({ interviewerId: iv }));
  }
  const results = await Promise.allSettled(ops);
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  check(
    "24 concurrent saves / materialiser runs",
    failed.length === 0,
    failed.length ? `${failed.length} failed: ${[...new Set(failed.map((f) => String(f.reason?.code ?? f.reason?.message ?? f.reason)))].join(", ")}` : "all succeeded"
  );

  const cfg = await getAvailabilityConfig();
  const grid = cfg.grid ?? DEFAULT_GRID;
  const rules = await sql<{ s: string; e: string }[]>`
    SELECT DISTINCT to_char(start_local, 'HH24:MI') s, to_char(end_local, 'HH24:MI') e
    FROM availability_rules WHERE interviewer_id = ${iv}`;
  const windows: TimeRange[] = rules.map((r) => ({ startLocal: r.s, endLocal: r.e }));
  check("one set of hours saved", rules.length === 1, `${rules.length} distinct ranges in availability_rules`);
  const open = await futureSlots(iv, "OPEN");
  const outside = open.filter((x) => {
    const dt = DateTime.fromJSDate(x.start_at).setZone(IST);
    return !fitsInWindows(dt.hour * 60 + dt.minute, windows, grid);
  });
  check("no OPEN slot outside the saved hours", outside.length === 0, `${open.length} OPEN, ${outside.length} outside`);
  const more = await materializeSlots({ interviewerId: iv });
  check("nothing left to materialise", more === 0, `materializeSlots created ${more}`);
}

async function cleanup() {
  const like = MARK + "%";
  const testStudents = sql`SELECT id FROM students WHERE user_id IN (SELECT id FROM users WHERE sso_subject LIKE ${like})`;
  const testInterviewers = sql`SELECT id FROM interviewers WHERE user_id IN (SELECT id FROM users WHERE sso_subject LIKE ${like})`;
  await sql`DELETE FROM bookings WHERE student_id IN (${testStudents}) OR interviewer_id IN (${testInterviewers})`;
  // users → students / interviewers → journeys / slots / availability cascade.
  await sql`DELETE FROM users WHERE sso_subject LIKE ${like}`;
}

async function main() {
  console.log("Availability save harness (PostgreSQL)\n");
  await cleanup(); // clear any residue from a prior run
  try {
    await check1();
    await check2();
  } finally {
    await cleanup();
  }
  console.log(`\n${pass} passed, ${fail} failed.`);
  await sql.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Harness error:", e);
  await cleanup().catch(() => {});
  await sql.end();
  process.exit(1);
});
