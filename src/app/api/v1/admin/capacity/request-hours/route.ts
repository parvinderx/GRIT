import { NextRequest } from "next/server";
import { sql } from "@/db";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";

/** "Request more hours" — files a SEASON_RULE approval the second admin can act on,
 *  capturing the current capacity gap as the reason. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "PROGRAM_ADMIN", "INTERVIEW_ADMIN");
    const body = (await req.json().catch(() => ({}))) as { note?: string; gap?: number };

    // Avoid piling up duplicate open requests from the same admin.
    const existing = (
      await sql<{ id: string }[]>`
        SELECT id FROM approvals
        WHERE action = 'SEASON_RULE' AND status = 'PENDING' AND requested_by = ${ctx.userId}
          AND payload->>'kind' = 'MORE_HOURS'
        LIMIT 1`
    )[0];
    if (existing) throw new ApiError(409, "ALREADY_REQUESTED", "You already have an open request for more hours.");

    const reason =
      (body.note?.trim() ? `${body.note.trim()} ` : "") +
      (body.gap != null ? `(capacity gap: ~${body.gap} students).` : "Request to open additional interviewer hours.");

    const row = (
      await sql<{ id: string }[]>`
        INSERT INTO approvals (action, status, requested_by, payload, reason, created_at)
        VALUES ('SEASON_RULE', 'PENDING', ${ctx.userId},
                ${sql.json({ kind: "MORE_HOURS", gap: body.gap ?? null })}, ${reason}, app_now())
        RETURNING id`
    )[0];

    return apiOk({ ok: true, approvalId: row.id, message: "Request filed — it's waiting for a second admin in Approvals." });
  } catch (e) {
    return apiError(e);
  }
}
