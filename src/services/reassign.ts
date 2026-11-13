/**
 * Interviewer swaps and voids (spec §2 edge cases, §6 admin API, §5 I2).
 *  - swapInterviewer: same time, another qualified interviewer with an open seat.
 *    Staff can exclude interviewers, never choose one.
 *  - voidBooking: platform or interviewer fault. No attempt is used and the
 *    student gets a priority rebook; on the last two days before the deadline
 *    they are also protected from the deadline sweep for 10 days.
 * Callers run inside a transaction. Lock order: booking -> journey.
 */
import type { Sql, TransactionSql } from "postgres";
import { ApiError } from "@/lib/errors";
import { transitionJourney, logJourneyEvent } from "./journeys";

type Tx = Sql | TransactionSql;

export const PROTECTION_DAYS = 10;

interface LockedBooking {
  id: string;
  journey_id: string;
  student_id: string;
  slot_id: string;
  interviewer_id: string;
  start_at: Date;
  status: string;
  track_id: string;
  badge_level: number;
  journey_state: string;
}

export async function lockBooking(tx: Tx, bookingId: string): Promise<LockedBooking> {
  const b = (
    await tx<LockedBooking[]>`
      SELECT bk.id, bk.journey_id, bk.student_id, bk.slot_id, bk.interviewer_id, bk.start_at, bk.status,
             bd.track_id, bd.level badge_level, j.state journey_state
      FROM bookings bk
      JOIN interview_journeys j ON j.id = bk.journey_id
      JOIN badges bd ON bd.id = j.badge_id
      WHERE bk.id = ${bookingId}
      FOR UPDATE OF bk`
  )[0];
  if (!b) throw new ApiError(404, "NOT_FOUND", "Interview not found");
  await tx`SELECT 1 FROM interview_journeys WHERE id = ${b.journey_id} FOR UPDATE`;
  return b;
}

/**
 * Claim one OPEN, qualified, conflict-free slot at `startAt` for the given journey's
 * badge. Shared by book, reschedule, and swaps. `anyAudience` (swaps) ignores the
 * December seat pools: the student already holds a seat at this time.
 */
export async function claimSlot(
  tx: Tx,
  o: {
    startAt: Date;
    trackId: string;
    badgeLevel: number;
    studentId: string;
    noBadge: boolean;
    priority: boolean;
    excludeInterviewerIds?: string[];
    anyAudience?: boolean;
    requireBookable?: boolean;
  }
): Promise<{ id: string; interviewer_id: string } | null> {
  const exclude = o.excludeInterviewerIds ?? [];
  const anyAudience = o.anyAudience ?? false;
  const requireBookable = o.requireBookable ?? true;
  const rows = await tx<{ id: string; interviewer_id: string }[]>`
    UPDATE interview_slots SET status = 'BOOKED', version = version + 1
    WHERE id = (
      SELECT s.id
      FROM interview_slots s
      JOIN interviewers i ON i.id = s.interviewer_id AND i.active
      JOIN interviewer_tracks it
        ON it.interviewer_id = i.id AND it.track_id = ${o.trackId} AND it.max_badge_level >= ${o.badgeLevel}
      WHERE s.start_at = ${o.startAt} AND s.status = 'OPEN'
        AND (NOT ${requireBookable} OR s.bookable_from <= app_now())
        AND (${anyAudience} OR s.audience = 'ANY'
             OR (s.audience = 'DEADLINE' AND ${o.noBadge})
             OR (s.audience = 'PRIORITY' AND ${o.priority}))
        AND NOT (s.interviewer_id = ANY(${exclude}::uuid[]))
        AND NOT EXISTS (
          SELECT 1 FROM interviewer_conflicts c
          WHERE c.interviewer_id = i.id AND c.student_id = ${o.studentId}
        )
      ORDER BY i.last_assigned_at NULLS FIRST, random()
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, interviewer_id`;
  if (!rows[0]) return null;
  await tx`UPDATE interviewers SET last_assigned_at = app_now() WHERE id = ${rows[0].interviewer_id}`;
  return rows[0];
}

async function notifyInterviewer(tx: Tx, interviewerId: string, template: string, payload: Record<string, string>) {
  await tx`
    INSERT INTO notifications (user_id, channel, template, payload, created_at)
    SELECT user_id, 'IN_APP'::notification_channel, ${template}, ${tx.json(payload)}, app_now() FROM interviewers WHERE id = ${interviewerId}`;
}

export async function notifyAdmins(tx: Tx, template: string, payload: Record<string, string>) {
  await tx`
    INSERT INTO notifications (user_id, channel, template, payload, created_at)
    SELECT DISTINCT user_id, 'IN_APP'::notification_channel, ${template}, ${tx.json(payload)}, app_now()
    FROM user_roles WHERE role IN ('INTERVIEW_ADMIN','PROGRAM_ADMIN')`;
}

/**
 * Move a live booking to another interviewer at the same time. Returns the new
 * interviewer id, or null if nobody qualified is free (nothing changes then).
 * The current interviewer is always excluded. `freeOldSeat` puts their seat back
 * in the pool (admin rebalancing); otherwise it's withdrawn (they can't do it).
 */
