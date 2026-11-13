import { apiOk, apiError } from "@/lib/api";
import { requireBearer } from "@/lib/bearer";
import { runTick } from "@/services/jobs";

/**
 * Scheduled job runner for deployments: a cron (e.g. a Railway cron service, every
 * minute) calls this with `Authorization: Bearer $CRON_SECRET`. Every job is
 * idempotent, so overlapping or repeated calls are safe.
 */
export async function POST(req: Request) {
  try {
    requireBearer(req);
    const results = await runTick();
    return apiOk({ results });
  } catch (e) {
    return apiError(e);
  }
}
