/**
 * Rules harness: checks the spec rules added in the gap-close pass against the real
 * database. Like the concurrency harness it builds isolated fixtures (sso_subject
 * prefix RTEST-), never moves the simulated clock (times are relative to app_now()),
 * and cleans up after itself.
 *
 *   npm run test:rules
 */
import { sql } from "@/db";
import { ApiError } from "@/lib/errors";
import { approveRequest, declineRequest, createStaffRequest } from "@/services/approvals";

export const MARK = "RTEST-";
let seq = 0;
export const uid = () => `${MARK}${Date.now()}-${seq++}`;

let pass = 0;
let fail = 0;
export function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

export async function expectError(name: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, `expected ${code}, got success`);
  } catch (e) {
    const got = e instanceof ApiError ? e.code : String(e);
    check(name, got === code, `got ${got}`);
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

export interface Ctx {
  season: string;
  badge: { id: string; track_id: string; level: number };
  badge2: { id: string; track_id: string; level: number } | null;
  adminA: string;
  adminB: string;
  team: string;
  iv: { id: string; userId: string };
  iv2: { id: string; userId: string };
}

export async function now(): Promise<Date> {
  return (await sql<{ n: Date }[]>`SELECT app_now() n`)[0].n;
}

async function mkUser(name: string, roles: string[]) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (sso_subject, display_name) VALUES (${uid()}, ${name}) RETURNING id`;
  for (const r of roles) await sql`INSERT INTO user_roles (user_id, role) VALUES (${u.id}, ${r})`;
  return u.id;
}

export async function mkInterviewer(trackId: string) {
  const userId = await mkUser("RTEST Interviewer", ["INTERVIEWER"]);
  const [iv] = await sql<{ id: string }[]>`INSERT INTO interviewers (user_id, display_name) VALUES (${userId}, 'RTEST IV') RETURNING id`;
  await sql`INSERT INTO interviewer_tracks (interviewer_id, track_id, max_badge_level) VALUES (${iv.id}, ${trackId}, 3)`;
  return { id: iv.id, userId };
}

export async function setup(): Promise<Ctx> {
  const season = (await sql<{ id: string }[]>`SELECT id FROM seasons LIMIT 1`)[0].id;
  const badges = await sql<{ id: string; track_id: string; level: number }[]>`
    SELECT b.id, b.track_id, b.level FROM badges b JOIN tracks t ON t.id = b.track_id
    WHERE t.code = 'ai-product' ORDER BY b.level`;
  const badge = badges[0];
  const badge2 = badges[1] ?? null;
  const adminA = await mkUser("RTEST Admin A", ["PROGRAM_ADMIN"]);
  const adminB = await mkUser("RTEST Admin B", ["PROGRAM_ADMIN"]);
  const team = await mkUser("RTEST Team", ["INTERVIEW_ADMIN"]);
  const iv = await mkInterviewer(badge.track_id);
  const iv2 = await mkInterviewer(badge.track_id);
  return { season, badge, badge2, adminA, adminB, team, iv, iv2 };
}

export async function mkStudent(c: Ctx, state: string, extra: Record<string, unknown> = {}, badgeId = c.badge.id) {
  const userId = await mkUser("RTEST Student", ["STUDENT"]);
  const [st] = await sql<{ id: string }[]>`
    INSERT INTO students (user_id, grit_id, base_miles) VALUES (${userId}, ${uid()}, 0) RETURNING id`;
  const reqs = await sql<{ skill_id: string; min_level: number }[]>`
    SELECT skill_id, min_level FROM badge_skill_requirements WHERE badge_id = ${badgeId}`;
  for (const r of reqs) {
    await sql`INSERT INTO student_skill_levels (student_id, skill_id, level, source_seq) VALUES (${st.id}, ${r.skill_id}, ${r.min_level}, 1)`;
  }
  const [j] = await sql<{ id: string }[]>`
    INSERT INTO interview_journeys ${sql({ student_id: st.id, badge_id: badgeId, season_id: c.season, state, state_reason: "rtest", ...extra })}
    RETURNING id`;
  return { userId, studentId: st.id, journeyId: j.id };
}

/** A booking at `start` (minutes from app_now) with its slot, in the given status. */
export async function mkBooking(
  c: Ctx,
  s: { studentId: string; journeyId: string },
  minutesFromNow: number,
  status = "CONFIRMED",
  extra: Record<string, unknown> = {},
  ivIn?: { id: string; userId: string }
) {
  // A fresh interviewer per booking unless one is given, so fixture slots never overlap.
  const iv = ivIn ?? (await mkInterviewer(c.badge.track_id));
  const n = await now();
  const start = new Date(Math.floor((n.getTime() + minutesFromNow * 60000) / 60000) * 60000);
  const [slot] = await sql<{ id: string }[]>`
    INSERT INTO interview_slots (interviewer_id, start_at, buffer_end_at, status, audience, bookable_from)
    VALUES (${iv.id}, ${start}, ${new Date(start.getTime() + 40 * 60000)}, 'BOOKED', 'ANY', ${new Date(n.getTime() - 30 * 86400000)})
    RETURNING id`;
  const [bk] = await sql<{ id: string }[]>`
    INSERT INTO bookings ${sql({
      journey_id: s.journeyId,
      student_id: s.studentId,
      slot_id: slot.id,
      interviewer_id: iv.id,
      start_at: start,
      status,
      booking_code: uid().slice(-6),
      ...extra,
    })} RETURNING id`;
  return { bookingId: bk.id, slotId: slot.id, start };
}

export async function journey(id: string) {
  return (await sql<{ state: string; attempt_count: number; max_attempts: number; cooldown_until: Date | null; priority_rebook: boolean; deadline_protected_until: Date | null; retake_approval_pending: boolean; drop_used: boolean; hold_prev_state: string | null; consecutive_retake_later: number }[]>`
    SELECT * FROM interview_journeys WHERE id = ${id}`)[0];
}

export async function booking(id: string) {
  return (await sql<{ status: string; void_reason: string | null; interviewer_id: string; slot_id: string; absent_reported_at: Date | null }[]>`
    SELECT * FROM bookings WHERE id = ${id}`)[0];
}

async function fileApproval(c: Ctx, action: string, o: { journeyId?: string; payload?: Record<string, string>; requestedBy?: string; interviewerId?: string }) {
  const [a] = await sql<{ id: string }[]>`
    INSERT INTO approvals (action, requested_by, journey_id, interviewer_id, payload, reason)
    VALUES (${action}, ${o.requestedBy ?? c.team}, ${o.journeyId ?? null}, ${o.interviewerId ?? null}, ${sql.json(o.payload ?? {})}, 'rtest')
    RETURNING id`;
  return a.id;
}

// ── phase 2: approvals take effect ─────────────────────────────────────────

async function phase2(c: Ctx) {
  console.log("\nApprovals take effect");

  // Emergency waiver on an upcoming booking: void, slot back to OPEN, no attempt.
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, 6 * 60);
    const id = await fileApproval(c, "EMERGENCY_WAIVER", { journeyId: s.journeyId, payload: { bookingId: b.bookingId }, requestedBy: s.userId });
    await expectError("waiver: requester can't approve own request", "SELF_APPROVAL", () => approveRequest(id, s.userId));
    await approveRequest(id, c.adminA);
    const j = await journey(s.journeyId);
    const bk = await booking(b.bookingId);
    const slot = (await sql<{ status: string }[]>`SELECT status FROM interview_slots WHERE id = ${b.slotId}`)[0];
    check("waiver (upcoming): booking voided", bk.status === "VOID" && bk.void_reason === "EMERGENCY", bk.status);
    check("waiver (upcoming): journey ELIGIBLE, no attempt used", j.state === "ELIGIBLE" && j.attempt_count === 0, `${j.state}/${j.attempt_count}`);
    check("waiver (upcoming): seat back in the pool", slot.status === "OPEN", slot.status);
  }

  // Emergency waiver after a no-show: refund the attempt, clear the wait.
  {
    const s = await mkStudent(c, "NO_SHOW", { attempt_count: 1, cooldown_until: new Date(Date.now() + 5 * 86400000) });
    const b = await mkBooking(c, s, -24 * 60, "NO_SHOW");
    const id = await fileApproval(c, "EMERGENCY_WAIVER", { journeyId: s.journeyId, payload: { bookingId: b.bookingId }, requestedBy: s.userId });
    await approveRequest(id, c.adminA);
    const j = await journey(s.journeyId);
    check("waiver (missed): journey ELIGIBLE, attempt refunded", j.state === "ELIGIBLE" && j.attempt_count === 0 && j.cooldown_until === null, `${j.state}/${j.attempt_count}`);
  }

  // Cooldown override.
  {
    const s = await mkStudent(c, "FAILED", { attempt_count: 1, cooldown_until: new Date(Date.now() + 10 * 86400000) });
    const { id } = await createStaffRequest({ kind: "COOLDOWN_OVERRIDE", journeyId: s.journeyId, requestedBy: c.team, reason: "Documented medical emergency" });
    await expectError("duplicate pending request refused", "ALREADY_REQUESTED", () =>
      createStaffRequest({ kind: "COOLDOWN_OVERRIDE", journeyId: s.journeyId, requestedBy: c.team, reason: "Documented medical emergency" })
    );
    await approveRequest(id, c.adminA);
    const j = await journey(s.journeyId);
    check("cooldown override: ELIGIBLE now", j.state === "ELIGIBLE" && j.cooldown_until === null, j.state);
  }

  // Extra attempt on a closed journey.
  {
    const s = await mkStudent(c, "CLOSED", { attempt_count: 3, state_reason: "Attempt limit reached" });
    const { id } = await createStaffRequest({ kind: "REOPEN", journeyId: s.journeyId, requestedBy: c.team, reason: "Outage during attempt 2" });
    await approveRequest(id, c.adminB);
    const j = await journey(s.journeyId);
    check("extra attempt: reopened with 4 max", j.state === "ELIGIBLE" && j.max_attempts === 4, `${j.state}/${j.max_attempts}`);
  }

  // Result change Fail -> Pass awards the badge and refunds the attempt.
  {
    const s = await mkStudent(c, "FAILED", { attempt_count: 1, cooldown_until: new Date(Date.now() + 10 * 86400000) });
    const b = await mkBooking(c, s, -48 * 60, "COMPLETED");
    await sql`INSERT INTO interview_outcomes (booking_id, result, suggested_result, review_status, locked_at, publish_at)
              VALUES (${b.bookingId}, 'FAIL', 'FAIL', 'RELEASED', app_now(), app_now())`;
    const { id } = await createStaffRequest({ kind: "RESULT_AMENDMENT", journeyId: s.journeyId, requestedBy: c.team, reason: "Wrong rubric row", newResult: "PASS" });
    await approveRequest(id, c.adminA);
    const j = await journey(s.journeyId);
    const badge = await sql`SELECT 1 FROM student_badges WHERE student_id = ${s.studentId} AND status = 'ACTIVE'`;
    check("result change to Pass: PASSED, attempt refunded", j.state === "PASSED" && j.attempt_count === 0, `${j.state}/${j.attempt_count}`);
    check("result change to Pass: badge awarded", badge.length === 1);
  }

  // Declined request changes nothing.
  {
    const s = await mkStudent(c, "FAILED", { attempt_count: 1, cooldown_until: new Date(Date.now() + 10 * 86400000) });
    const { id } = await createStaffRequest({ kind: "COOLDOWN_OVERRIDE", journeyId: s.journeyId, requestedBy: c.team, reason: "Asked by the student" });
    await declineRequest(id, c.adminA, "No documents");
    const j = await journey(s.journeyId);
    const a = (await sql<{ status: string }[]>`SELECT status FROM approvals WHERE id = ${id}`)[0];
    check("decline: request REJECTED, journey unchanged", a.status === "REJECTED" && j.state === "FAILED", `${a.status}/${j.state}`);
  }
}

// ── cleanup + main ─────────────────────────────────────────────────────────

export async function cleanup() {
  const like = MARK + "%";
  await sql`ALTER TABLE journey_events DISABLE TRIGGER trg_journey_events_append_only`;
  try {
    const testUsers = sql`SELECT id FROM users WHERE sso_subject LIKE ${like}`;
    const testStudents = sql`SELECT id FROM students WHERE user_id IN (${testUsers})`;
    const testJourneys = sql`SELECT id FROM interview_journeys WHERE student_id IN (${testStudents})`;
    const testIvs = sql`SELECT id FROM interviewers WHERE user_id IN (${testUsers})`;
    await sql`DELETE FROM journey_events WHERE journey_id IN (${testJourneys}) OR actor_user_id IN (${testUsers})`;
    await sql`DELETE FROM approvals WHERE journey_id IN (${testJourneys}) OR requested_by IN (${testUsers}) OR approved_by IN (${testUsers}) OR interviewer_id IN (${testIvs})`;
    await sql`DELETE FROM student_badges WHERE student_id IN (${testStudents})`;
    await sql`DELETE FROM integrity_cases WHERE subject_student_id IN (${testStudents}) OR opened_by IN (${testUsers})`;
    await sql`DELETE FROM notifications WHERE student_id IN (${testStudents}) OR user_id IN (${testUsers})
      OR payload->>'bookingId' IN (SELECT id::text FROM bookings WHERE student_id IN (${testStudents}))
      OR payload->>'caseId' IN (SELECT id::text FROM integrity_cases WHERE subject_student_id IN (${testStudents}))`;
    await sql`DELETE FROM bookings WHERE student_id IN (${testStudents}) OR interviewer_id IN (${testIvs})`;
    await sql`DELETE FROM interview_slots WHERE interviewer_id IN (${testIvs})`;
    await sql`DELETE FROM users WHERE sso_subject LIKE ${like}`;
  } finally {
    await sql`ALTER TABLE journey_events ENABLE TRIGGER trg_journey_events_append_only`;
  }
}

export type Phase = (c: Ctx) => Promise<void>;
const PHASES: Phase[] = [phase2];

async function main() {
  console.log("Rules harness (PostgreSQL)");
  await cleanup();
  const extra = (await import("./phases")).PHASES as Phase[];
  try {
    const c = await setup();
    for (const p of [...PHASES, ...extra]) await p(c);
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
