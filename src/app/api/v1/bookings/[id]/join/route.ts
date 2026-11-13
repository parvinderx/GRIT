import { NextRequest } from "next/server";
import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { studentJoin } from "@/services/join";

/** The signed-in student joins their own interview (no body; the booking code is auto-verified). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    if (!ctx.studentId) throw new ApiError(403, "FORBIDDEN", "Students only.");
    const { id } = await params;
    return apiOk(await studentJoin(id, ctx.studentId));
  } catch (e) {
    return apiError(e);
  }
}
