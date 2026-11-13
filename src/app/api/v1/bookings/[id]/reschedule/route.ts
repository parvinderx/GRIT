import { NextRequest } from "next/server";
import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { rescheduleBooking } from "@/services/booking";
import { checkBookingRate } from "@/services/rateLimit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    if (!ctx.studentId) throw new ApiError(403, "FORBIDDEN", "Students only.");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { start_at?: string };
    if (!body.start_at) throw new ApiError(400, "BAD_REQUEST", "start_at is required.");
    await checkBookingRate(ctx.userId, "reschedule");
    const result = await rescheduleBooking({
      userId: ctx.userId,
      studentId: ctx.studentId,
      bookingId: id,
      newStartIso: body.start_at,
    });
    return apiOk(result);
  } catch (e) {
    return apiError(e);
  }
}
