import { NextRequest } from "next/server";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { isUuid } from "@/lib/ids";
import { dismissCase } from "@/services/integrity";

/** Dismiss the case: held journeys go back to ELIGIBLE and a held interview result is
 *  released and published. Stores decision 'dismiss' + the note. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "PROGRAM_ADMIN");
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError(404, "NOT_FOUND", "Case not found");
    const body = (await req.json().catch(() => ({}))) as { note?: unknown };
    const note = typeof body.note === "string" ? body.note : "";
    return apiOk({ ok: true, ...(await dismissCase({ caseId: id, actorUserId: ctx.userId, note })) });
  } catch (e) {
    return apiError(e);
  }
}
