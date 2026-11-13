import { NextRequest } from "next/server";
import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { bookInterview } from "@/services/booking";
import { checkBookingRate, isReplay } from "@/services/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCtx();
    if (!ctx.studentId) throw new ApiError(403, "FORBIDDEN", "Students only.");
    const idem = req.headers.get("Idempotency-Key");
    if (!idem) throw new ApiError(400, "IDEMPOTENCY_REQUIRED", "Idempotency-Key header is required.");
    const body = (await req.json().catch(() => ({}))) as { journey_id?: string; start_at?: string };
    if (!body.journey_id || !body.start_at)
      throw new ApiError(400, "BAD_REQUEST", "journey_id and start_at are required.");

    if (!(await isReplay(ctx.userId, idem))) await checkBookingRate(ctx.userId, "book");

    const result = await bookInterview({
      userId: ctx.userId,
      studentId: ctx.studentId,
      journeyId: body.journey_id,
      startAtIso: body.start_at,
      idempotencyKey: idem,
    });
    return apiOk(result, 200);
  } catch (e) {
    return apiError(e);
  }
}
