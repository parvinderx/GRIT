import { NextRequest } from "next/server";
import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { reportEmergency } from "@/services/bookingReports";

/** Report an emergency (<12 h before start). Goes to the team as a waiver request. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    if (!ctx.studentId) throw new ApiError(403, "FORBIDDEN", "Students only.");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    await reportEmergency({ bookingId: id, studentId: ctx.studentId, userId: ctx.userId, reason: typeof body.reason === "string" ? body.reason : "" });
    return apiOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
