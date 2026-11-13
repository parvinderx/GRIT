import { NextRequest } from "next/server";
import { sql } from "@/db";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { bookInterview } from "@/services/booking";

/** Book on a student's behalf, by time; the server assigns the interviewer (spec §6, §8). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "INTERVIEW_ADMIN", "PROGRAM_ADMIN");
    const idem = req.headers.get("Idempotency-Key");
    if (!idem) throw new ApiError(400, "IDEMPOTENCY_REQUIRED", "Idempotency-Key header is required.");
    const body = (await req.json().catch(() => ({}))) as { journey_id?: string; start_at?: string; reason?: string };
    if (!body.journey_id || !body.start_at) throw new ApiError(400, "BAD_REQUEST", "journey_id and start_at are required.");
    const reason = (body.reason ?? "").trim();
    if (reason.length < 10) throw new ApiError(422, "REASON_REQUIRED", "Give a reason of at least 10 characters.");
    const j = (await sql<{ student_id: string }[]>`SELECT student_id FROM interview_journeys WHERE id = ${body.journey_id}`)[0];
    if (!j) throw new ApiError(404, "NOT_FOUND", "Journey not found");
    const result = await bookInterview({
      userId: ctx.userId,
      studentId: j.student_id,
      journeyId: body.journey_id,
      startAtIso: body.start_at,
      idempotencyKey: idem,
      onBehalfReason: reason,
    });
    return apiOk(result);
  } catch (e) {
    return apiError(e);
  }
}
