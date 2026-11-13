import { apiOk, apiError, ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { runTick } from "@/services/jobs";

/** Run all due background jobs against the simulated clock. */
export async function POST() {
  try {
    if (!env.devTools) throw new ApiError(404, "NOT_FOUND", "Not found");
    const jobs = await runTick();
    return apiOk({ ok: true, jobs });
  } catch (e) {
    return apiError(e);
  }
}
