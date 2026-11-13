import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { interviewerJoin } from "@/services/interviewerBooking";

/** The interviewer opened the interview room. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    if (!ctx.interviewerId) throw new ApiError(403, "FORBIDDEN", "Interviewers only.");
    const { id } = await params;
    await interviewerJoin({ bookingId: id, interviewerId: ctx.interviewerId });
    return apiOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
