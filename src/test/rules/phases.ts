/** Later phases of the rules harness (see run.ts). */
import { sql } from "@/db";
import { runTick, decemberPools } from "@/services/jobs";
import { releaseInterview } from "@/services/interviewerBooking";
import { voidBooking } from "@/services/reassign";
import { submitOutcome, rubricSkills } from "@/services/interviewerView";
import { approveRequest, declineRequest, createStaffRequest } from "@/services/approvals";
import { holdCase, dismissCase, confirmCase } from "@/services/integrity";
import { reportEmergency, reportInterviewerAbsent } from "@/services/bookingReports";
import { studentJoin } from "@/services/join";
import { bookInterview } from "@/services/booking";
import { syncSkills } from "@/services/skillSync";
import { getStudentDashboard } from "@/services/studentView";
import { transitionJourney } from "@/services/journeys";
import { check, expectError, mkInterviewer, mkStudent, mkBooking, journey, booking, now, type Ctx, type Phase } from "./run";

async function openSlot(interviewerId: string, start: Date) {
  await sql`
    INSERT INTO interview_slots (interviewer_id, start_at, buffer_end_at, status, audience, bookable_from)
    VALUES (${interviewerId}, ${start}, ${new Date(start.getTime() + 40 * 60000)}, 'OPEN', 'ANY', ${new Date(start.getTime() - 30 * 86400000)})`;
}

// ── phase 3: interviewer no-show, release, void ─────────────────────────────

async function phase3(c: Ctx) {
  console.log("\nInterviewer no-show, swaps and voids");

  // T+15, student joined, interviewer never did: called off with priority, no attempt.
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, -20, "CONFIRMED", { student_joined_at: new Date(Date.now() - 1) });
    await sql`UPDATE bookings SET student_joined_at = start_at WHERE id = ${b.bookingId}`;
    await runTick();
    const j = await journey(s.journeyId);
    const bk = await booking(b.bookingId);
    check("absent interviewer at T+15: booking VOID", bk.status === "VOID" && bk.void_reason === "INTERVIEWER", `${bk.status}/${bk.void_reason}`);
    check("absent interviewer at T+15: ELIGIBLE + priority, no attempt", j.state === "ELIGIBLE" && j.priority_rebook && j.attempt_count === 0, `${j.state}/${j.priority_rebook}/${j.attempt_count}`);
  }

  // T+15, interviewer joined, student didn't: still a no-show.
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, -20);
    await sql`UPDATE bookings SET interviewer_joined_at = start_at WHERE id = ${b.bookingId}`;
    await runTick();
    const j = await journey(s.journeyId);
    const bk = await booking(b.bookingId);
    // (After the deadline the sweep may then close the journey; the attempt still counts.)
    check("student absent, interviewer present: NO_SHOW", bk.status === "NO_SHOW" && j.attempt_count === 1, `${bk.status}/${j.state}/${j.attempt_count}`);
  }

  // Student reports the interviewer missing; someone free at the same time is swapped in.
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, -7, "CONFIRMED", {}, c.iv);
    await sql`UPDATE bookings SET student_joined_at = start_at WHERE id = ${b.bookingId}`;
    await openSlot(c.iv2.id, b.start);
    const r = await reportInterviewerAbsent({ bookingId: b.bookingId, studentId: s.studentId });
    const bk = await booking(b.bookingId);
    check("absent report: swapped to a free interviewer", r.swapped && bk.interviewer_id === c.iv2.id && !!bk.absent_reported_at, `swapped=${r.swapped}`);
    await sql`UPDATE interview_slots SET status = 'CANCELLED' WHERE id = ${bk.slot_id}`; // tidy for later swaps
  }

  // "I can't take this": >= 24 h with someone free -> swapped; nobody free -> called off; < 24 h -> team.
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, 3 * 24 * 60, "CONFIRMED", {}, c.iv);
    await openSlot(c.iv2.id, b.start);
    const r = await releaseInterview({ bookingId: b.bookingId, interviewerId: c.iv.id, userId: c.iv.userId, reason: "Exam duty that evening" });
    const bk = await booking(b.bookingId);
    check("can't take (>= 24 h, someone free): swapped", r === "SWAPPED" && bk.interviewer_id === c.iv2.id, r);
  }
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, 4 * 24 * 60, "CONFIRMED", {}, c.iv);
    const r = await releaseInterview({ bookingId: b.bookingId, interviewerId: c.iv.id, userId: c.iv.userId, reason: "Exam duty that evening" });
    const j = await journey(s.journeyId);
    check("can't take (>= 24 h, nobody free): called off, priority rebook", r === "CALLED_OFF" && j.state === "ELIGIBLE" && j.priority_rebook, `${r}/${j.state}`);
  }
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, 6 * 60, "CONFIRMED", {}, c.iv);
    const r = await releaseInterview({ bookingId: b.bookingId, interviewerId: c.iv.id, userId: c.iv.userId, reason: "Feeling unwell today" });
    const bk = await booking(b.bookingId);
    check("can't take (< 24 h): sent to the team, still booked", r === "SENT_TO_TEAM" && bk.status === "CONFIRMED", r);
  }

  // Void on the last two days before the deadline protects the student for 10 days.
  {
    const deadline = (await sql<{ d: Date }[]>`SELECT deadline_at d FROM seasons LIMIT 1`)[0].d;
    const n = await now();
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, Math.round((deadline.getTime() - 3 * 3600000 - n.getTime()) / 60000));
    await sql.begin((tx) => voidBooking(tx, b.bookingId, { fault: "PLATFORM", reason: "Platform outage", actorUserId: c.adminA }));
    const j = await journey(s.journeyId);
    const want = deadline.getTime() + 10 * 86400000;
    check("void on 31 Dec: protected to deadline + 10 days", j.deadline_protected_until?.getTime() === want, String(j.deadline_protected_until?.toISOString()));
  }

  // Void refused once an outcome exists.
  {
    const s = await mkStudent(c, "AWAITING_RESULT");
    const b = await mkBooking(c, s, -60, "COMPLETED");
    await sql`INSERT INTO interview_outcomes (booking_id, result, review_status, publish_at) VALUES (${b.bookingId}, 'PASS', 'NONE', app_now() + interval '1 hour')`;
    await expectError("void refused when an outcome exists", "OUTCOME_EXISTS", () =>
      sql.begin((tx) => voidBooking(tx, b.bookingId, { fault: "PLATFORM", reason: "Platform outage", actorUserId: c.adminA }))
    );
  }
}

