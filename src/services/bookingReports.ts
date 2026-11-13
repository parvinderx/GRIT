/**
 * Things a student reports about a booked interview. Used by the API routes and
 * the demo story, so the rules live in one place.
 */
import { sql } from "@/db";
import { ApiError } from "@/lib/errors";
import { swapInterviewer, notifyAdmins } from "./reassign";

export const EMERGENCY_MAX_OPEN = 1;
export const EMERGENCY_MAX_PER_SEASON = 2;

/** Report an emergency inside the emergency window (< 12 h before the start). Files an EMERGENCY_WAIVER approval. */
export async function reportEmergency(o: { bookingId: string; studentId: string; userId: string; reason: string }): Promise<void> {
  const reason = o.reason.trim();
  if (reason.length < 10) throw new ApiError(422, "REASON_REQUIRED", "Tell us briefly what happened (at least 10 characters).");
  if (reason.length > 1000) throw new ApiError(422, "REASON_TOO_LONG", "Keep it under 1,000 characters.");

  const b = (
    await sql<{ journey_id: string; status: string; ok: boolean }[]>`
      SELECT bk.journey_id, bk.status,
             (app_now() >= bk.start_at - make_interval(hours => sr.emergency_cutoff_hours) AND app_now() < bk.start_at) AS ok
      FROM bookings bk CROSS JOIN season_rules sr
      WHERE bk.id = ${o.bookingId} AND bk.student_id = ${o.studentId}`
  )[0];
  if (!b) throw new ApiError(404, "NOT_FOUND", "Booking not found");
  if (b.status !== "CONFIRMED") throw new ApiError(409, "BOOKING_NOT_ACTIVE", "This booking is no longer active.");
  if (!b.ok) throw new ApiError(422, "NOT_IN_WINDOW", "Emergencies can only be reported close to the start.");
  // One transaction, serialised per student, so two reports at once can't both pass the limits.
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"emergency:" + o.studentId}))`;
    const dup = (await tx<{ id: string }[]>`
      SELECT id FROM approvals
      WHERE action = 'EMERGENCY_WAIVER' AND status = 'PENDING' AND journey_id = ${b.journey_id}
        AND payload->>'bookingId' = ${o.bookingId}
      LIMIT 1`)[0];
    if (dup) throw new ApiError(409, "ALREADY_REPORTED", "You've already reported an emergency for this interview. The team will decide within 1 working day.");
    // Spec section 6: at most 1 open and 2 per season.
    const counts = (await tx<{ open: number; season: number }[]>`
      SELECT count(*) FILTER (WHERE a.status = 'PENDING')::int open,
             count(*) FILTER (WHERE a.status IN ('PENDING','APPROVED'))::int season
      FROM approvals a JOIN interview_journeys j ON j.id = a.journey_id
      WHERE a.action = 'EMERGENCY_WAIVER' AND j.student_id = ${o.studentId}
        AND j.season_id = (SELECT season_id FROM interview_journeys WHERE id = ${b.journey_id})`)[0];
    if (counts.open >= EMERGENCY_MAX_OPEN) {
      throw new ApiError(409, "EMERGENCY_OPEN", "You already have an emergency report waiting for a decision. The team will decide within 1 working day.");
    }
    if (counts.season >= EMERGENCY_MAX_PER_SEASON) {
      throw new ApiError(409, "EMERGENCY_LIMIT", `You've used the ${EMERGENCY_MAX_PER_SEASON} emergency reports allowed this season. Contact GRIT support if something has happened.`);
    }

    await tx`
      INSERT INTO approvals (action, requested_by, journey_id, reason, payload)
      VALUES ('EMERGENCY_WAIVER', ${o.userId}, ${b.journey_id}, ${reason}, ${tx.json({ bookingId: o.bookingId })})`;
    await tx`
      INSERT INTO notifications (student_id, channel, template, payload)
      VALUES (${o.studentId}, 'IN_APP', 'EMERGENCY_RECEIVED', ${tx.json({ bookingId: o.bookingId })})`;
  });
}

/**
 * "Interviewer hasn't joined": available from T+5. Records the report, alerts the
 * interview team, and tries to swap in someone free at the same time straight away.
 * If nobody is, the T+15 attendance check calls the interview off with a priority
 * rebook (services/jobs.ts).
 */
export async function reportInterviewerAbsent(o: { bookingId: string; studentId: string }): Promise<{ swapped: boolean }> {
  return sql.begin(async (tx) => {
    const b = (
      await tx<{ status: string; ok: boolean; iv_joined: boolean }[]>`
        SELECT bk.status, (app_now() >= bk.start_at + make_interval(mins => sr.interviewer_absent_minutes)) AS ok,
               (bk.interviewer_joined_at IS NOT NULL) iv_joined
        FROM bookings bk CROSS JOIN season_rules sr
        WHERE bk.id = ${o.bookingId} AND bk.student_id = ${o.studentId}
        FOR UPDATE OF bk`
    )[0];
    if (!b) throw new ApiError(404, "NOT_FOUND", "Booking not found");
    if (b.status !== "CONFIRMED" && b.status !== "IN_PROGRESS") {
      throw new ApiError(409, "BOOKING_NOT_ACTIVE", "This booking is no longer active.");
    }
    if (!b.ok) throw new ApiError(422, "TOO_EARLY", "You can report this from 5 minutes after the start.");
    await tx`UPDATE bookings SET absent_reported_at = COALESCE(absent_reported_at, app_now()) WHERE id = ${o.bookingId}`;
    await tx`
      INSERT INTO notifications (student_id, channel, template, payload, created_at)
      VALUES (${o.studentId}, 'IN_APP', 'INTERVIEWER_ABSENT', ${tx.json({ bookingId: o.bookingId })}, app_now())`;
    await notifyAdmins(tx, "INTERVIEWER_ABSENT_REPORTED", { bookingId: o.bookingId });
    if (b.iv_joined) return { swapped: false };
    const to = await swapInterviewer(tx, o.bookingId, {
      reason: "Interviewer hadn't joined; swapped in someone free at the same time",
      actorUserId: null,
      action: "absent_swap",
    });
    return { swapped: !!to };
  });
}
