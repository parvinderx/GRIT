import { sql } from "@/db";
import { ApiError } from "@/lib/errors";

export interface JoinResult {
  joined: true;
  interviewerFirstName: string | null;
  bookingCode: string;
}

/** Rejoin after a dropped connection: allowed until this many minutes after the scheduled end. */
export const REJOIN_AFTER_END_MINUTES = 15;

/**
 * The signed-in student joins their own interview. There's nothing to type: the
 * booking code is shown to them to read out to the interviewer, and joining from
 * the account that owns the booking marks it verified (the interviewer's face check
 * and the spoken code are the identity checks that matter).
 */
export async function studentJoin(bookingId: string, studentId: string): Promise<JoinResult> {
  const row = (
    await sql<{ start_at: Date; status: string; interviewer_name: string | null; code: string; open: boolean; rejoin: boolean }[]>`
      SELECT bk.start_at, bk.status, iv.display_name interviewer_name, bk.booking_code code,
             (app_now() >= bk.start_at - make_interval(mins => sr.join_open_minutes)
              AND app_now() <= bk.start_at + make_interval(mins => sr.join_grace_minutes)) AS open,
             -- Spec section 6: after a first join, rejoin is allowed until 15 min after the scheduled end.
             (bk.student_joined_at IS NOT NULL
              AND app_now() <= bk.start_at + make_interval(mins => sr.slot_duration_minutes + ${REJOIN_AFTER_END_MINUTES})) AS rejoin
      FROM bookings bk
      JOIN interviewers iv ON iv.id = bk.interviewer_id
      CROSS JOIN season_rules sr
      WHERE bk.id = ${bookingId} AND bk.student_id = ${studentId}`
  )[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Booking not found");
  // A rejoin can come after the attendance check marked the interview COMPLETED.
  const activeForRejoin = row.rejoin && row.status === "COMPLETED";
  if (row.status !== "CONFIRMED" && row.status !== "IN_PROGRESS" && !activeForRejoin) {
    throw new ApiError(409, "BOOKING_NOT_ACTIVE", "This booking is no longer active, so it can't be joined.");
  }
  if (!row.open && !row.rejoin) throw new ApiError(422, "JOIN_CLOSED", "The join window isn't open.");

  await sql`
    UPDATE bookings
    SET student_joined_at = COALESCE(student_joined_at, app_now()),
        code_verified_at = COALESCE(code_verified_at, app_now()),
        updated_at = app_now()
    WHERE id = ${bookingId} AND status IN ('CONFIRMED','IN_PROGRESS','COMPLETED')`;
  return {
    joined: true,
    interviewerFirstName: row.interviewer_name?.split(" ")[0] ?? null,
    bookingCode: row.code,
  };
}
