import { sql } from "@/db";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { getAvailableTimes } from "@/services/availability";

/** Open times a student could book, for staff booking on their behalf. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "INTERVIEW_ADMIN", "PROGRAM_ADMIN");
    const { id } = await params;
    const j = (await sql<{ student_id: string }[]>`SELECT student_id FROM interview_journeys WHERE id = ${id}`)[0];
    if (!j) throw new ApiError(404, "NOT_FOUND", "Journey not found");
    const times = await getAvailableTimes(id, j.student_id);
    return apiOk({ times });
  } catch (e) {
    return apiError(e);
  }
}
