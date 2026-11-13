/**
 * Approvals that take effect (spec §2, §7, §8). An approval is filed by one person
 * and decided by a different Program Admin (two-person rule). Approving applies the
 * effect in the same transaction as the status change, so a request can never be
 * marked APPROVED without its effect, or vice versa.
 */
import type { Sql, TransactionSql } from "postgres";
import { sql } from "@/db";
import { ApiError } from "@/lib/errors";
import { transitionJourney, bumpJourney, type JourneyRow } from "./journeys";
import { closeIfAttemptLimit, runTick } from "./jobs";
import { ATTEMPT_LIMIT_REASON, DEADLINE_CLOSE_REASON_PREFIX } from "@/lib/state-machine";

type Tx = Sql | TransactionSql;

export type ApprovalKind =
  | "EMERGENCY_WAIVER"
  | "COOLDOWN_OVERRIDE"
  | "REOPEN"
  | "RESULT_AMENDMENT"
  | "SECOND_REVIEW"
  | "THIRD_RETAKE"
  | "SEASON_RULE"
  | "NULLIFY"
  | "DISQUALIFY"
  | "ROLE_GRANT";

interface ApprovalRow {
  id: string;
  action: ApprovalKind;
  status: string;
  requested_by: string | null;
  interviewer_id: string | null;
  interviewer_user: string | null;
  journey_id: string | null;
  payload: Record<string, unknown>;
  reason: string | null;
}

export { APPROVAL_EFFECT } from "@/lib/approvalEffects";

async function loadForDecision(tx: Tx, id: string, actorUserId: string): Promise<ApprovalRow> {
  const a = (
    await tx<ApprovalRow[]>`
      SELECT a.id, a.action, a.status, a.requested_by, a.interviewer_id, ivu.id interviewer_user,
             a.journey_id, a.payload, a.reason
      FROM approvals a
      LEFT JOIN interviewers iv ON iv.id = a.interviewer_id
      LEFT JOIN users ivu ON ivu.id = iv.user_id
      WHERE a.id = ${id} FOR UPDATE OF a`
  )[0];
  if (!a) throw new ApiError(404, "NOT_FOUND", "Approval not found");
  if (a.status !== "PENDING") throw new ApiError(409, "ALREADY_DECIDED", "This request is already decided.");
  if (a.requested_by && a.requested_by === actorUserId)
    throw new ApiError(403, "SELF_APPROVAL", "The decider can't be the requester.");
  if (a.interviewer_user && a.interviewer_user === actorUserId)
    throw new ApiError(403, "CONFLICT", "The decider can't be the interviewer.");
  return a;
}

async function seasonRules(tx: Tx) {
  return (
    await tx<{ fail_cooldown_days: number; retake_cooldown_days: number; noshow_cooldown_days: number }[]>`
      SELECT fail_cooldown_days, retake_cooldown_days, noshow_cooldown_days FROM season_rules LIMIT 1`
  )[0];
}

/**
 * A journey closed by the attempt cap or the deadline sweep can be reopened or
 * amended by an approval; one closed by an integrity decision can't (that goes
 * through the case).
 */
function assertNotIntegrityClosed(j: JourneyRow) {
  if (j.state !== "CLOSED") return;
  const r = j.state_reason ?? "";
  if (r === ATTEMPT_LIMIT_REASON || r.startsWith(DEADLINE_CLOSE_REASON_PREFIX)) return;
  throw new ApiError(409, "UNDER_REVIEW", "This journey was closed by an integrity decision; change it from the case instead.");
}

async function lockJourney(tx: Tx, journeyId: string): Promise<JourneyRow> {
  const j = (await tx<JourneyRow[]>`SELECT * FROM interview_journeys WHERE id = ${journeyId} FOR UPDATE`)[0];
  if (!j) throw new ApiError(404, "NOT_FOUND", "Journey not found");
  return j;
}