// ── phase 4: December pools ─────────────────────────────────────────────────

async function phase4(c: Ctx) {
  console.log("\nDecember seat pools");
  // A synthetic "December" far enough ahead that no demo slots exist in it.
  const n = await now();
  const day = new Date(n.getTime() + 90 * 86400000);
  day.setUTCHours(2, 0, 0, 0); // 7:30 AM IST
  const iv = await mkInterviewer(c.badge.track_id);
  for (let i = 0; i < 20; i++) await openSlot(iv.id, new Date(day.getTime() + i * 40 * 60000));
  const range = { from: new Date(day.getTime() - 3600000), to: new Date(day.getTime() + 20 * 3600000) };
  await decemberPools(range);
  const mix = await sql<{ audience: string; n: number }[]>`
    SELECT audience, count(*)::int n FROM interview_slots WHERE interviewer_id = ${iv.id} GROUP BY audience`;
  const by = Object.fromEntries(mix.map((m) => [m.audience, m.n]));
  check("20 seats split 14 deadline / 4 priority / 2 open", by.DEADLINE === 14 && by.PRIORITY === 4 && by.ANY === 2, JSON.stringify(by));
  const again = await decemberPools(range);
  check("re-running changes nothing", again.affected === 0, String(again.affected));
}

// ── phase 5: outcome controls (+ review fixes) ─────────────────────────────

async function outcomeFixture(c: Ctx) {
  const s = await mkStudent(c, "BOOKED");
  const iv = await mkInterviewer(c.badge.track_id);
  const b = await mkBooking(c, s, -40, "CONFIRMED", {}, iv);
  await sql`UPDATE bookings SET student_joined_at = start_at, code_verified_at = start_at WHERE id = ${b.bookingId}`;
  const skills = await rubricSkills(sql, c.badge.id);
  return { s, b, skills, iv };
}

const FB = "You explained your approach clearly and tested the edge cases; keep practising timed problems to build speed further.";

