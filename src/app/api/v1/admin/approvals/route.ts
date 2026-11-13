import { NextRequest } from "next/server";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { createStaffRequest, STAFF_REQUEST_KINDS, type StaffRequestKind } from "@/services/approvals";

/** File a request for a second Program Admin to approve: result change, extra attempt, end a wait. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "INTERVIEW_ADMIN", "PROGRAM_ADMIN");
    const body = (await req.json().catch(() => ({}))) as {
      kind?: string;
      journey_id?: string;
      reason?: string;
      new_result?: "PASS" | "FAIL" | "RETAKE_LATER";
    };
    if (!body.kind || !STAFF_REQUEST_KINDS.includes(body.kind as StaffRequestKind))
      throw new ApiError(400, "BAD_REQUEST", "Unknown request kind.");
    if (!body.journey_id) throw new ApiError(400, "BAD_REQUEST", "journey_id is required.");
    const r = await createStaffRequest({
      kind: body.kind as StaffRequestKind,
      journeyId: body.journey_id,
      requestedBy: ctx.userId,
      reason: body.reason ?? "",
      newResult: body.new_result,
    });
    return apiOk({ ok: true, id: r.id });
  } catch (e) {
    return apiError(e);
  }
}
