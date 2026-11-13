/**
 * No-double-booking harness — reproduces the design doc's QA checks against the
 * real PostgreSQL database (Section 3). Creates isolated test data (sso_subject
 * prefix CTEST-), runs real concurrent requests, asserts, then cleans up.
 *
 *   npm run test:concurrency
 */
import { sql } from "@/db";
import { bookInterview } from "@/services/booking";
import { ApiError } from "@/lib/errors";

const MARK = "CTEST-";
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

async function ids() {
  const season = (await sql<{ id: string }[]>`SELECT id FROM seasons LIMIT 1`)[0].id;
  const badges = await sql<{ id: string; track_id: string; code: string }[]>`
    SELECT b.id, b.track_id, t.code FROM badges b JOIN tracks t ON t.id = b.track_id WHERE b.level = 1`;
  return { season, novices: badges };
}

async function mkInterviewer(trackIds: string[]) {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (sso_subject, display_name) VALUES (${uid()}, 'CTEST Interviewer') RETURNING id`;
  await sql`INSERT INTO user_roles (user_id, role) VALUES (${u.id}, 'INTERVIEWER')`;
  const [iv] = await sql<{ id: string }[]>`
    INSERT INTO interviewers (user_id, display_name) VALUES (${u.id}, 'CTEST IV') RETURNING id`;
  for (const t of trackIds) {
    await sql`INSERT INTO interviewer_tracks (interviewer_id, track_id, max_badge_level) VALUES (${iv.id}, ${t}, 2)`;
  }
  return iv.id;
}

async function mkSlot(interviewerId: string, startIso: string) {
  const start = new Date(startIso);
  const [s] = await sql<{ id: string }[]>`
    INSERT INTO interview_slots (interviewer_id, start_at, buffer_end_at, status, audience, bookable_from)
    VALUES (${interviewerId}, ${start}, ${new Date(start.getTime() + 40 * 60000)}, 'OPEN', 'ANY', ${new Date("2026-11-01T00:00:00+05:30")})
    RETURNING id`;
  return s.id;
}

async function mkStudent(badgeId: string, seasonId: string) {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (sso_subject, display_name) VALUES (${uid()}, 'CTEST Student') RETURNING id`;
  await sql`INSERT INTO user_roles (user_id, role) VALUES (${u.id}, 'STUDENT')`;
  const [st] = await sql<{ id: string }[]>`
    INSERT INTO students (user_id, grit_id, base_miles) VALUES (${u.id}, ${uid()}, 0) RETURNING id`;
  // clear all skills this badge requires
  const reqs = await sql<{ skill_id: string; min_level: number }[]>`
    SELECT skill_id, min_level FROM badge_skill_requirements WHERE badge_id = ${badgeId}`;
  for (const r of reqs) {
    await sql`INSERT INTO student_skill_levels (student_id, skill_id, level, source_seq)
              VALUES (${st.id}, ${r.skill_id}, ${r.min_level}, 1)`;
  }
  const [j] = await sql<{ id: string }[]>`
    INSERT INTO interview_journeys (student_id, badge_id, season_id, state, state_reason)
    VALUES (${st.id}, ${badgeId}, ${seasonId}, 'ELIGIBLE', 'ready') RETURNING id`;
  return { userId: u.id, studentId: st.id, journeyId: j.id };
}

/**
 * A start time relative to the simulated clock (so the harness works whatever the demo
 * clock says): `days` ahead, at an off-grid minute (:07) no materialised slot uses.
 */
async function testTime(days: number, hourOffset = 0): Promise<string> {
  const now = (await sql<{ n: Date }[]>`SELECT app_now() n`)[0].n;
  const t = new Date(now.getTime() + days * 86_400_000);
  t.setUTCMinutes(7, 0, 0);
  t.setUTCHours(t.getUTCHours() + hourOffset);
  return t.toISOString();
}

function classify(results: PromiseSettledResult<unknown>[]) {
  let ok = 0;
  const errs: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "fulfilled") ok++;
    else {
      const code = r.reason instanceof ApiError ? r.reason.code : (r.reason?.code ?? "OTHER");
      errs[code] = (errs[code] ?? 0) + 1;
    }
  }
  return { ok, errs };
}

// ── Check 1: 50 students, one slot → exactly 1 booking, 49 SLOT_TAKEN ─────────
async function check1(seasonId: string, apNovice: { id: string }) {
  const trackId = (await sql<{ track_id: string }[]>`SELECT track_id FROM badges WHERE id=${apNovice.id}`)[0].track_id;
  const ivId = await mkInterviewer([trackId]);
  const startIso = await testTime(5); // off the slot grid → only this slot exists at that time
  await mkSlot(ivId, startIso);
  const students = await Promise.all(Array.from({ length: 50 }, () => mkStudent(apNovice.id, seasonId)));
  const results = await Promise.allSettled(
    students.map((s) =>
      bookInterview({ userId: s.userId, studentId: s.studentId, journeyId: s.journeyId, startAtIso: startIso, idempotencyKey: uid() })
    )
  );
  const { ok, errs } = classify(results);
  check("50 students / 1 slot", ok === 1 && (errs.SLOT_TAKEN ?? 0) === 49, `${ok} booked, SLOT_TAKEN=${errs.SLOT_TAKEN ?? 0}, other=${JSON.stringify(errs)}`);
}

