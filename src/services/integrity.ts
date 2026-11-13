/**
 * Integrity cases: opening one when an interviewer holds a result, and the two
 * decisions (dismiss / confirm). The admin routes and the demo story both call
 * these, so the rules live in one place.
 *
 * A held result is an outcome with review_status WITHHELD, linked to its case by
 * integrity_cases.booking_id (migration 0007). The publisher only publishes
 * review_status NONE, so:
 *   - dismiss → the interviewer's recorded result is released (NONE) and published now
 *   - confirm → the result becomes "Not cleared" (FAIL, neutral feedback) and is
 *               published now, which counts the attempt and starts the usual wait
 */
import type { TransactionSql } from "postgres";
import { sql } from "@/db";
import { ENGINE_TRANSITIONS, type JourneyState } from "@/lib/state-machine";
import { PROTECTION_DAYS } from "./reassign";
import { ApiError } from "@/lib/errors";
import { transitionJourney } from "./journeys";
import { runTick } from "./jobs";

type Tx = TransactionSql<Record<string, never>>;

export const CONFIRMED_FEEDBACK =
  "This interview didn't count because the identity check didn't pass review. See the interview rules, or contact GRIT support if you have questions.";

/** Opens a TRIAGE case for a held interview, unless an undecided one already exists. Returns its id. */
export async function openIntegrityCase(
  tx: Tx,
  o: { bookingId: string; openedBy: string; reason: string; category?: string | null }
): Promise<string> {
  const existing = (await tx<{ id: string }[]>`
    SELECT id FROM integrity_cases WHERE booking_id = ${o.bookingId} AND status IN ('TRIAGE','OPEN') LIMIT 1`)[0];
  if (existing) return existing.id;
  const b = (await tx<{ student_id: string }[]>`SELECT student_id FROM bookings WHERE id = ${o.bookingId}`)[0];
  if (!b) throw new ApiError(404, "NOT_FOUND", "Booking not found");
  // Next IC-NNNN code. Serialised by a transaction-scoped advisory lock so two
  // interviewers can't take the same number.
  await tx`SELECT pg_advisory_xact_lock(hashtext('integrity_case_code'))`;
  const n = (await tx<{ n: number }[]>`
    SELECT COALESCE(MAX((substring(code from 'IC-(\\d+)'))::int), 0) + 1 AS n FROM integrity_cases`)[0].n;
  const code = `IC-${String(n).padStart(4, "0")}`;
  const row = (await tx<{ id: string }[]>`
    INSERT INTO integrity_cases (code, subject_type, subject_student_id, status, opened_by, reason, booking_id, category, created_at)
    VALUES (${code}, 'STUDENT', ${b.student_id}, 'TRIAGE', ${o.openedBy}, ${o.reason}, ${o.bookingId}, ${o.category ?? null}, app_now())
    RETURNING id`)[0];
  return row.id;
}

/** Journey states a hold applies to. A booked interview or a pending result carries on (spec copy table). */
export const HOLDABLE_STATES: JourneyState[] = ["LOCKED", "ELIGIBLE", "PASSED", "FAILED", "RETAKE_LATER", "NO_SHOW"];
const DISMISS_TARGETS = new Set<JourneyState>(
  ENGINE_TRANSITIONS.ON_HOLD.filter((t) => t.action === "dismiss_hold").map((t) => t.to)
);

/**
 * Put a case under review (spec section 7): the student's journeys go on hold, their
 * badges go under review (Miles frozen: only ACTIVE badges count).
 */
