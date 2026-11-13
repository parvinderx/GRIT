import { NextRequest } from "next/server";
import { sql } from "@/db";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { voidBooking } from "@/services/reassign";

/** Void for a PLATFORM or INTERVIEWER fault; no outcome may exist (spec §6, §8). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "INTERVIEW_ADMIN", "PROGRAM_ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { fault?: string; reason?: string };
    if (body.fault !== "PLATFORM" && body.fault !== "INTERVIEWER")
      throw new ApiError(422, "BAD_FAULT", "Fault must be PLATFORM or INTERVIEWER.");
    const reason = (body.reason ?? "").trim();
    if (reason.length < 10) throw new ApiError(422, "REASON_REQUIRED", "Give a reason of at least 10 characters.");
    await sql.begin((tx) => voidBooking(tx, id, { fault: body.fault as "PLATFORM" | "INTERVIEWER", reason, actorUserId: ctx.userId }));
    return apiOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
