import { NextRequest } from "next/server";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { isUuid } from "@/lib/ids";
import { confirmCase } from "@/services/integrity";

/** Confirm the case (decider ≠ opener, typed GRIT ID, note ≥ 50 chars). Journeys on hold:
 *  nullify an earned badge, else close. A held interview result counts as Not cleared. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "PROGRAM_ADMIN");
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError(404, "NOT_FOUND", "Case not found");
    const body = (await req.json().catch(() => ({}))) as { decision?: unknown; note?: unknown; confirmId?: unknown };
    if (body.decision !== "nullify" && body.decision !== "disqualify") {
      throw new ApiError(422, "BAD_DECISION", "Choose nullify or disqualify.");
    }
    const res = await confirmCase({
      caseId: id,
      actorUserId: ctx.userId,
      decision: body.decision,
      note: typeof body.note === "string" ? body.note : "",
      confirmId: typeof body.confirmId === "string" ? body.confirmId : "",
    });
    return apiOk({ ok: true, decision: body.decision, ...res });
  } catch (e) {
    return apiError(e);
  }
}
