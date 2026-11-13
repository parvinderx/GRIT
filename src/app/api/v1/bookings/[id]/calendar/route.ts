import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { ApiError, textError } from "@/lib/api";
import { getBookingForStudent } from "@/services/bookingView";
import { buildIcs } from "@/lib/ics";
import { serverNow } from "@/lib/clock";
import { formatIST, timeOnly } from "@/lib/time";

const SEASON_RULES = { durationMinutes: 30 };

/** Download a .ics for this student's interview. Served as a file attachment.
 *  Only live bookings (CONFIRMED / IN_PROGRESS); errors are plain text, not JSON,
 *  because the dashboard links here with <a download>. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCtx();
    if (!ctx?.studentId) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to GRIT to add this interview to your calendar.");
    const { id } = await params;
    const b = await getBookingForStudent(id, ctx.studentId);
    if (b.status !== "CONFIRMED" && b.status !== "IN_PROGRESS") {
      throw new ApiError(409, "BOOKING_NOT_ACTIVE", "This booking is no longer active, so there's nothing to add to your calendar.");
    }
    const now = await serverNow();

    const ics = buildIcs({
      uid: `booking-${b.bookingId}@grit`,
      title: `GRIT Interview · ${b.badgeName}`,
      description:
        `Your Level Clearance Interview for ${b.badgeName} at ${formatIST(b.startIso)}. ` +
        `Join from your GRIT interview page from ${timeOnly(b.joinOpensIso)}. Your booking code is ${b.bookingCode}: read it out to your interviewer. Keep your college ID ready.`,
      location: "GRIT — online (join from your interview page)",
      startIso: b.startIso,
      durationMinutes: SEASON_RULES.durationMinutes,
      stampIso: now.toISOString(),
    });

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="grit-interview-${b.bookingId}.ics"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return textError(e);
  }
}
