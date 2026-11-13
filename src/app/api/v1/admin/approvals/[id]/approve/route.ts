import { NextRequest } from "next/server";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError } from "@/lib/api";
import { approveRequest } from "@/services/approvals";

/** Approve a pending request and apply its effect. The approver must differ from the
 *  requester (and the interviewer, if any): the two-person rule from Section 8. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "PROGRAM_ADMIN");
    const { id } = await params;
    await approveRequest(id, ctx.userId);
    return apiOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