async function phase5(c: Ctx) {
  console.log("\nOutcome controls");
  const ivOf = new Map<string, { id: string; userId: string }>();
  const fixture = async () => {
    const f = await outcomeFixture(c);
    ivOf.set(f.b.bookingId, f.iv);
    return f;
  };
  const base = (bookingId: string, skills: string[], score: number, result: "PASS" | "FAIL" | "RETAKE_LATER") => ({
    interviewerId: ivOf.get(bookingId)!.id,
    userId: ivOf.get(bookingId)!.userId,
    bookingId,
    whatHappened: "COMPLETED" as const,
    result,
    rubric: skills.map((sk) => ({ skill: sk, score })),
    feedback: FB,
    focusAreas: [skills[0]],
    faceMatched: true,
  });

  // Suggestion is Retake later (all 2s); choosing Fail without a reason is refused.
  {
    const f = await fixture();
    await expectError("result differs from suggestion: reason required", "OVERRIDE_REASON_REQUIRED", () =>
      submitOutcome(base(f.b.bookingId, f.skills, 2, "FAIL"))
    );
    const r = await submitOutcome({ ...base(f.b.bookingId, f.skills, 2, "FAIL"), overrideReason: "Could not explain any of the core trade-offs." });
    check("with a reason it saves and publishes normally", !!r.publishAtIso && !r.secondReview);
  }

  // Pass against the suggestion: held for second review, approval filed; approving publishes it.
  {
    const f = await fixture();
    const r = await submitOutcome({ ...base(f.b.bookingId, f.skills, 2, "PASS"), overrideReason: "Strong reasoning the rubric doesn't capture." });
    const o = (await sql<{ id: string; review_status: string; suggested_result: string }[]>`
      SELECT id, review_status, suggested_result FROM interview_outcomes WHERE booking_id = ${f.b.bookingId}`)[0];
    const a = (await sql<{ id: string }[]>`SELECT id FROM approvals WHERE action = 'SECOND_REVIEW' AND payload->>'outcomeId' = ${o.id}`)[0];
    check("Pass against suggestion: held for second review", !!r.secondReview && o.review_status === "PENDING_SECOND_REVIEW" && o.suggested_result === "RETAKE_LATER", o.review_status);
    check("Pass against suggestion: approval filed", !!a);
    await expectError("interviewer can't approve their own Pass", "SELF_APPROVAL", () => approveRequest(a.id, f.iv.userId));
    await approveRequest(a.id, c.adminA);
    const j = await journey(f.s.journeyId);
    check("second review approved: Pass published", j.state === "PASSED", j.state);
  }

  // Declining a second review sends it back to the interviewer with the suggested result
  // and an edit window; a neutral note stands in if they don't add feedback.
  {
    const f = await fixture();
    await submitOutcome({ ...base(f.b.bookingId, f.skills, 2, "PASS"), feedback: "", overrideReason: "Strong reasoning the rubric doesn't capture." });
    const o = (await sql<{ id: string }[]>`SELECT id FROM interview_outcomes WHERE booking_id = ${f.b.bookingId}`)[0];
    const a = (await sql<{ id: string }[]>`SELECT id FROM approvals WHERE action = 'SECOND_REVIEW' AND payload->>'outcomeId' = ${o.id}`)[0];
    await declineRequest(a.id, c.adminA, "Rubric scores don't support a Pass");
    const o2 = (await sql<{ result: string; review_status: string; future: boolean; fb: string | null }[]>`
      SELECT result, review_status, publish_at > app_now() future, feedback_to_student fb FROM interview_outcomes WHERE id = ${o.id}`)[0];
    check("second review declined: back to the interviewer as Retake later", o2.result === "RETAKE_LATER" && o2.review_status === "NONE" && o2.future, `${o2.result}/${o2.review_status}/${o2.future}`);
    check("second review declined: student gets a note even if none was written", (o2.fb ?? "").length >= 80);
  }

  // Integrity concern needs a category, which is copied to the case.
  {
    const f = await fixture();
    await expectError("integrity concern: category required", "CATEGORY_REQUIRED", () =>
      submitOutcome({ ...base(f.b.bookingId, f.skills, 3, "PASS"), integrityFlag: true })
    );
    await submitOutcome({ ...base(f.b.bookingId, f.skills, 3, "PASS"), integrityFlag: true, integrityCategory: "OUTSIDE_HELP" });
    const ic = (await sql<{ category: string | null }[]>`SELECT category FROM integrity_cases WHERE booking_id = ${f.b.bookingId}`)[0];
    check("integrity concern: case carries the category", ic?.category === "OUTSIDE_HELP", String(ic?.category));
  }

  console.log("\nReview fixes");
  // Integrity-closed journey can't be reopened by an extra-attempt approval.
  {
    const s = await mkStudent(c, "CLOSED", { state_reason: "Closed after review" });
    const { id } = await createStaffRequest({ kind: "REOPEN", journeyId: s.journeyId, requestedBy: c.team, reason: "Asked by the student" });
    await expectError("extra attempt refused on an integrity-closed journey", "UNDER_REVIEW", () => approveRequest(id, c.adminA));
  }
  // Waiver for an older missed interview doesn't wipe a later one.
  {
    const s = await mkStudent(c, "NO_SHOW", { attempt_count: 2, cooldown_until: new Date(Date.now() + 5 * 86400000) });
    const older = await mkBooking(c, s, -10 * 24 * 60, "NO_SHOW");
    await mkBooking(c, s, -24 * 60, "NO_SHOW");
    const [a] = await sql<{ id: string }[]>`
      INSERT INTO approvals (action, requested_by, journey_id, payload, reason)
      VALUES ('EMERGENCY_WAIVER', ${s.userId}, ${s.journeyId}, ${sql.json({ bookingId: older.bookingId })}, 'rtest') RETURNING id`;
    await approveRequest(a.id, c.adminA);
    const j = await journey(s.journeyId);
    check("waiver on an older no-show: attempt refunded, later wait kept", j.state === "NO_SHOW" && j.attempt_count === 1 && j.cooldown_until !== null, `${j.state}/${j.attempt_count}`);
  }
}

