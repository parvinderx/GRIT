import { sql } from "@/db";
import { serverNow } from "@/lib/clock";
import { ApiError } from "@/lib/errors";
import { FREE_CHANGES } from "@/lib/rules";

/** Booking statuses that are still a live interview the student can act on. */
export const ACTIVE_BOOKING_STATUSES = ["CONFIRMED", "IN_PROGRESS"] as const;
const CANCELLED_STATUSES = new Set(["CANCELLED", "CANCELLED_LATE", "VOID"]);

export type BookingWindowState = "scheduled" | "under12h" | "live" | "waiting" | "past" | "cancelled";

export interface BookingView {
  bookingId: string;
  journeyId: string;
  badgeName: string;
  startIso: string;
  status: string;
  bookingCode: string | null; // join window only
  interviewerFirstName: string | null; // join window only (T-10)
  joinOpensIso: string;
  graceEndsIso: string;
  changeCutoffIso: string;
  changesLeft: number;
  /** Time-based for live bookings; "cancelled" / "past" for any other status. */
  windowState: BookingWindowState;
  joinWindowOpen: boolean;
  serverNowIso: string;
}

export async function getBookingForStudent(bookingId: string, studentId: string): Promise<BookingView> {
  const now = await serverNow();
  const nowMs = now.getTime();

  const rules = (await sql<
    { change_cutoff_hours: number; join_open_minutes: number; join_grace_minutes: number }[]
  >`SELECT change_cutoff_hours, join_open_minutes, join_grace_minutes FROM season_rules LIMIT 1`)[0];

  const b = (
    await sql<
      {
        id: string;
        journey_id: string;
        start_at: Date;
        status: string;
        booking_code: string;
        interviewer_name: string | null;
        badge_name: string;
        track_name: string;
        changes_count: number;
      }[]
    >`
      SELECT bk.id, bk.journey_id, bk.start_at, bk.status, bk.booking_code,
             iv.display_name interviewer_name, b.name badge_name, t.name track_name,
             j.changes_count
      FROM bookings bk
      JOIN interview_journeys j ON j.id = bk.journey_id
      JOIN badges b ON b.id = j.badge_id
      JOIN tracks t ON t.id = b.track_id
      LEFT JOIN interviewers iv ON iv.id = bk.interviewer_id
      WHERE bk.id = ${bookingId} AND bk.student_id = ${studentId}`
  )[0];
  if (!b) throw new ApiError(404, "NOT_FOUND", "Booking not found");

  const startMs = b.start_at.getTime();
  const joinOpensMs = startMs - rules.join_open_minutes * 60_000;
  const graceEndsMs = startMs + rules.join_grace_minutes * 60_000;
  const cutoffMs = startMs - rules.change_cutoff_hours * 3_600_000;
  const active = (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(b.status);
  const joinWindowOpen = active && nowMs >= joinOpensMs && nowMs <= graceEndsMs;

  let windowState: BookingWindowState = "scheduled";
  if (!active) windowState = CANCELLED_STATUSES.has(b.status) ? "cancelled" : "past";
  else if (nowMs > graceEndsMs) windowState = "past";
  else if (joinWindowOpen) windowState = nowMs >= startMs + 5 * 60_000 ? "waiting" : "live";
  else if (nowMs >= cutoffMs) windowState = "under12h";

  return {
    bookingId: b.id,
    journeyId: b.journey_id,
    badgeName: `${b.track_name} · ${b.badge_name}`,
    startIso: b.start_at.toISOString(),
    status: b.status,
    // The student owns this code and types it to join, so it's always shown to them.
    bookingCode: b.booking_code,
    interviewerFirstName: joinWindowOpen && b.interviewer_name ? b.interviewer_name.split(" ")[0] : null,
    joinOpensIso: new Date(joinOpensMs).toISOString(),
    graceEndsIso: new Date(graceEndsMs).toISOString(),
    changeCutoffIso: new Date(cutoffMs).toISOString(),
    changesLeft: Math.max(0, FREE_CHANGES - b.changes_count),
    windowState,
    joinWindowOpen,
    serverNowIso: now.toISOString(),
  };
}
