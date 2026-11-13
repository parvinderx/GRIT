import { NextRequest } from "next/server";
import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { reportInterviewerAbsent } from "@/services/bookingReports";

/** "Interviewer hasn't joined" — available from T+5, alerts the team. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    if (!ctx.studentId) throw new ApiError(403, "FORBIDDEN", "Students only.");
    const { id } = await params;
    const r = await reportInterviewerAbsent({ bookingId: id, studentId: ctx.studentId });
    return apiOk({
      ok: true,
      swapped: r.swapped,
      message: r.swapped
        ? "A new interviewer is joining. Stay on this page."
        : "We've alerted the interview team. Stay on this page. If nobody can join by 15 minutes past the start, the interview is called off and you get a priority rebook. It won't count as an attempt.",
    });
  } catch (e) {
    return apiError(e);
  }
}
