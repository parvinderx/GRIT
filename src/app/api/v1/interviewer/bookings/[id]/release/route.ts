import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { releaseInterview } from "@/services/interviewerBooking";

const MESSAGE = {
  SWAPPED: "Done. Another interviewer has taken it, and the student has been told.",
  CALLED_OFF: "Nobody else is free then, so the interview is called off. The student gets a priority rebook and loses nothing.",
  SENT_TO_TEAM: "It's under 24 hours, so the interview team has been alerted. They'll try to find someone else; until they confirm, it's still yours.",
};

/** "I can't take this interview". */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    if (!ctx.interviewerId) throw new ApiError(403, "FORBIDDEN", "Interviewers only.");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    const result = await releaseInterview({ bookingId: id, interviewerId: ctx.interviewerId, userId: ctx.userId, reason: body.reason ?? "" });
    return apiOk({ ok: true, result, message: MESSAGE[result] });
  } catch (e) {
    return apiError(e);
  }
}
