import { sql } from "@/db";
import { ApiError } from "@/lib/errors";

/**
 * Booking rate limit (spec §8: 5 per minute, 20 per day, from season_rules).
 * Records this attempt and refuses it if the user is over either limit. A per-user
 * advisory lock makes the count exact under concurrent requests. Uses real time
 * (now()), not the simulated clock: it limits real-world request bursts.
 */
export async function checkBookingRate(userId: string, kind: "book" | "reschedule" = "book"): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"rate:" + userId}))`;
    const [rules] = await tx<{ per_min: number; per_day: number }[]>`
      SELECT rate_bookings_per_min AS per_min, rate_bookings_per_day AS per_day FROM season_rules LIMIT 1`;
    const perMin = rules?.per_min ?? 5;
    const perDay = rules?.per_day ?? 20;
    const [c] = await tx<{ last_min: number; last_day: number }[]>`
      SELECT count(*) FILTER (WHERE at > now() - interval '1 minute')::int AS last_min,
             count(*)::int AS last_day
      FROM booking_attempts
      WHERE user_id = ${userId} AND at > now() - interval '1 day'`;
    if ((c?.last_min ?? 0) >= perMin) {
      throw new ApiError(429, "RATE_LIMITED", "Too many booking attempts in a minute. Wait a moment and try again.");
    }
    if ((c?.last_day ?? 0) >= perDay) {
      throw new ApiError(429, "RATE_LIMITED", "You've reached today's limit for booking changes. Try again tomorrow.");
    }
    await tx`INSERT INTO booking_attempts (user_id, kind, at) VALUES (${userId}, ${kind}, now())`;
  });
}

/** True when this Idempotency-Key was already used: a replay, which doesn't count. */
export async function isReplay(userId: string, idemKey: string): Promise<boolean> {
  const r = await sql`SELECT 1 FROM idempotency_keys WHERE user_id = ${userId} AND idem_key = ${idemKey}`;
  return r.length > 0;
}