export async function swapInterviewer(
  tx: Tx,
  bookingId: string,
  o: { excludeInterviewerIds?: string[]; reason: string; actorUserId: string | null; freeOldSeat?: boolean; action: string }
): Promise<string | null> {
  const b = await lockBooking(tx, bookingId);
  if (b.status !== "CONFIRMED" && b.status !== "IN_PROGRESS") {
    throw new ApiError(409, "BOOKING_NOT_ACTIVE", "This interview is no longer active.");
  }
  const noBadge = !(await tx<{ has: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM student_badges WHERE student_id = ${b.student_id} AND status = 'ACTIVE') has`)[0].has;
  const slot = await claimSlot(tx, {
    startAt: b.start_at,
    trackId: b.track_id,
    badgeLevel: b.badge_level,
    studentId: b.student_id,
    noBadge,
    priority: true,
    excludeInterviewerIds: [b.interviewer_id, ...(o.excludeInterviewerIds ?? [])],
    anyAudience: true,
    requireBookable: false,
  });
  if (!slot) return null;

  const freeOld = o.freeOldSeat === true; // past seats never reopen (start_at check below)
  await tx`
    UPDATE interview_slots
    SET status = CASE WHEN ${freeOld} AND start_at > app_now() THEN 'OPEN'::slot_status ELSE 'CANCELLED'::slot_status END,
        version = version + 1
    WHERE id = ${b.slot_id}`;
  await tx`
    UPDATE bookings SET slot_id = ${slot.id}, interviewer_id = ${slot.interviewer_id},
           interviewer_joined_at = NULL, updated_at = app_now()
    WHERE id = ${b.id}`;
  await logJourneyEvent(tx, {
    journeyId: b.journey_id,
    action: o.action,
    reason: o.reason,
    actorUserId: o.actorUserId,
    payload: { bookingId: b.id, from: b.interviewer_id, to: slot.interviewer_id },
  });
  await tx`INSERT INTO notifications (student_id, channel, template, payload, created_at)
           VALUES (${b.student_id}, 'IN_APP', 'INTERVIEWER_CHANGED', ${tx.json({ bookingId: b.id })}, app_now())`;
  await notifyInterviewer(tx, slot.interviewer_id, "INTERVIEW_ASSIGNED", { bookingId: b.id });
  await notifyInterviewer(tx, b.interviewer_id, "INTERVIEW_REMOVED", { bookingId: b.id });
  return slot.interviewer_id;
}

/**
 * Deadline protection (spec §2): an interview called off for our fault on the last
 * two days before the deadline keeps the student bookable until deadline + 10 days.
 */
export async function protectIfLastDays(tx: Tx, journeyId: string, startAt: Date): Promise<void> {
  await tx`
    UPDATE interview_journeys j
    SET deadline_protected_until = GREATEST(COALESCE(j.deadline_protected_until, s.deadline_at), s.deadline_at + make_interval(days => ${PROTECTION_DAYS})),
        version = j.version + 1
    FROM seasons s
    WHERE j.id = ${journeyId} AND s.id = j.season_id
      AND ${startAt}::timestamptz > s.deadline_at - interval '2 days'
      AND ${startAt}::timestamptz <= s.deadline_at`;
}

/** Void an interview for a platform or interviewer fault (no outcome may exist). */
export async function voidBooking(
  tx: Tx,
  bookingId: string,
  o: { fault: "PLATFORM" | "INTERVIEWER"; reason: string; actorUserId: string | null }
): Promise<void> {
  const b = await lockBooking(tx, bookingId);
  const live = b.status === "CONFIRMED" || b.status === "IN_PROGRESS";
  const awaiting = b.status === "COMPLETED" && b.journey_state === "AWAITING_RESULT";
  if (!live && !awaiting) throw new ApiError(409, "BOOKING_NOT_ACTIVE", "This interview can't be voided now.");
  const outcome = await tx`SELECT 1 FROM interview_outcomes WHERE booking_id = ${b.id}`;
  if (outcome.length) throw new ApiError(409, "OUTCOME_EXISTS", "An outcome is already recorded; change it through Approvals instead.");
  if (b.journey_state !== "BOOKED" && b.journey_state !== "AWAITING_RESULT") {
    throw new ApiError(409, "BOOKING_NOT_ACTIVE", "This interview can't be voided now.");
  }

  await tx`UPDATE bookings SET status = 'VOID', void_reason = ${o.fault}, updated_at = app_now() WHERE id = ${b.id}`;
  // A future seat goes back to the pool unless the interviewer is the problem.
  await tx`
    UPDATE interview_slots
    SET status = CASE WHEN start_at > app_now() AND ${o.fault} = 'PLATFORM' THEN 'OPEN'::slot_status ELSE 'CANCELLED'::slot_status END,
        version = version + 1
    WHERE id = ${b.slot_id}`;
  await transitionJourney(tx, {
    journeyId: b.journey_id,
    action: "interviewer_fault",
    reason: o.fault === "PLATFORM" ? "Interview called off (platform problem)" : "Interview called off (interviewer unavailable)",
    actorUserId: o.actorUserId,
    patch: { priority_rebook: true, cooldown_until: null },
    payload: { bookingId: b.id, fault: o.fault, note: o.reason },
  });
  await protectIfLastDays(tx, b.journey_id, b.start_at);
  await tx`INSERT INTO notifications (student_id, channel, template, payload, created_at)
           VALUES (${b.student_id}, 'IN_APP', 'INTERVIEW_CALLED_OFF', ${tx.json({ bookingId: b.id })}, app_now())`;
}