// ── phase 6: integrity follow-through ──────────────────────────────────────

async function caseFor(c: Ctx, studentId: string) {
  const [ic] = await sql<{ id: string }[]>`
    INSERT INTO integrity_cases (code, subject_type, subject_student_id, status, opened_by, reason)
    VALUES (${"RT-" + Math.random().toString(36).slice(2, 10)}, 'STUDENT', ${studentId}, 'TRIAGE', ${c.adminA}, 'rtest') RETURNING id`;
  return ic.id;
}

async function addJourney(c: Ctx, studentId: string, badgeId: string, state: string) {
  const [j] = await sql<{ id: string }[]>`
    INSERT INTO interview_journeys (student_id, badge_id, season_id, state, state_reason)
    VALUES (${studentId}, ${badgeId}, ${c.season}, ${state}, 'rtest') RETURNING id`;
  return j.id;
}

async function award(studentId: string, badgeId: string) {
  await sql`INSERT INTO student_badges (student_id, badge_id, awarded_at, status, miles) VALUES (${studentId}, ${badgeId}, app_now(), 'ACTIVE', 100)`;
}

async function phase6(c: Ctx) {
  console.log("\nIntegrity follow-through");
  // Hold pauses every holdable journey and freezes badges; dismiss restores both.
  {
    const s = await mkStudent(c, "PASSED");
    await award(s.studentId, c.badge.id);
    const other = c.badge2 ? await addJourney(c, s.studentId, c.badge2.id, "FAILED") : null;
    const caseId = await caseFor(c, s.studentId);
    await expectError("opener can't put their own case on hold", "DECIDER_IS_OPENER", () => holdCase({ caseId, actorUserId: c.adminA }));
    const { held } = await holdCase({ caseId, actorUserId: c.adminB });
    const badge = (await sql<{ status: string }[]>`SELECT status FROM student_badges WHERE student_id = ${s.studentId}`)[0];
    check("hold: journeys on hold, badge under review", held === (other ? 2 : 1) && badge.status === "UNDER_REVIEW", `${held}/${badge.status}`);
    await dismissCase({ caseId, actorUserId: c.adminB, note: "Checked the recording; it was the student." });
    const j1 = await journey(s.journeyId);
    const j2 = other ? await journey(other) : null;
    const badge2 = (await sql<{ status: string }[]>`SELECT status FROM student_badges WHERE student_id = ${s.studentId}`)[0];
    check("dismiss: back to previous states", j1.state === "PASSED" && (!j2 || j2.state === "FAILED"), `${j1.state}/${j2?.state}`);
    check("dismiss: badge active again", badge2.status === "ACTIVE", badge2.status);
  }

  // Two cases: deciding one never touches the other's holds; results wait while a review is open.
  {
    const s1 = await mkStudent(c, "PASSED");
    await award(s1.studentId, c.badge.id);
    const caseA = await caseFor(c, s1.studentId);
    await holdCase({ caseId: caseA, actorUserId: c.adminB });
    // An interview booked before the review went ahead; its result is due now.
    const j2 = c.badge2 ? await addJourney(c, s1.studentId, c.badge2.id, "AWAITING_RESULT") : null;
    if (j2) {
      const b = await mkBooking(c, { studentId: s1.studentId, journeyId: j2 }, -120, "COMPLETED");
      await sql`INSERT INTO interview_outcomes (booking_id, result, review_status, publish_at, submitted_at)
                VALUES (${b.bookingId}, 'PASS', 'NONE', app_now() - interval '1 minute', app_now() - interval '1 hour')`;
      await runTick();
      check("result waits while a review is open", (await journey(j2)).state === "AWAITING_RESULT");
    }
    const caseB = await caseFor(c, s1.studentId);
    await dismissCase({ caseId: caseB, actorUserId: c.adminB, note: "Separate flag, nothing found." });
    const j1 = await journey(s1.journeyId);
    const badge = (await sql<{ status: string }[]>`SELECT status FROM student_badges WHERE student_id = ${s1.studentId} AND badge_id = ${c.badge.id}`)[0];
    check("dismissing case B leaves case A's hold in place", j1.state === "ON_HOLD" && badge.status === "UNDER_REVIEW", `${j1.state}/${badge.status}`);
    await dismissCase({ caseId: caseA, actorUserId: c.adminB, note: "Checked, nothing found." });
    if (j2) check("after the review the held-back result publishes", (await journey(j2)).state === "PASSED");
  }

  // Confirm nullify cascades to a higher badge in the same track.
  if (c.badge2) {
    const s = await mkStudent(c, "PASSED");
    await award(s.studentId, c.badge.id);
    await addJourney(c, s.studentId, c.badge2.id, "PASSED");
    await award(s.studentId, c.badge2.id);
    const caseId = await caseFor(c, s.studentId);
    // Hold only the Novice journey, so the cascade has to reach the higher one on its own.
    await sql.begin(async (tx) => {
      await transitionJourney(tx, { journeyId: s.journeyId, action: "hold", patch: { hold_prev_state: "PASSED" }, lock: true });
      await tx`UPDATE integrity_cases SET status = 'OPEN' WHERE id = ${caseId}`;
    });
    const grit = (await sql<{ grit_id: string }[]>`SELECT grit_id FROM students WHERE id = ${s.studentId}`)[0].grit_id;
    await confirmCase({ caseId, actorUserId: c.adminB, decision: "nullify", note: "Recording shows a different person; confirmed with the campus team today.", confirmId: grit });
    const badges = await sql<{ status: string }[]>`SELECT status FROM student_badges WHERE student_id = ${s.studentId}`;
    check("nullify cascades to the higher badge", badges.length === 2 && badges.every((b) => b.status === "NULLIFIED"), badges.map((b) => b.status).join(","));
  } else {
    check("nullify cascade (skipped: no level-2 badge in the track)", true);
  }
}

