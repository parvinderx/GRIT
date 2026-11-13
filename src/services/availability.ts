import { sql } from "@/db";
import { ApiError } from "@/lib/errors";

export interface SlotTime {
  startAt: string;
  count: number; // capped at 5 ("5+") by the UI
}

export interface AvailableTimesOptions {
  /** Picking a new time for an existing booking: the server only accepts starts
   *  at least season_rules.change_cutoff_hours from now (services/booking.rescheduleBooking). */
  forReschedule?: boolean;
  /** A start time to leave out (the booking's current start). */
  excludeIso?: string | null;
}

/**
 * Open, bookable, qualified start times for a journey — aggregated across
 * interviewers (names never leak). One row per start time with a seat count.
 */
export async function getAvailableTimes(journeyId: string, studentId: string, opts: AvailableTimesOptions = {}) {
  const jrows = await sql<
    { track_id: string; badge_level: number; priority_rebook: boolean; state: string }[]
  >`
    SELECT b.track_id, b.level AS badge_level, j.priority_rebook, j.state
    FROM interview_journeys j JOIN badges b ON b.id = j.badge_id
    WHERE j.id = ${journeyId} AND j.student_id = ${studentId}`;
  const j = jrows[0];
  if (!j) throw new ApiError(404, "NOT_FOUND", "Journey not found");

  const noBadgeRow = await sql<{ has: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM student_badges WHERE student_id = ${studentId} AND status='ACTIVE') AS has`;
  const noBadge = !noBadgeRow[0].has;

  const rules = (await sql<{ booking_cutoff_hours: number; priority_booking_cutoff_hours: number; change_cutoff_hours: number }[]>`
    SELECT booking_cutoff_hours, priority_booking_cutoff_hours, change_cutoff_hours FROM season_rules LIMIT 1`)[0];
  const bookCutoffH = j.priority_rebook ? rules.priority_booking_cutoff_hours : rules.booking_cutoff_hours;
  const cutoffH = opts.forReschedule ? Math.max(bookCutoffH, rules.change_cutoff_hours) : bookCutoffH;
  const exclude = opts.excludeIso ? new Date(opts.excludeIso) : null;
  const excludeAt = exclude && !isNaN(exclude.getTime()) ? exclude : null;

  const rows = await sql<{ start_at: Date; count: number }[]>`
    SELECT s.start_at, count(*)::int AS count
    FROM interview_slots s
    JOIN interviewers i ON i.id = s.interviewer_id AND i.active
    JOIN interviewer_tracks it
      ON it.interviewer_id = i.id AND it.track_id = ${j.track_id} AND it.max_badge_level >= ${j.badge_level}
    WHERE s.status = 'OPEN'
      AND s.bookable_from <= app_now()
      AND s.start_at >= app_now() + make_interval(hours => ${cutoffH})
      AND (${excludeAt}::timestamptz IS NULL OR s.start_at <> ${excludeAt}::timestamptz)
      AND (s.audience = 'ANY'
           OR (s.audience = 'DEADLINE' AND ${noBadge})
           OR (s.audience = 'PRIORITY' AND ${j.priority_rebook}))
      AND NOT EXISTS (
        SELECT 1 FROM interviewer_conflicts c WHERE c.interviewer_id = i.id AND c.student_id = ${studentId}
      )
    GROUP BY s.start_at
    ORDER BY s.start_at`;

  return {
    times: rows.map((r) => ({ startAt: r.start_at.toISOString(), count: Math.min(r.count, 5) })) as SlotTime[],
    canBook: j.state === "ELIGIBLE",
  };
}
