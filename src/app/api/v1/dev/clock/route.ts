import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, sql } from "@/db";
import { bookings } from "@/db/schema";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { DateTime } from "luxon";
import { env, IST } from "@/lib/env";
import { getCtx } from "@/lib/auth";
import { getClock, serverNow, setClockAbsolute, advanceClock, setClockReal } from "@/lib/clock";
import { runTick } from "@/services/jobs";

function guard() {
  if (!env.devTools) throw new ApiError(404, "NOT_FOUND", "Not found");
}

const NAMED: Record<string, string> = {
  deadline: "2026-12-31T23:00:00+05:30",
  "new-year": "2027-01-01T00:05:00+05:30",
};

/** Furthest a single jump may go, so a typo can't throw the demo years ahead. */
const MAX_JUMP_DAYS = 120;

type NextInterview = {
  id: string;
  startAt: string;
  studentName: string;
  interviewerName: string;
  /** "yours" when it belongs to the person you're viewing as, else the earliest one anyone has. */
  scope: "yours" | "anyone";
};

/**
 * The next interview that hasn't finished yet (booked or in progress, start within the last
 * 40 minutes or later). Prefers the one belonging to whoever you're viewing as.
 */
async function nextInterview(): Promise<NextInterview | null> {
  const ctx = await getCtx().catch(() => null);
  const rows = await sql<
    { id: string; start_at: Date; student_name: string; interviewer_name: string; student_id: string; interviewer_id: string }[]
  >`
    SELECT bk.id, bk.start_at, su.display_name student_name, iu.display_name interviewer_name, bk.student_id, bk.interviewer_id
    FROM bookings bk
    JOIN students s ON s.id = bk.student_id
    JOIN users su ON su.id = s.user_id
    JOIN interviewers iv ON iv.id = bk.interviewer_id
    JOIN users iu ON iu.id = iv.user_id
    WHERE bk.status IN ('CONFIRMED','IN_PROGRESS') AND bk.start_at > app_now() - interval '40 minutes'
    ORDER BY bk.start_at
    LIMIT 200`;
  const mine = rows.find(
    (r) => (ctx?.studentId && r.student_id === ctx.studentId) || (ctx?.interviewerId && r.interviewer_id === ctx.interviewerId)
  );
  const r = mine ?? rows[0];
  if (!r) return null;
  return {
    id: r.id,
    startAt: r.start_at.toISOString(),
    studentName: r.student_name,
    interviewerName: r.interviewer_name,
    scope: mine ? "yours" : "anyone",
  };
}

export async function GET() {
  try {
    guard();
    const [clock, next, rules] = await Promise.all([
      getClock(),
      nextInterview(),
      sql<{ join_open_minutes: number; attendance_check_minutes: number; slot_duration_minutes: number }[]>`
        SELECT join_open_minutes, attendance_check_minutes, slot_duration_minutes FROM season_rules LIMIT 1`,
    ]);
    const r = rules[0];
    return apiOk({
      clock,
      nextInterview: next,
      rules: {
        joinOpenMinutes: r?.join_open_minutes ?? 10,
        attendanceCheckMinutes: r?.attendance_check_minutes ?? 15,
        slotDurationMinutes: r?.slot_duration_minutes ?? 40,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * Body: { real: true } (back to real time) | { set?: ISO } | { advanceSeconds?: n }
 *       | { named?: "reset"|"deadline"|"new-year"|"after-deadline" }   // reset = real time
 *       | { relativeToBookingId: id, minutes: n }   // e.g. minutes -10 for T-10, 10, 15
 *       | { relativeToNextInterview: true, minutes: n }  // same, for the next interview (see nextInterview())
 * Optional: { runJobs?: boolean } to fire the job tick after moving the clock (alone: just run the jobs).
 * Jumps only go forward (except back to real time); after any jump the clock keeps running.
 */
export async function POST(req: NextRequest) {
  try {
    guard();
    const body = (await req.json().catch(() => ({}))) as {
      set?: string;
      advanceSeconds?: number;
      named?: string;
      relativeToBookingId?: string;
      relativeToNextInterview?: boolean;
      minutes?: number;
      runJobs?: boolean;
      real?: boolean;
    };

    const now = await serverNow();
    /** Jump to `target`, refusing to go backwards or absurdly far. */
    const jumpTo = async (target: Date) => {
      if (Number.isNaN(target.getTime())) throw new ApiError(400, "BAD_REQUEST", "That isn't a valid date and time.");
      if (target.getTime() < now.getTime() - 1000) {
        throw new ApiError(
          409,
          "CLOCK_BACKWARDS",
          "That moment is already in the past for the app. Time only moves forward in the demo (use \"Back to real time\" to start over from today)."
        );
      }
      if (target.getTime() - now.getTime() > MAX_JUMP_DAYS * 86_400_000) {
        throw new ApiError(400, "BAD_REQUEST", `That's more than ${MAX_JUMP_DAYS} days ahead. Pick a closer moment.`);
      }
      await setClockAbsolute(target.toISOString());
    };

    let jumpedTo: NextInterview | null = null;

    if (body.real === true || body.named === "reset") {
      await setClockReal();
    } else if (body.set) {
      // A bare "2026-12-01T15:30" (from a date-time picker) means India time.
      await jumpTo(DateTime.fromISO(body.set, { zone: IST }).toJSDate());
    } else if (typeof body.advanceSeconds === "number") {
      if (body.advanceSeconds <= 0) throw new ApiError(400, "BAD_REQUEST", "Time only moves forward in the demo.");
      if (body.advanceSeconds > MAX_JUMP_DAYS * 86_400) throw new ApiError(400, "BAD_REQUEST", `That's more than ${MAX_JUMP_DAYS} days ahead.`);
      await advanceClock(body.advanceSeconds);
    } else if (body.named === "after-deadline") {
      // Five minutes past the season's real deadline, so the deadline sweep actually fires.
      const s = (await sql<{ deadline_at: Date }[]>`SELECT deadline_at FROM seasons ORDER BY deadline_at DESC LIMIT 1`)[0];
      if (!s) throw new ApiError(404, "NOT_FOUND", "No season");
      await jumpTo(new Date(s.deadline_at.getTime() + 5 * 60_000));
    } else if (body.named && NAMED[body.named]) {
      await jumpTo(new Date(NAMED[body.named]));
    } else if (body.relativeToNextInterview && typeof body.minutes === "number") {
      jumpedTo = await nextInterview();
      if (!jumpedTo) throw new ApiError(404, "NO_INTERVIEW", "There's no upcoming interview to jump to. Book one first.");
      await jumpTo(new Date(new Date(jumpedTo.startAt).getTime() + body.minutes * 60_000));
    } else if (body.relativeToBookingId && typeof body.minutes === "number") {
      const b = await db
        .select({ startAt: bookings.startAt })
        .from(bookings)
        .where(eq(bookings.id, body.relativeToBookingId))
        .limit(1);
      if (!b[0]) throw new ApiError(404, "NOT_FOUND", "No such booking");
      await jumpTo(new Date(b[0].startAt.getTime() + body.minutes * 60_000));
    } else if (!body.runJobs) {
      throw new ApiError(400, "BAD_REQUEST", "Provide real, set, advanceSeconds, named, relativeToNextInterview+minutes or relativeToBookingId+minutes");
    }

    const jobs = body.runJobs ? await runTick() : undefined;
    const after = await serverNow();
    return apiOk({ ok: true, now: after.toISOString(), jobs, interview: jumpedTo });
  } catch (e) {
    return apiError(e);
  }
}