// ── phase 7: scheduled jobs ─────────────────────────────────────────────────

async function templates(bookingOrCase: string) {
  return (await sql<{ template: string }[]>`
    SELECT template FROM notifications WHERE payload->>'bookingId' = ${bookingOrCase} OR payload->>'caseId' = ${bookingOrCase}`).map((r) => r.template);
}

async function phase7(c: Ctx) {
  console.log("\nScheduled jobs");
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, 30);
    await runTick();
    await runTick();
    const t = await templates(b.bookingId);
    check("reminder: only the 1 h one, once each for student + interviewer", t.filter((x) => x === "REMINDER_1H").length === 2 && !t.includes("REMINDER_24H"), t.join(","));
  }
  {
    const s = await mkStudent(c, "AWAITING_RESULT");
    const b = await mkBooking(c, s, -4 * 60, "COMPLETED");
    await runTick();
    const t = await templates(b.bookingId);
    check("outcome SLA: 2 h nudge sent, no escalation yet", t.includes("OUTCOME_NUDGE_2H") && !t.includes("OUTCOME_ESCALATED_24H"), t.join(","));
  }
  {
    const s = await mkStudent(c, "AWAITING_RESULT");
    const b = await mkBooking(c, s, -26 * 60, "COMPLETED");
    await sql`INSERT INTO interview_outcomes (booking_id, result, review_status, publish_at, submitted_at)
              VALUES (${b.bookingId}, 'PASS', 'WITHHELD', app_now() - interval '25 hours', app_now() - interval '25 hours')`;
    const [ic] = await sql<{ id: string }[]>`
      INSERT INTO integrity_cases (code, subject_type, subject_student_id, status, opened_by, reason, booking_id, created_at)
      VALUES (${"RT-" + Math.random().toString(36).slice(2, 10)}, 'STUDENT', ${s.studentId}, 'TRIAGE', ${c.iv.userId}, 'rtest', ${b.bookingId}, app_now() - interval '25 hours')
      RETURNING id`;
    await runTick();
    const st = (await sql<{ status: string }[]>`SELECT status FROM integrity_cases WHERE id = ${ic.id}`)[0];
    const o = (await sql<{ review_status: string }[]>`SELECT review_status FROM interview_outcomes WHERE booking_id = ${b.bookingId}`)[0];
    check("triage SLA: untriaged flag released at 24 h", st.status === "DISMISSED" && o.review_status === "RELEASED", `${st.status}/${o.review_status}`);
  }
}

