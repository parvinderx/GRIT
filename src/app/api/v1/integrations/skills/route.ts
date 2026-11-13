import { apiOk, apiError, ApiError } from "@/lib/api";
import { requireBearer } from "@/lib/bearer";
import { syncSkills, type SkillLevel } from "@/services/skillSync";

/**
 * Contest system -> skill levels. `Authorization: Bearer $CRON_SECRET`.
 * Body: { grit_id, seq, levels: [{ skill_code, level }] }. Idempotent per seq.
 */
export async function POST(req: Request) {
  try {
    requireBearer(req);
    const body = (await req.json().catch(() => ({}))) as { grit_id?: string; seq?: number; levels?: { skill_code?: string; level?: number }[] };
    if (!body.grit_id || typeof body.seq !== "number" || !Array.isArray(body.levels)) {
      throw new ApiError(400, "BAD_REQUEST", "grit_id, seq and levels are required.");
    }
    const levels: SkillLevel[] = body.levels.map((l) => ({ skillCode: String(l.skill_code ?? ""), level: Number(l.level) }));
    const r = await syncSkills({ gritId: body.grit_id, seq: body.seq, levels });
    return apiOk({ ok: true, ...r });
  } catch (e) {
    return apiError(e);
  }
}