export async function holdCase(o: { caseId: string; actorUserId: string }): Promise<{ held: number }> {
  return sql.begin(async (tx) => {
    const c = (await tx<{ subject_student_id: string | null; opened_by: string | null; status: string }[]>`
      SELECT subject_student_id, opened_by, status FROM integrity_cases WHERE id = ${o.caseId} FOR UPDATE`)[0];
    if (!c) throw new ApiError(404, "NOT_FOUND", "Case not found");
    if (c.status !== "TRIAGE") throw new ApiError(409, "NOT_IN_TRIAGE", "Only a case in triage can be put on hold.");
    if (c.opened_by === o.actorUserId) throw new ApiError(403, "DECIDER_IS_OPENER", "The decider can't be the opener.");
    if (!c.subject_student_id) throw new ApiError(422, "NO_SUBJECT", "No subject student.");

    const journeys = await tx<{ id: string; state: JourneyState }[]>`
      SELECT id, state FROM interview_journeys
      WHERE student_id = ${c.subject_student_id} AND state = ANY(${HOLDABLE_STATES}::journey_state[])
      ORDER BY id FOR UPDATE`;
    for (const j of journeys) {
      await transitionJourney(tx, {
        journeyId: j.id,
        action: "hold",
        reason: "Under review",
        actorUserId: o.actorUserId,
        patch: { hold_prev_state: j.state, hold_case_id: o.caseId },
        payload: { caseId: o.caseId },
      });
    }
    await tx`UPDATE student_badges SET status = 'UNDER_REVIEW', case_id = ${o.caseId}
             WHERE student_id = ${c.subject_student_id} AND status = 'ACTIVE'`;
    await tx`UPDATE integrity_cases SET status = 'OPEN', held_at = app_now() WHERE id = ${o.caseId}`;
    return { held: journeys.length };
  });
}

interface CaseRow {
  subject_student_id: string | null;
  opened_by: string | null;
  status: string;
  grit_id: string | null;
  booking_id: string | null;
}

async function loadCase(id: string): Promise<CaseRow> {
  const c = (await sql<CaseRow[]>`
    SELECT ic.subject_student_id, ic.opened_by, ic.status, s.grit_id, ic.booking_id
    FROM integrity_cases ic LEFT JOIN students s ON s.id = ic.subject_student_id
    WHERE ic.id = ${id}`)[0];
  if (!c) throw new ApiError(404, "NOT_FOUND", "Case not found");
  if (c.status === "CONFIRMED" || c.status === "DISMISSED") throw new ApiError(409, "ALREADY_DECIDED", "This case is already decided.");
  return c;
}

async function lockUndecided(tx: Tx, id: string): Promise<string> {
  const cur = (await tx<{ status: string }[]>`SELECT status FROM integrity_cases WHERE id = ${id} FOR UPDATE`)[0];
  if (!cur || cur.status === "CONFIRMED" || cur.status === "DISMISSED") {
    throw new ApiError(409, "ALREADY_DECIDED", "This case is already decided.");
  }
  return cur.status;
}