// ── phase 9: smaller rules ──────────────────────────────────────────────────

async function phase9(c: Ctx) {
  console.log("\nSmaller rules");
  // 3rd Retake later in a row waits for approval; declining makes it a Fail.
  {
    // Protected so the deadline sweep (the demo clock may be past 31 Dec) leaves it alone.
    const s = await mkStudent(c, "AWAITING_RESULT", { consecutive_retake_later: 2, deadline_protected_until: new Date(Date.now() + 400 * 86400000) });
    const b = await mkBooking(c, s, -3 * 60, "COMPLETED");
    await sql`INSERT INTO interview_outcomes (booking_id, result, review_status, publish_at, submitted_at)
              VALUES (${b.bookingId}, 'RETAKE_LATER', 'NONE', app_now() - interval '1 minute', app_now() - interval '1 hour')`;
    await runTick();
    const j = await journey(s.journeyId);
    const a = (await sql<{ id: string }[]>`SELECT id FROM approvals WHERE action = 'THIRD_RETAKE' AND journey_id = ${s.journeyId}`)[0];
    check("3rd Retake in a row: waits for approval", j.retake_approval_pending && !!a, `${j.state}/${j.retake_approval_pending}`);
    await declineRequest(a.id, c.adminA, "Third retake not justified");
    const j2 = await journey(s.journeyId);
    check("3rd Retake declined: counts as a Fail", j2.state === "FAILED" && j2.attempt_count === 1 && !j2.retake_approval_pending && j2.consecutive_retake_later === 0, `${j2.state}/${j2.attempt_count}`);
  }

  // Dropped call: first is a free Retake later; a later one with 15+ minutes must be recorded with a result.
  {
    const s = await mkStudent(c, "BOOKED");
    const iv = await mkInterviewer(c.badge.track_id);
    const b = await mkBooking(c, s, -25, "CONFIRMED", {}, iv);
    await sql`UPDATE bookings SET student_joined_at = start_at WHERE id = ${b.bookingId}`;
    await submitOutcome({ interviewerId: iv.id, userId: iv.userId, bookingId: b.bookingId, whatHappened: "DROPPED", result: null, rubric: [], internalNotes: "Video dropped at 12 minutes, never came back." });
    const j = await journey(s.journeyId);
    check("first dropped call: free Retake later, no attempt", j.attempt_count === 0 && j.drop_used, `${j.state}/${j.attempt_count}/${j.drop_used}`);

    const s2 = await mkStudent(c, "BOOKED", { drop_used: true });
    const iv2 = await mkInterviewer(c.badge.track_id);
    const b2 = await mkBooking(c, s2, -25, "CONFIRMED", {}, iv2);
    await sql`UPDATE bookings SET student_joined_at = start_at WHERE id = ${b2.bookingId}`;
    await expectError("later drop with 15+ min assessed: record a result", "RECORD_A_RESULT", () =>
      submitOutcome({ interviewerId: iv2.id, userId: iv2.userId, bookingId: b2.bookingId, whatHappened: "DROPPED", result: null, rubric: [], internalNotes: "Dropped at 20 minutes, couldn't resume.", assessed15: true })
    );
  }

  // Emergency limit: 2 per season.
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, 6 * 60);
    for (let i = 0; i < 2; i++) {
      await sql`INSERT INTO approvals (action, status, requested_by, journey_id, payload, reason)
                VALUES ('EMERGENCY_WAIVER', 'APPROVED', ${s.userId}, ${s.journeyId}, '{}'::jsonb, 'rtest')`;
    }
    await expectError("emergency: 3rd report in a season refused", "EMERGENCY_LIMIT", () =>
      reportEmergency({ bookingId: b.bookingId, studentId: s.studentId, userId: s.userId, reason: "A family emergency came up today." })
    );
  }

  // Join needs no typed code: the owner's join marks the booking verified; someone else's is refused.
  {
    const s = await mkStudent(c, "BOOKED");
    const b = await mkBooking(c, s, 5);
    const r = await studentJoin(b.bookingId, s.studentId);
    const v = (await sql<{ ok: boolean }[]>`SELECT (code_verified_at IS NOT NULL AND student_joined_at IS NOT NULL) ok FROM bookings WHERE id = ${b.bookingId}`)[0];
    check("join without typing: joined and verified", r.joined && v.ok);
    const other = await mkStudent(c, "ELIGIBLE");
    await expectError("join someone else's booking refused", "NOT_FOUND", () => studentJoin(b.bookingId, other.studentId));
  }

  // Rejoin until 15 minutes after the scheduled end.
  {
    const s = await mkStudent(c, "AWAITING_RESULT");
    const b = await mkBooking(c, s, -35, "COMPLETED");
    await sql`UPDATE bookings SET student_joined_at = start_at, booking_code = 'RJ1234' WHERE id = ${b.bookingId}`;
    const r = await studentJoin(b.bookingId, s.studentId);
    check("rejoin after a drop, before end + 15", r.joined === true);
    const s2 = await mkStudent(c, "AWAITING_RESULT");
    const b2 = await mkBooking(c, s2, -60, "COMPLETED");
    await sql`UPDATE bookings SET student_joined_at = start_at, booking_code = 'RJ5678' WHERE id = ${b2.bookingId}`;
    await expectError("no rejoin after end + 15", "BOOKING_NOT_ACTIVE", () => studentJoin(b2.bookingId, s2.studentId));
  }

  // "Already booked" names the date.
  {
    const s = await mkStudent(c, "BOOKED");
    await mkBooking(c, s, 3 * 24 * 60);
    const j2 = c.badge2
      ? (await sql<{ id: string }[]>`INSERT INTO interview_journeys (student_id, badge_id, season_id, state) VALUES (${s.studentId}, ${c.badge2.id}, ${c.season}, 'ELIGIBLE') RETURNING id`)[0].id
      : null;
    if (j2) {
      try {
        await bookInterview({ userId: s.userId, studentId: s.studentId, journeyId: j2, startAtIso: new Date(Date.now() + 9 * 86400000).toISOString(), idempotencyKey: "rt-" + Math.random() });
        check("already booked: refused", false);
      } catch (e) {
        const err = e as { code?: string; message?: string };
        check("already booked: message names the date", err.code === "ALREADY_BOOKED" && /You already have an interview on \w{3} \d+ \w{3}/.test(err.message ?? ""), err.message);
      }
    }
  }

  // Skill sync unlocks a locked journey and re-locks it when a skill drops.
  {
    const s = await mkStudent(c, "LOCKED");
    await sql`DELETE FROM student_skill_levels WHERE student_id = ${s.studentId}`;
    const grit = (await sql<{ grit_id: string }[]>`SELECT grit_id FROM students WHERE id = ${s.studentId}`)[0].grit_id;
    const reqs = await sql<{ code: string; min_level: number }[]>`
      SELECT sk.code, r.min_level FROM badge_skill_requirements r JOIN skills sk ON sk.id = r.skill_id WHERE r.badge_id = ${c.badge.id}`;
    const r1 = await syncSkills({ gritId: grit, seq: 5, levels: reqs.map((r) => ({ skillCode: r.code, level: r.min_level })) });
    const j1 = await journey(s.journeyId);
    check("skill sync: all skills cleared unlocks", r1.unlocked === 1 && j1.state === "ELIGIBLE", j1.state);
    const stale = await syncSkills({ gritId: grit, seq: 4, levels: [{ skillCode: reqs[0].code, level: 0 }] });
    check("skill sync: an older push is ignored", stale.updated === 0 && (await journey(s.journeyId)).state === "ELIGIBLE");
    await syncSkills({ gritId: grit, seq: 6, levels: [{ skillCode: reqs[0].code, level: 0 }] });
    check("skill sync: a dropped skill re-locks", (await journey(s.journeyId)).state === "LOCKED");
  }
}

