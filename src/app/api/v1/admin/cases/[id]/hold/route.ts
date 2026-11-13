import { NextRequest } from "next/server";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { isUuid } from "@/lib/ids";
import { holdCase } from "@/services/integrity";

/**
 * Move a case from triage to under review: the student's journeys go on hold
 * (a booked interview or pending result carries on) and their badges go under
 * review with Miles frozen.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "PROGRAM_ADMIN");
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError(404, "NOT_FOUND", "Case not found");
    const { held } = await holdCase({ caseId: id, actorUserId: ctx.userId });
    const message =
      held === 0
        ? "Case moved to under review. No journey was in a state that can be put on hold."
        : `Case moved to under review. ${held} ${held === 1 ? "journey" : "journeys"} put on hold; badges are under review.`;
    return apiOk({ ok: true, held, message });
  } catch (e) {
    return apiError(e);
  }
}