/** Dismiss: held journeys go back to ELIGIBLE, a held result is released and published straight away. */
export async function dismissCase(o: {
  caseId: string;
  actorUserId: string | null;
  note: string;
  /** Auto-release: only act if the case is still in triage when locked. */
  onlyIfTriage?: boolean;
}): Promise<{ releasedResult: boolean }> {
  const note = o.note.trim();
  if (!note) throw new ApiError(422, "NOTE_REQUIRED", "Add a short note explaining the dismissal.");
  const c = await loadCase(o.caseId);
  if (c.opened_by === o.actorUserId) throw new ApiError(403, "DECIDER_IS_OPENER", "The decider can't be the opener.");

  const released = await sql.begin(async (tx) => {
    const status = await lockUndecided(tx, o.caseId);
    if (o.onlyIfTriage && status !== "TRIAGE") {
      throw new ApiError(409, "NOT_IN_TRIAGE", "Someone put this case under review; it isn't auto-released.");
    }
    // Only this case's holds (journeys held before migration 0012 have no case id).
    const held = await tx<{ id: string; hold_prev_state: JourneyState | null }[]>`
      SELECT id, hold_prev_state FROM interview_journeys
      WHERE student_id = ${c.subject_student_id} AND state = 'ON_HOLD'
        AND (hold_case_id = ${o.caseId} OR hold_case_id IS NULL)
      FOR UPDATE`;
    // Did the hold run past the season deadline? Then the student gets 10 days of protection.
    const crossed = (await tx<{ crossed: boolean }[]>`
      SELECT (ic.held_at IS NOT NULL AND ic.held_at <= s.deadline_at AND app_now() > s.deadline_at) crossed
      FROM integrity_cases ic CROSS JOIN (SELECT deadline_at FROM seasons ORDER BY deadline_at DESC LIMIT 1) s
      WHERE ic.id = ${o.caseId}`)[0]?.crossed ?? false;
    for (const j of held) {
      // Back to where it was (spec section 7); a cooldown that ran out meanwhile is picked up by the next tick.
      const to = j.hold_prev_state && DISMISS_TARGETS.has(j.hold_prev_state) ? j.hold_prev_state : "ELIGIBLE";
      await transitionJourney(tx, {
        journeyId: j.id,
        action: "dismiss_hold",
        to,
        reason: "Review closed",
        actorUserId: o.actorUserId,
        patch: { hold_prev_state: null, hold_case_id: null },
        payload: { decision: "dismiss", note, caseId: o.caseId },
      });
    }
    if (crossed) {
      await tx`
        UPDATE interview_journeys j
        SET deadline_protected_until = GREATEST(COALESCE(j.deadline_protected_until, s.deadline_at), app_now() + make_interval(days => ${PROTECTION_DAYS})),
            version = j.version + 1
        FROM seasons s
        WHERE s.id = j.season_id AND j.student_id = ${c.subject_student_id}
          AND j.state IN ('ELIGIBLE','FAILED','RETAKE_LATER','NO_SHOW')`;
    }
    await tx`UPDATE student_badges SET status = 'ACTIVE'
             WHERE student_id = ${c.subject_student_id} AND status = 'UNDER_REVIEW'
               AND (case_id = ${o.caseId} OR case_id IS NULL)`;
    const r = c.booking_id || c.subject_student_id
      ? await tx`
          UPDATE interview_outcomes
          SET review_status = 'NONE', publish_at = LEAST(publish_at, app_now())
          WHERE review_status = 'WITHHELD' AND locked_at IS NULL
            AND (booking_id = ${c.booking_id}
                 -- Cases opened before migration 0007 have no booking link: use the student's held results.
                 OR (${c.booking_id}::uuid IS NULL AND booking_id IN (SELECT id FROM bookings WHERE student_id = ${c.subject_student_id})))`
      : { count: 0 };
    await tx`UPDATE integrity_cases SET status = 'DISMISSED', decided_by = ${o.actorUserId}, decided_at = app_now(),
                 decision = 'dismiss', decision_note = ${note}
             WHERE id = ${o.caseId}`;
    return r.count > 0;
  });
  // Publish the released result now rather than at the next scheduled run.
  // Publish released results, and any result held back while the review was open, now.
  await runTick();
  return { releasedResult: released };
}

/**
 * Confirm: for journeys on hold, nullify an earned badge or close the journey (as before).
 * A held interview result counts as Not cleared: 1 attempt, the normal wait, neutral feedback.
 */
