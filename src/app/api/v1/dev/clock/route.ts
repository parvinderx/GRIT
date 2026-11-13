import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, sql } from "@/db";
import { bookings } from "@/db/schema";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { getClock, serverNow, setClockAbsolute, advanceClock, setClockReal } from "@/lib/clock";
import { runTick } from "@/services/jobs";

function guard() {
  if (!env.devTools) throw new ApiError(404, "NOT_FOUND", "Not found");
}

const NAMED: Record<string, string> = {
  deadline: "2026-12-31T23:00:00+05:30",
  "new-year": "2027-01-01T00:05:00+05:30",
};

export async function GET() {
  try {
    guard();
    const clock = await getClock();
    return apiOk({ clock });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * Body: { real: true } (back to real time) | { set?: ISO } | { advanceSeconds?: n }
 *       | { named?: "reset"|"deadline"|"new-year"|"after-deadline" }   // reset = real time
 *       | { relativeToBookingId: id, minutes: n }   // e.g. minutes -10 for T-10, 10, 15
 * Optional: { runJobs?: boolean } to fire the job tick after moving the clock (alone: just run the jobs).
 */
export async function POST(req: NextRequest) {
  try {
    guard();
    const body = (await req.json().catch(() => ({}))) as {
      set?: string;
      advanceSeconds?: number;
      named?: string;
      relativeToBookingId?: string;
      minutes?: number;
      runJobs?: boolean;
      real?: boolean;
    };

    if (body.real === true || body.named === "reset") {
      await setClockReal();
    } else if (body.set) {
      await setClockAbsolute(body.set);
    } else if (typeof body.advanceSeconds === "number") {
      await advanceClock(body.advanceSeconds);
    } else if (body.named === "after-deadline") {
      // Five minutes past the season's real deadline, so the deadline sweep actually fires.
      const s = (await sql<{ deadline_at: Date }[]>`SELECT deadline_at FROM seasons ORDER BY deadline_at DESC LIMIT 1`)[0];
      if (!s) throw new ApiError(404, "NOT_FOUND", "No season");
      await setClockAbsolute(new Date(s.deadline_at.getTime() + 5 * 60_000).toISOString());
    } else if (body.named && NAMED[body.named]) {
      await setClockAbsolute(NAMED[body.named]);
    } else if (body.relativeToBookingId && typeof body.minutes === "number") {
      const b = await db
        .select({ startAt: bookings.startAt })
        .from(bookings)
        .where(eq(bookings.id, body.relativeToBookingId))
        .limit(1);
      if (!b[0]) throw new ApiError(404, "NOT_FOUND", "No such booking");
      const target = new Date(b[0].startAt.getTime() + body.minutes * 60_000);
      await setClockAbsolute(target.toISOString());
    } else if (!body.runJobs) {
      throw new ApiError(400, "BAD_REQUEST", "Provide real, set, advanceSeconds, named, or relativeToBookingId+minutes");
    }

    const jobs = body.runJobs ? await runTick() : undefined;
    const now = await serverNow();
    return apiOk({ ok: true, now: now.toISOString(), jobs });
  } catch (e) {
    return apiError(e);
  }
}
