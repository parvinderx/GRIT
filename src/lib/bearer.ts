import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors";
import { env } from "./env";

/** Server-to-server auth for cron and integration endpoints: `Authorization: Bearer $CRON_SECRET`. */
export function requireBearer(req: Request): void {
  if (!env.cronSecret) throw new ApiError(404, "NOT_FOUND", "Not found");
  const h = req.headers.get("authorization") ?? "";
  const given = Buffer.from(h.startsWith("Bearer ") ? h.slice(7).trim() : "");
  const want = Buffer.from(env.cronSecret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new ApiError(401, "UNAUTHENTICATED", "Bad or missing bearer token.");
  }
}
