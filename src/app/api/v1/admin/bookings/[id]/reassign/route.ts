import { NextRequest } from "next/server";
import { sql } from "@/db";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { swapInterviewer } from "@/services/reassign";

/** Reassign to another interviewer at the same time. Staff can exclude, never choose (spec §6). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "INTERVIEW_ADMIN", "PROGRAM_ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { reason?: string; exclude_current?: boolean; exclude_interviewer_ids?: string[] };
    // Staff can exclude, never choose: at most 2 extra exclusions (e.g. a conflict of interest).
    if ((body.exclude_interviewer_ids ?? []).length > 2) {
      throw new ApiError(422, "TOO_MANY_EXCLUSIONS", "Exclude at most 2 other interviewers; the system picks who takes it.");
    }
    const reason = (body.reason ?? "").trim();
    if (reason.length < 10) throw new ApiError(422, "REASON_REQUIRED", "Give a reason of at least 10 characters.");
    const to = await sql.begin((tx) =>
      swapInterviewer(tx, id, {
        excludeInterviewerIds: body.exclude_interviewer_ids ?? [],
        reason,
        actorUserId: ctx.userId,
        // Unticked "exclude current" means they're still free: their seat goes back to the pool.
        freeOldSeat: body.exclude_current === false,
        action: "reassign",
      })
    );
    if (!to) throw new ApiError(409, "NO_ONE_FREE", "Nobody qualified is free at that time. Void the interview instead, or try later.");
    return apiOk({ ok: true, interviewerId: to });
  } catch (e) {
    return apiError(e);
  }
}
