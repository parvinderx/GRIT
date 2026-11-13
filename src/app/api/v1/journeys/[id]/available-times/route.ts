import { NextRequest } from "next/server";
import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { getAvailableTimes } from "@/services/availability";

/** GET ?for=reschedule&exclude=<startIso> narrows to times a reschedule can accept. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    if (!ctx.studentId) throw new ApiError(403, "FORBIDDEN", "Students only.");
    const { id } = await params;
    const sp = req.nextUrl.searchParams;
    const data = await getAvailableTimes(id, ctx.studentId, {
      forReschedule: sp.get("for") === "reschedule",
      excludeIso: sp.get("exclude"),
    });
    return apiOk(data);
  } catch (e) {
    return apiError(e);
  }
}