export async function confirmCase(o: {
  caseId: string;
  actorUserId: string;
  decision: "nullify" | "disqualify";
  note: string;
  confirmId: string;
}): Promise<{ heldJourneys: number; resultNotCleared: boolean }> {
  const note = o.note.trim();
  if (note.length < 50) throw new ApiError(422, "NOTE_TOO_SHORT", "The decision note needs at least 50 characters.");
  const c = await loadCase(o.caseId);
  if (c.opened_by === o.actorUserId) throw new ApiError(403, "DECIDER_IS_OPENER", "The decider can't be the opener.");
  if (!c.grit_id || o.confirmId.trim() !== c.grit_id) {
    throw new ApiError(422, "CONFIRM_MISMATCH", "The GRIT ID you typed doesn't match this student.");
  }
  const payload = { decision: o.decision, note, caseId: o.caseId };

  const res = await sql.begin(async (tx) => {
    await lockUndecided(tx, o.caseId);
    const held = await tx<{ id: string; badge_id: string }[]>`
      SELECT id, badge_id FROM interview_journeys
      WHERE student_id = ${c.subject_student_id} AND state = 'ON_HOLD'
        AND (hold_case_id = ${o.caseId} OR hold_case_id IS NULL)
      FOR UPDATE`;
    for (const j of held) {
      const hadBadge =
        (await tx<{ n: number }[]>`
          SELECT count(*)::int n FROM student_badges
          WHERE student_id = ${c.subject_student_id} AND badge_id = ${j.badge_id} AND status IN ('ACTIVE','UNDER_REVIEW')`)[0].n > 0;
      if (hadBadge) {
        await transitionJourney(tx, { journeyId: j.id, action: "confirm_nullify", reason: "Badge nullified", actorUserId: o.actorUserId, payload });
        await tx`UPDATE student_badges SET status = 'NULLIFIED', case_id = ${o.caseId}
                 WHERE student_id = ${c.subject_student_id} AND badge_id = ${j.badge_id} AND status IN ('ACTIVE','UNDER_REVIEW')`;
        // Cascade (spec section 1, 7): higher badges in the same track fall with it.
        const higher = await tx<{ badge_id: string }[]>`
          UPDATE student_badges sb SET status = 'NULLIFIED', case_id = ${o.caseId}
          FROM badges nb, badges hb
          WHERE nb.id = ${j.badge_id} AND hb.id = sb.badge_id
            AND hb.track_id = nb.track_id AND hb.level > nb.level
            AND sb.student_id = ${c.subject_student_id} AND sb.status IN ('ACTIVE','UNDER_REVIEW')
          RETURNING sb.badge_id`;
        for (const h of higher) {
          const hj = (await tx<{ id: string; state: string }[]>`
            SELECT id, state FROM interview_journeys WHERE student_id = ${c.subject_student_id} AND badge_id = ${h.badge_id} FOR UPDATE`)[0];
          if (hj?.state === "ON_HOLD" || hj?.state === "PASSED") {
            if (hj.state === "PASSED") {
              await transitionJourney(tx, { journeyId: hj.id, action: "hold", reason: "Under review", actorUserId: o.actorUserId, patch: { hold_prev_state: "PASSED" }, payload });
            }
            await transitionJourney(tx, { journeyId: hj.id, action: "confirm_nullify", reason: "Badge nullified (a lower badge in the track was nullified)", actorUserId: o.actorUserId, payload });
          }
        }
      } else {
        await transitionJourney(tx, { journeyId: j.id, action: "confirm_close", reason: "Closed after review", actorUserId: o.actorUserId, payload });
      }
    }
    const r = c.booking_id || c.subject_student_id
      ? await tx`
          UPDATE interview_outcomes
          SET result = 'FAIL', feedback_to_student = ${CONFIRMED_FEEDBACK}, focus_areas = '[]'::jsonb,
              review_status = 'NONE', publish_at = LEAST(publish_at, app_now())
          WHERE review_status = 'WITHHELD' AND locked_at IS NULL
            AND (booking_id = ${c.booking_id}
                 -- Cases opened before migration 0007 have no booking link: use the student's held results.
                 OR (${c.booking_id}::uuid IS NULL AND booking_id IN (SELECT id FROM bookings WHERE student_id = ${c.subject_student_id})))`
      : { count: 0 };
    // This case's badges outside the nullified ones come back from review.
    await tx`UPDATE student_badges SET status = 'ACTIVE'
             WHERE student_id = ${c.subject_student_id} AND status = 'UNDER_REVIEW'
               AND (case_id = ${o.caseId} OR case_id IS NULL)`;
    await tx`UPDATE integrity_cases SET status = 'CONFIRMED', decided_by = ${o.actorUserId}, decided_at = app_now(),
                 decision = ${o.decision}, decision_note = ${note}
             WHERE id = ${o.caseId}`;
    return { heldJourneys: held.length, resultNotCleared: r.count > 0 };
  });
  await runTick();
  return res;
}
