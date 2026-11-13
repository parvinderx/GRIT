/**
 * Interviewer-side booking actions: marking that they joined the room, and
 * "I can't take this interview" (spec §5 I2).
 */
import { sql } from "@/db";
import { ApiError } from "@/lib/errors";
import { swapInterviewer, voidBooking, notifyAdmins } from "./reassign";

export const RELEASE_MIN_HOURS = 24;

/** The interviewer opened the room: record their presence (used by the T+15 attendance check). */
export async function interviewerJoin(o: { bookingId: string; interviewerId: string }): Promise<void> {
  const r = await sql`
    UPDATE bookings bk SET interviewer_joined_at = COALESCE(bk.interviewer_joined_at, app_now()), updated_at = app_now()
    FROM season_rules sr
    WHERE bk.id = ${o.bookingId} AND bk.interviewer_id = ${o.interviewerId}
      AND bk.status IN ('CONFIRMED','IN_PROGRESS')
      AND app_now() >= bk.start_at - make_interval(mins => sr.join_open_minutes)`;
  if (r.count === 0) {
    const owned = await sql`SELECT 1 FROM bookings WHERE id = ${o.bookingId} AND interviewer_id = ${o.interviewerId}`;
    if (!owned.length) throw new ApiError(404, "NOT_FOUND", "Interview not found");
    // Too early or already over: nothing to record, not an error for the room page.
  }
}

export type ReleaseResult = "SWAPPED" | "CALLED_OFF" | "SENT_TO_TEAM";

/**
 * "I can't take this interview". At least 24 h before: hand it to someone free at
 * the same time, or, if nobody is, call it off with a priority rebook for the
 * student. Under 24 h: the interview team is alerted and decides (they try a
 * same-time swap first).
 */
export async function releaseInterview(o: { bookingId: string; interviewerId: string; userId: string; reason: string }): Promise<ReleaseResult> {
  const reason = o.reason.trim();
  if (reason.length < 10) throw new ApiError(422, "REASON_REQUIRED", "Tell the team briefly why (at least 10 characters).");
  return sql.begin(async (tx) => {
    const b = (await tx<{ status: string; early: boolean; student_id: string }[]>`
      SELECT bk.status, (bk.start_at - app_now() >= make_interval(hours => ${RELEASE_MIN_HOURS})) early, bk.student_id
      FROM bookings bk WHERE bk.id = ${o.bookingId} AND bk.interviewer_id = ${o.interviewerId} FOR UPDATE`)[0];
    if (!b) throw new ApiError(404, "NOT_FOUND", "Interview not found");
    if (b.status !== "CONFIRMED") throw new ApiError(409, "BOOKING_NOT_ACTIVE", "This interview is no longer upcoming.");
    if (!b.early) {
      await notifyAdmins(tx, "INTERVIEWER_CANT_TAKE", { bookingId: o.bookingId, reason });
      return "SENT_TO_TEAM";
    }
    const to = await swapInterviewer(tx, o.bookingId, { reason, actorUserId: o.userId, action: "interviewer_release" });
    if (to) return "SWAPPED";
    await voidBooking(tx, o.bookingId, { fault: "INTERVIEWER", reason, actorUserId: o.userId });
    return "CALLED_OFF";
  });
}
