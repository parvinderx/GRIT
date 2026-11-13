import { NextRequest } from "next/server";
import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { cancelBooking } from "@/services/booking";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    if (!ctx.studentId) throw new ApiError(403, "FORBIDDEN", "Students only.");
    const { id } = await params;
    const result = await cancelBooking({ userId: ctx.userId, studentId: ctx.studentId, bookingId: id });
    return apiOk(result);
  } catch (e) {
    return apiError(e);
  }
}
