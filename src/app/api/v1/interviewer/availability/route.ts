import { NextRequest } from "next/server";
import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { pgCode } from "@/lib/errors";
import { materializeSlots } from "@/services/slots";
import { availabilityConflict, saveAvailability, type OverrideInput, type WeeklyInput } from "@/services/availabilityEditor";

/** Regenerate this interviewer's slots on the grid (under the per-interviewer availability lock). */
export async function POST() {
  try {
    const ctx = await requireCtx();
    if (!ctx.interviewerId) throw new ApiError(403, "FORBIDDEN", "Interviewers only.");
    const created = await materializeSlots({ interviewerId: ctx.interviewerId });
    return apiOk({ ok: true, created });
  } catch (e) {
    return apiError(pgCode(e) === "23P01" ? availabilityConflict() : e);
  }
}

/**
 * Replace this interviewer's weekly hours (and optional future date overrides),
 * then re-materialize slots.
 *
 * 422 INVALID_AVAILABILITY carries `errors: [{scope:"weekly", weekday, index, message}
 * | {scope:"override", date, message}]` (overlaps, duplicates, ranges too short for
 * one slot, past dates). On success returns
 * `{created, removed, createdLiveNow, createdLater, createdTooSoon, bookingCutoffHours, nextReleaseIso,
 *   bookedAffected:[{startIso, studentFirstName?}]}`.
 * Booked slots are never cancelled here; ones outside the new hours are only reported.
 */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireCtx();
    if (!ctx.interviewerId) throw new ApiError(403, "FORBIDDEN", "Interviewers only.");
    const body = (await req.json().catch(() => ({}))) as { weekly?: unknown; overrides?: unknown };
    if (body.weekly !== undefined && !Array.isArray(body.weekly)) throw new ApiError(422, "INVALID", "weekly must be an array.");
    if (body.overrides !== undefined && !Array.isArray(body.overrides)) throw new ApiError(422, "INVALID", "overrides must be an array.");
    const result = await saveAvailability(
      ctx.interviewerId,
      (body.weekly as WeeklyInput[] | undefined) ?? [],
      body.overrides as OverrideInput[] | undefined
    );
    return apiOk({ ok: true, ...result });
  } catch (e) {
    return apiError(e);
  }
}