// ── Check 2: one student, 50 attempts across 4 badges → exactly 1 booking ─────
async function check2(seasonId: string, novices: { id: string; track_id: string }[]) {
  const iv = await mkInterviewer(novices.map((n) => n.track_id));
  // one student, one journey per badge, all eligible
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (sso_subject, display_name) VALUES (${uid()}, 'CTEST Multi') RETURNING id`;
  await sql`INSERT INTO user_roles (user_id, role) VALUES (${u.id}, 'STUDENT')`;
  const [st] = await sql<{ id: string }[]>`INSERT INTO students (user_id, grit_id, base_miles) VALUES (${u.id}, ${uid()}, 0) RETURNING id`;
  const journeys: { journeyId: string; startIso: string }[] = [];
  let hour = 0;
  for (const n of novices) {
    const reqs = await sql<{ skill_id: string; min_level: number }[]>`SELECT skill_id, min_level FROM badge_skill_requirements WHERE badge_id=${n.id}`;
    for (const r of reqs) {
      await sql`INSERT INTO student_skill_levels (student_id, skill_id, level, source_seq) VALUES (${st.id}, ${r.skill_id}, ${r.min_level}, 1)
                ON CONFLICT (student_id, skill_id) DO UPDATE SET level = GREATEST(student_skill_levels.level, EXCLUDED.level)`;
    }
    const startIso = await testTime(6, hour);
    hour += 1;
    await mkSlot(iv, startIso);
    const [j] = await sql<{ id: string }[]>`INSERT INTO interview_journeys (student_id, badge_id, season_id, state, state_reason) VALUES (${st.id}, ${n.id}, ${seasonId}, 'ELIGIBLE', 'ready') RETURNING id`;
    journeys.push({ journeyId: j.id, startIso });
  }
  // 50 attempts spread across the 4 journeys, each a distinct idempotency key
  const attempts = Array.from({ length: 50 }, (_, i) => journeys[i % journeys.length]);
  const results = await Promise.allSettled(
    attempts.map((a) => bookInterview({ userId: u.id, studentId: st.id, journeyId: a.journeyId, startAtIso: a.startIso, idempotencyKey: uid() }))
  );
  const { ok, errs } = classify(results);
  check("1 student / 50 attempts / 4 badges", ok === 1, `${ok} booked (expect 1), errs=${JSON.stringify(errs)}`);
}

// ── Check 3: 50 overlapping slot inserts for one interviewer → 1 survives ─────
async function check3(novices: { track_id: string }[]) {
  const iv = await mkInterviewer([novices[0].track_id]);
  const start = new Date("2026-12-22T15:00:00+05:30");
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, () =>
      sql`INSERT INTO interview_slots (interviewer_id, start_at, buffer_end_at, status, audience, bookable_from)
          VALUES (${iv}, ${start}, ${new Date(start.getTime() + 40 * 60000)}, 'OPEN', 'ANY', ${new Date("2026-11-01T00:00:00+05:30")})`
    )
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const live = (await sql<{ n: number }[]>`SELECT count(*)::int n FROM interview_slots WHERE interviewer_id=${iv} AND start_at=${start} AND status<>'CANCELLED'`)[0].n;
  check("50 overlapping slots / 1 interviewer", ok === 1 && live === 1, `inserts ok=${ok}, surviving rows=${live}`);
}

async function cleanup() {
  const like = MARK + "%";
  await sql`ALTER TABLE journey_events DISABLE TRIGGER trg_journey_events_append_only`;
  try {
    await sql`
      DELETE FROM journey_events
      WHERE actor_user_id IN (SELECT id FROM users WHERE sso_subject LIKE ${like})
         OR journey_id IN (
           SELECT j.id FROM interview_journeys j
           JOIN students s ON s.id = j.student_id
           JOIN users u ON u.id = s.user_id
           WHERE u.sso_subject LIKE ${like}
         )`;
    const testStudents = sql`SELECT id FROM students WHERE user_id IN (SELECT id FROM users WHERE sso_subject LIKE ${like})`;
    await sql`DELETE FROM notifications WHERE student_id IN (${testStudents})`;
    await sql`DELETE FROM bookings WHERE student_id IN (${testStudents})`;
    await sql`DELETE FROM users WHERE sso_subject LIKE ${like}`;
  } finally {
    await sql`ALTER TABLE journey_events ENABLE TRIGGER trg_journey_events_append_only`;
  }
}

async function main() {
  console.log("No-double-booking harness (PostgreSQL)\n");
  await cleanup(); // clear any residue from a prior run
  const { season, novices } = await ids();
  const apNovice = novices.find((n) => n.code === "ai-product")!;
  try {
    await check1(season, apNovice);
    await check2(season, novices);
    await check3(novices);
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
