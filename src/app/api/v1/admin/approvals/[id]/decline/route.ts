import { NextRequest } from "next/server";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError } from "@/lib/api";
import { declineRequest } from "@/services/approvals";

/** Decline a pending request. Like approve, the decider must differ from the
 *  requester (and the interviewer, if any): the two-person rule from Section 8. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "PROGRAM_ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    await declineRequest(id, ctx.userId, body.reason);
    return apiOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