async function notifyStudent(tx: Tx, studentId: string, template: string, payload: Record<string, string>) {
  await tx`INSERT INTO notifications (student_id, channel, template, payload, created_at)
           VALUES (${studentId}, 'IN_APP', ${template}, ${tx.json(payload)}, app_now())`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ── effects ──────────────────────────────────────────────────────────────────

async function applyEmergencyWaiver(tx: Tx, a: ApprovalRow, actor: string) {
  const bookingId = str(a.payload.bookingId);
  if (!bookingId) throw new ApiError(422, "BAD_APPROVAL", "This request has no interview attached.");
  const bk = (
    await tx<{ id: string; journey_id: string; student_id: string; slot_id: string; status: string; future: boolean }[]>`
      SELECT id, journey_id, student_id, slot_id, status, (start_at > app_now()) future
      FROM bookings WHERE id = ${bookingId} FOR UPDATE`
  )[0];
  if (!bk) throw new ApiError(404, "NOT_FOUND", "Interview not found");
  const j = await lockJourney(tx, bk.journey_id);

  if (bk.status === "CONFIRMED") {
    if (j.state !== "BOOKED") {
      throw new ApiError(409, "JOURNEY_MOVED_ON", "This student's journey isn't in a booked state (it may be under review), so the waiver can't be applied now.");
    }
    await tx`UPDATE bookings SET status = 'VOID', void_reason = 'EMERGENCY', updated_at = app_now() WHERE id = ${bk.id}`;
    // A future seat goes back to the pool; a past one is retired.
    await tx`UPDATE interview_slots SET status = ${bk.future ? "OPEN" : "CANCELLED"}, version = version + 1 WHERE id = ${bk.slot_id}`;
    {
      await transitionJourney(tx, {
        journeyId: j.id,
        action: "emergency_void",
        reason: "Emergency approved, no attempt used",
        actorUserId: actor,
        payload: { approvalId: a.id, bookingId: bk.id },
      });
    }
  } else if (bk.status === "NO_SHOW") {
    // Approved after the interview was already marked missed: undo the no-show.
    assertNotIntegrityClosed(j);
    const latest = (await tx<{ id: string }[]>`
      SELECT id FROM bookings WHERE journey_id = ${j.id} AND status NOT IN ('CANCELLED','VOID')
      ORDER BY start_at DESC LIMIT 1`)[0];
    const isLatest = latest?.id === bk.id;
    await tx`UPDATE bookings SET status = 'VOID', void_reason = 'EMERGENCY', updated_at = app_now() WHERE id = ${bk.id}`;
    const refunded = Math.max(0, j.attempt_count - 1);
    const patch = { attempt_count: refunded, cooldown_until: null };
    if (!isLatest) {
      // A later interview decides the journey's state now: only refund the attempt.
      await bumpJourney(tx, j.id, { attempt_count: refunded });
    } else if (j.state === "NO_SHOW") {
      await transitionJourney(tx, { journeyId: j.id, action: "waive_no_show", reason: "Emergency approved, missed interview removed", actorUserId: actor, patch, payload: { approvalId: a.id } });
    } else if (j.state === "CLOSED" && refunded < j.max_attempts) {
      await transitionJourney(tx, { journeyId: j.id, action: "reopen", reason: "Emergency approved, missed interview removed", actorUserId: actor, patch, payload: { approvalId: a.id } });
    } else {
      await bumpJourney(tx, j.id, { attempt_count: refunded });
    }
  } else {
    throw new ApiError(409, "NOTHING_TO_WAIVE", "That interview is no longer upcoming or missed, so there's nothing to waive.");
  }
  await notifyStudent(tx, bk.student_id, "EMERGENCY_APPROVED", { bookingId: bk.id });
}

async function applyCooldownOverride(tx: Tx, a: ApprovalRow, actor: string) {
  if (!a.journey_id) throw new ApiError(422, "BAD_APPROVAL", "This request has no student journey attached.");
  const j = await lockJourney(tx, a.journey_id);
  if (!["FAILED", "RETAKE_LATER", "NO_SHOW"].includes(j.state)) {
    throw new ApiError(409, "NO_COOLDOWN", "This student isn't waiting out a cooldown any more.");
  }
  await transitionJourney(tx, {
    journeyId: j.id,
    action: "cooldown_expire",
    reason: "Wait ended early (approved)",
    actorUserId: actor,
    patch: { cooldown_until: null, priority_rebook: false, retake_approval_pending: false },
    payload: { approvalId: a.id },
  });
  await notifyStudent(tx, j.student_id, "COOLDOWN_OVERRIDDEN", { journeyId: j.id });
}

async function applyReopen(tx: Tx, a: ApprovalRow, actor: string) {
  if (!a.journey_id) throw new ApiError(422, "BAD_APPROVAL", "This request has no student journey attached.");
  const j = await lockJourney(tx, a.journey_id);
  assertNotIntegrityClosed(j);
  const patch = { max_attempts: j.max_attempts + 1 };
  if (j.state === "CLOSED") {
    await transitionJourney(tx, { journeyId: j.id, action: "reopen", reason: "Extra attempt approved", actorUserId: actor, patch: { ...patch, cooldown_until: null }, payload: { approvalId: a.id } });
  } else if (["NULLIFIED", "ON_HOLD"].includes(j.state)) {
    throw new ApiError(409, "UNDER_REVIEW", "This journey is under an integrity decision; reopen it from the case instead.");
  } else {
    await bumpJourney(tx, j.id, patch);
  }
  await notifyStudent(tx, j.student_id, "EXTRA_ATTEMPT", { journeyId: j.id });
}

type Result = "PASS" | "FAIL" | "RETAKE_LATER";

/** Award the journey's badge for an outcome (same row the publisher writes on PASS). */
async function awardBadge(tx: Tx, o: { studentId: string; badgeId: string; outcomeId: string; awardedAt: Date }) {
  const miles = (await tx<{ miles: number }[]>`SELECT miles FROM badges WHERE id = ${o.badgeId}`)[0].miles;
  await tx`
    INSERT INTO student_badges (student_id, badge_id, outcome_id, awarded_at, status, miles)
    VALUES (${o.studentId}, ${o.badgeId}, ${o.outcomeId}, ${o.awardedAt}, 'ACTIVE', ${miles})`;
}

async function applyResultAmendment(tx: Tx, a: ApprovalRow, actor: string) {
  const outcomeId = str(a.payload.outcomeId);
  const newResult = str(a.payload.newResult) as Result | null;
  if (!outcomeId || !newResult || !["PASS", "FAIL", "RETAKE_LATER"].includes(newResult)) {
    throw new ApiError(422, "BAD_APPROVAL", "This request doesn't say which result to change, or to what.");
  }
  // Lock order booking -> journey -> outcome (same as submitOutcome and the publisher).
  const ref = (await tx<{ booking_id: string; journey_id: string }[]>`
    SELECT o.booking_id, bk.journey_id FROM interview_outcomes o JOIN bookings bk ON bk.id = o.booking_id WHERE o.id = ${outcomeId}`)[0];
  if (!ref) throw new ApiError(404, "NOT_FOUND", "Result not found");
  await tx`SELECT 1 FROM bookings WHERE id = ${ref.booking_id} FOR UPDATE`;
  await tx`SELECT 1 FROM interview_journeys WHERE id = ${ref.journey_id} FOR UPDATE`;
  const o = (
    await tx<{ id: string; result: Result | null; review_status: string; booking_id: string; journey_id: string; student_id: string; start_at: Date }[]>`
      SELECT o.id, o.result, o.review_status, o.booking_id, bk.journey_id, bk.student_id, bk.start_at
      FROM interview_outcomes o JOIN bookings bk ON bk.id = o.booking_id
      WHERE o.id = ${outcomeId} FOR UPDATE OF o`
  )[0];
  if (!o) throw new ApiError(404, "NOT_FOUND", "Result not found");
  if (o.review_status !== "RELEASED" || !o.result) throw new ApiError(409, "NOT_PUBLISHED", "Only a published result can be changed.");
  if (o.result === newResult) throw new ApiError(409, "NO_CHANGE", "The result is already that.");
  if (o.result === "PASS") throw new ApiError(409, "USE_INTEGRITY", "A Pass can only be taken away through an integrity case.");

  const j = await lockJourney(tx, o.journey_id);
  assertNotIntegrityClosed(j);
  // Only the journey's latest interview can be changed, and not while a new one is under way.
  const latest = (await tx<{ id: string }[]>`
    SELECT id FROM bookings WHERE journey_id = ${j.id} AND status NOT IN ('CANCELLED','VOID')
    ORDER BY start_at DESC LIMIT 1`)[0];
  if (latest?.id !== o.booking_id || ["BOOKED", "AWAITING_RESULT", "ON_HOLD", "NULLIFIED", "PASSED"].includes(j.state)) {
    throw new ApiError(409, "JOURNEY_MOVED_ON", "The student has moved on since this result, so it can't be changed here.");
  }
  const r = await seasonRules(tx);
  const counted = o.result === "FAIL";
  const base = { journeyId: j.id, actorUserId: actor, payload: { approvalId: a.id, outcomeId: o.id, from: o.result, to: newResult } };

  if (newResult === "PASS") {
    await transitionJourney(tx, {
      ...base,
      action: "amend_pass",
      reason: "Result changed to Pass (approved)",
      patch: { attempt_count: counted ? Math.max(0, j.attempt_count - 1) : j.attempt_count, cooldown_until: null, priority_rebook: false, retake_approval_pending: false },
    });
    await awardBadge(tx, { studentId: o.student_id, badgeId: j.badge_id, outcomeId: o.id, awardedAt: o.start_at });
  } else if (newResult === "RETAKE_LATER") {
    // FAIL -> Retake later: refund the attempt, shorter wait.
    const cooldown = new Date(o.start_at.getTime() + r.retake_cooldown_days * 86_400_000);
    const patch = { attempt_count: Math.max(0, j.attempt_count - 1), cooldown_until: cooldown };
    if (j.state === "FAILED" || j.state === "CLOSED") {
      await transitionJourney(tx, { ...base, action: "amend_retake", reason: "Result changed to Retake later (approved)", patch });
    } else {
      await bumpJourney(tx, j.id, { attempt_count: patch.attempt_count });
    }
  } else {
    // Retake later -> FAIL: counts an attempt, longer wait.
    if (j.state !== "RETAKE_LATER") {
      throw new ApiError(409, "JOURNEY_MOVED_ON", "The student's wait has already ended, so this can't become a Fail now.");
    }
    const cooldown = new Date(o.start_at.getTime() + r.fail_cooldown_days * 86_400_000);
    await transitionJourney(tx, {
      ...base,
      action: "amend_fail",
      reason: "Result changed to Not cleared (approved)",
      patch: { attempt_count: j.attempt_count + 1, cooldown_until: cooldown, retake_approval_pending: false },
    });
    await closeIfAttemptLimit(tx, j.id, j.attempt_count + 1, j.max_attempts);
  }
  await tx`UPDATE interview_outcomes SET result = ${newResult} WHERE id = ${o.id}`;
  await notifyStudent(tx, o.student_id, "RESULT_AMENDED", { journeyId: j.id });
}

/** Edit window the interviewer gets after a declined second review. */
export const SECOND_REVIEW_EDIT_MINUTES = 120;
const SECOND_REVIEW_FALLBACK_FEEDBACK =
  "Your interview was reviewed by a second person on the interview team, who found it didn't clear the bar this time. Use the practice resources and try again when your next attempt opens.";

/** Pass against the suggestion, held for a second review (phase 5). */
async function decideSecondReview(tx: Tx, a: ApprovalRow, approve: boolean) {
  const outcomeId = str(a.payload.outcomeId);
  if (!outcomeId) throw new ApiError(422, "BAD_APPROVAL", "This request has no result attached.");
  const o = (await tx<{ review_status: string; suggested_result: Result | null }[]>`
    SELECT review_status, suggested_result FROM interview_outcomes WHERE id = ${outcomeId} FOR UPDATE`)[0];
  if (!o) throw new ApiError(404, "NOT_FOUND", "Result not found");
  if (o.review_status !== "PENDING_SECOND_REVIEW") return; // already moved on (e.g. integrity hold)
  if (approve) {
    await tx`UPDATE interview_outcomes SET review_status = 'NONE', publish_at = LEAST(publish_at, app_now()) WHERE id = ${outcomeId}`;
  } else {
    // Back to the interviewer with the suggested result and a fresh edit window, so a
    // Fail or Retake later gets its own feedback. If they don't edit, a neutral note goes out.
    const r = (await tx<{ interviewer_user: string; publish_delay_minutes: number }[]>`
      SELECT iv.user_id interviewer_user, sr.publish_delay_minutes
      FROM interview_outcomes o JOIN bookings bk ON bk.id = o.booking_id JOIN interviewers iv ON iv.id = bk.interviewer_id
      CROSS JOIN season_rules sr WHERE o.id = ${outcomeId}`)[0];
    await tx`
      UPDATE interview_outcomes
      SET review_status = 'NONE', result = COALESCE(suggested_result, result),
          feedback_to_student = CASE WHEN COALESCE(suggested_result, result) = 'PASS' THEN feedback_to_student
                                     WHEN length(coalesce(feedback_to_student, '')) >= 80 THEN feedback_to_student
                                     ELSE ${SECOND_REVIEW_FALLBACK_FEEDBACK} END,
          publish_at = app_now() + make_interval(mins => ${Math.max(r.publish_delay_minutes, SECOND_REVIEW_EDIT_MINUTES)})
      WHERE id = ${outcomeId}`;
    await tx`INSERT INTO notifications (user_id, channel, template, payload, created_at)
             VALUES (${r.interviewer_user}, 'IN_APP', 'OUTCOME_SENT_BACK', ${tx.json({ outcomeId })}, app_now())`;
  }
}

/** 3rd Retake later in a row (phase 9). */
async function decideThirdRetake(tx: Tx, a: ApprovalRow, approve: boolean, actor: string) {
  if (!a.journey_id) throw new ApiError(422, "BAD_APPROVAL", "This request has no student journey attached.");
  const j = await lockJourney(tx, a.journey_id);
  if (!j.retake_approval_pending) return;
  if (approve || j.state !== "RETAKE_LATER") {
    await bumpJourney(tx, j.id, { retake_approval_pending: false });
    return;
  }
  const r = await seasonRules(tx);
  const last = (await tx<{ start_at: Date }[]>`
    SELECT start_at FROM bookings WHERE journey_id = ${j.id} AND status = 'COMPLETED' ORDER BY start_at DESC LIMIT 1`)[0];
  const from = last?.start_at ?? (await tx<{ n: Date }[]>`SELECT app_now() n`)[0].n;
  await transitionJourney(tx, {
    journeyId: j.id,
    action: "amend_fail",
    reason: "3rd Retake later not approved; counted as Not cleared",
    actorUserId: actor,
    patch: {
      attempt_count: j.attempt_count + 1,
      cooldown_until: new Date(from.getTime() + r.fail_cooldown_days * 86_400_000),
      retake_approval_pending: false,
      consecutive_retake_later: 0,
    },
    payload: { approvalId: a.id },
  });
  const outcomeId = str(a.payload.outcomeId);
  if (outcomeId) await tx`UPDATE interview_outcomes SET result = 'FAIL' WHERE id = ${outcomeId} AND result = 'RETAKE_LATER'`;
  await closeIfAttemptLimit(tx, j.id, j.attempt_count + 1, j.max_attempts);
}

// ── public API ───────────────────────────────────────────────────────────────

export async function approveRequest(id: string, actorUserId: string): Promise<void> {
  let tick = false;
  await sql.begin(async (tx) => {
    const a = await loadForDecision(tx, id, actorUserId);
    switch (a.action) {
      case "EMERGENCY_WAIVER":
        await applyEmergencyWaiver(tx, a, actorUserId);
        break;
      case "COOLDOWN_OVERRIDE":
        await applyCooldownOverride(tx, a, actorUserId);
        break;
      case "REOPEN":
        await applyReopen(tx, a, actorUserId);
        break;
      case "RESULT_AMENDMENT":
        await applyResultAmendment(tx, a, actorUserId);
        break;
      case "SECOND_REVIEW":
        await decideSecondReview(tx, a, true);
        tick = true;
        break;
      case "THIRD_RETAKE":
        await decideThirdRetake(tx, a, true, actorUserId);
        tick = true;
        break;
      default:
        // SEASON_RULE and the rest: a recorded sign-off.
        break;
    }
    await tx`UPDATE approvals SET status = 'APPROVED', approved_by = ${actorUserId}, decided_at = app_now() WHERE id = ${id}`;
  });
  if (tick) await runTick();
}

export async function declineRequest(id: string, actorUserId: string, reason?: string): Promise<void> {
  let tick = false;
  await sql.begin(async (tx) => {
    const a = await loadForDecision(tx, id, actorUserId);
    if (a.action === "SECOND_REVIEW") {
      await decideSecondReview(tx, a, false);
      tick = true;
    } else if (a.action === "THIRD_RETAKE") {
      await decideThirdRetake(tx, a, false, actorUserId);
    }
    const r = reason?.trim();
    const merged = r ? `${a.reason ? a.reason + " — " : ""}Declined: ${r}` : a.reason;
    await tx`UPDATE approvals SET status = 'REJECTED', approved_by = ${actorUserId}, decided_at = app_now(), reason = ${merged ?? null} WHERE id = ${id}`;
  });
  if (tick) await runTick();
}

/** Kinds staff can file from the tracker. */
export const STAFF_REQUEST_KINDS = ["RESULT_AMENDMENT", "REOPEN", "COOLDOWN_OVERRIDE"] as const;
export type StaffRequestKind = (typeof STAFF_REQUEST_KINDS)[number];

/** File a request from the tracker (interview team or Program Admin). */
export async function createStaffRequest(o: {
  kind: StaffRequestKind;
  journeyId: string;
  requestedBy: string;
  reason: string;
  newResult?: Result;
}): Promise<{ id: string }> {
  if (o.reason.trim().length < 10) throw new ApiError(422, "REASON_REQUIRED", "Give a reason of at least 10 characters.");
  return sql.begin(async (tx) => {
    const j = (await tx<{ id: string; state: string }[]>`SELECT id, state FROM interview_journeys WHERE id = ${o.journeyId}`)[0];
    if (!j) throw new ApiError(404, "NOT_FOUND", "Journey not found");
    const dup = await tx`SELECT 1 FROM approvals WHERE journey_id = ${j.id} AND action = ${o.kind} AND status = 'PENDING'`;
    if (dup.length) throw new ApiError(409, "ALREADY_REQUESTED", "There's already a pending request of this kind for this student.");

    const payload: Record<string, string> = {};
    let interviewerId: string | null = null;
    if (o.kind === "RESULT_AMENDMENT") {
      if (!o.newResult) throw new ApiError(422, "BAD_REQUEST", "Choose the new result.");
      const last = (await tx<{ outcome_id: string; result: string; interviewer_id: string }[]>`
        SELECT o.id outcome_id, o.result, bk.interviewer_id
        FROM interview_outcomes o JOIN bookings bk ON bk.id = o.booking_id
        WHERE bk.journey_id = ${j.id} AND o.review_status = 'RELEASED'
        ORDER BY bk.start_at DESC LIMIT 1`)[0];
      if (!last) throw new ApiError(409, "NOT_PUBLISHED", "This student has no published result to change.");
      if (last.result === o.newResult) throw new ApiError(409, "NO_CHANGE", "The result is already that.");
      payload.outcomeId = last.outcome_id;
      payload.newResult = o.newResult;
      interviewerId = last.interviewer_id;
    } else if (o.kind === "COOLDOWN_OVERRIDE" && !["FAILED", "RETAKE_LATER", "NO_SHOW"].includes(j.state)) {
      throw new ApiError(409, "NO_COOLDOWN", "This student isn't waiting out a cooldown.");
    }
    const row = (await tx<{ id: string }[]>`
      INSERT INTO approvals (action, requested_by, journey_id, interviewer_id, payload, reason, created_at)
      VALUES (${o.kind}, ${o.requestedBy}, ${j.id}, ${interviewerId}, ${tx.json(payload)}, ${o.reason.trim()}, app_now())
      RETURNING id`)[0];
    return { id: row.id };
  });
}
