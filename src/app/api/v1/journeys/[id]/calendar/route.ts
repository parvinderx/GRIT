import { NextRequest } from "next/server";
import { sql } from "@/db";
import { getCtx } from "@/lib/auth";
import { ApiError, textError } from "@/lib/api";
import { buildIcs } from "@/lib/ics";
import { serverNow } from "@/lib/clock";
import { formatIST } from "@/lib/time";

/**
 * "Add reminder to calendar": a .ics event at the moment the student's next
 * attempt opens (interview_journeys.cooldown_until, shown in IST). Only for the
 * student's own journey, and only while a cooldown date is set — 404 otherwise.
 * Nothing is stored server-side; the reminder lives in the student's calendar.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCtx();
    if (!ctx?.studentId) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to GRIT to add this reminder to your calendar.");
    const { id } = await params;

    const j = (
      await sql<{ id: string; badge_name: string; cooldown_until: Date | null }[]>`
        SELECT j.id, (t.name || ' · ' || b.name) badge_name, j.cooldown_until
        FROM interview_journeys j
        JOIN badges b ON b.id = j.badge_id
        JOIN tracks t ON t.id = b.track_id
        WHERE j.id = ${id} AND j.student_id = ${ctx.studentId}`
    )[0];
    if (!j || !j.cooldown_until) throw new ApiError(404, "NOT_FOUND", "There's no upcoming date to add for this badge.");

    const now = await serverNow();
    const opensIso = j.cooldown_until.toISOString();
    const ics = buildIcs({
      uid: `journey-${j.id}-opens-${j.cooldown_until.getTime()}@grit`,
      title: `GRIT: book your ${j.badge_name} interview`,
      description: `Your next ${j.badge_name} interview can be booked from ${formatIST(opensIso)}. Book a time from your GRIT dashboard.`,
      location: "GRIT dashboard",
      startIso: opensIso,
      durationMinutes: 30,
      stampIso: now.toISOString(),
    });

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="grit-book-${j.id}.ics"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return textError(e);
  }
}