// ── before / after the result ──────────────────────────────────────────────

async function beforeAfter(c: Ctx) {
  console.log("\nBefore and after the result");
  if (!c.badge2) {
    check("before/after (skipped: no level-2 badge)", true);
    return;
  }
  // Novice pending with a recorded Pass; Specialist LOCKED with its skills cleared.
  const s = await mkStudent(c, "AWAITING_RESULT", { deadline_protected_until: new Date(Date.now() + 400 * 86400000) });
  const reqs2 = await sql<{ skill_id: string; min_level: number }[]>`SELECT skill_id, min_level FROM badge_skill_requirements WHERE badge_id = ${c.badge2.id}`;
  for (const r of reqs2) {
    await sql`INSERT INTO student_skill_levels (student_id, skill_id, level, source_seq) VALUES (${s.studentId}, ${r.skill_id}, ${r.min_level}, 1)
              ON CONFLICT (student_id, skill_id) DO UPDATE SET level = GREATEST(student_skill_levels.level, EXCLUDED.level)`;
  }
  const [spec] = await sql<{ id: string }[]>`
    INSERT INTO interview_journeys (student_id, badge_id, season_id, state) VALUES (${s.studentId}, ${c.badge2.id}, ${c.season}, 'LOCKED') RETURNING id`;
  const b = await mkBooking(c, s, -90, "COMPLETED");
  await sql`INSERT INTO interview_outcomes (booking_id, result, review_status, publish_at, submitted_at)
            VALUES (${b.bookingId}, 'PASS', 'NONE', app_now() + interval '10 minutes', app_now() - interval '5 minutes')`;

  const before = await getStudentDashboard(s.studentId);
  const novBefore = before.journeys.find((j) => j.journeyId === s.journeyId)!;
  check("before: release time shown while pending", !!novBefore.ctx.resultAtHuman, novBefore.ctx.resultAtHuman);
  check("before: Pre-Qualiflyer", before.tier === "Pre-Qualiflyer" && !before.hasBadge, before.tier);

  await sql`UPDATE interview_outcomes SET publish_at = app_now() - interval '1 second' WHERE booking_id = ${b.bookingId}`;
  await runTick();

  const after = await getStudentDashboard(s.studentId);
  const nov = after.journeys.find((j) => j.journeyId === s.journeyId)!;
  const sp = after.journeys.find((j) => j.journeyId === spec.id)!;
  check("after Pass: badge earned, now a Qualiflyer", nov.state === "PASSED" && after.tier === "Qualiflyer" && !!nov.ctx.firstBadge, `${nov.state}/${after.tier}`);
  check("after Pass: Specialist unlocks (skills already cleared)", sp.state === "ELIGIBLE", sp.state);
  const notes = await sql`SELECT 1 FROM notifications WHERE student_id = ${s.studentId} AND template = 'RESULT_READY'`;
  check("after: one neutral RESULT_READY notification", notes.length === 1, String(notes.length));

  // A Pass with Specialist skills missing does not unlock it.
  const s2 = await mkStudent(c, "AWAITING_RESULT", { deadline_protected_until: new Date(Date.now() + 400 * 86400000) });
  const [spec2] = await sql<{ id: string }[]>`
    INSERT INTO interview_journeys (student_id, badge_id, season_id, state) VALUES (${s2.studentId}, ${c.badge2.id}, ${c.season}, 'LOCKED') RETURNING id`;
  const b2 = await mkBooking(c, s2, -90, "COMPLETED");
  await sql`INSERT INTO interview_outcomes (booking_id, result, review_status, publish_at, submitted_at)
            VALUES (${b2.bookingId}, 'PASS', 'NONE', app_now() - interval '1 second', app_now() - interval '5 minutes')`;
  await runTick();
  const sp2 = (await sql<{ state: string }[]>`SELECT state FROM interview_journeys WHERE id = ${spec2.id}`)[0];
  check("after Pass, skills missing: Specialist stays locked", sp2.state === "LOCKED", sp2.state);

  // Leaderboard next goal: the gap to the rank above.
  if (after.next) check("leaderboard: next goal gives the Miles gap", after.next.gap >= 0 && after.next.aboveRank === after.rank - 1, JSON.stringify(after.next));
  else check("leaderboard: #1 has a lead or none", after.rank === 1);
}

export const PHASES: Phase[] = [phase3, phase4, phase5, phase6, phase7, phase9, beforeAfter];
