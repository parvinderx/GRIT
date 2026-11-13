import { NextRequest } from "next/server";
import { sql } from "@/db";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { formatDayMonth } from "@/lib/time";
import {
  filterTrackerRows,
  getAdminTracker,
  resolveTrackerFilterContext,
  trackerFilterParamsFrom,
} from "@/services/adminView";

/** Safety limit on one send (the whole season is far below it). */
const MAX_RECIPIENTS = 20_000;
/** Insert in chunks so one statement never carries a huge array. */
const BATCH = 1_000;

/**
 * Bulk "booking reminder" to every not-booked student in the tracker's current
 * filtered view. The client sends only the filters; the server resolves the
 * recipients itself with the tracker's own filter code (no client-supplied IDs).
 * Each recipient is re-checked in the INSERT: still has an ELIGIBLE journey, no
 * CONFIRMED / IN_PROGRESS booking on any journey, and no reminder in the last
 * 72 h (season rule). Writes an IN_APP notification row per student; the
 * tracker's "last reminder" column reads these back.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCtx();
    requireRole(ctx, "PROGRAM_ADMIN", "INTERVIEW_ADMIN");
    const body = (await req.json().catch(() => ({}))) as { filters?: unknown };
    const raw = body.filters && typeof body.filters === "object" ? (body.filters as Record<string, unknown>) : {};
    const filters = trackerFilterParamsFrom((k) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined));
    // The reminder only ever targets not-booked students, whatever the view.
    filters.notbooked = "1";

    const [tracker, fctx] = await Promise.all([getAdminTracker(), resolveTrackerFilterContext(filters)]);
    const selected = [...new Set(filterTrackerRows(tracker.rows, filters, fctx).map((r) => r.studentId))];
    if (selected.length === 0) throw new ApiError(422, "NO_RECIPIENTS", "No unbooked students match these filters.");
    if (selected.length > MAX_RECIPIENTS) {
      throw new ApiError(422, "TOO_MANY", `Narrow the filters: at most ${MAX_RECIPIENTS.toLocaleString("en-IN")} students per send.`);
    }

    const deadline = (await sql<{ deadline_at: Date }[]>`SELECT deadline_at FROM seasons LIMIT 1`)[0].deadline_at;
    const text = `Reminder: book your GRIT Level Clearance Interview before the ${formatDayMonth(deadline)} deadline.`;

    let sent = 0;
    let stillNotBooked = 0;
    for (let i = 0; i < selected.length; i += BATCH) {
      const chunk = selected.slice(i, i + BATCH);
      // Same student-level rule as the tracker: an ELIGIBLE journey and no live booking anywhere.
      const nb = await sql<{ student_id: string }[]>`
        SELECT s::uuid student_id FROM unnest(${chunk}::uuid[]) AS s
        WHERE EXISTS (SELECT 1 FROM interview_journeys j WHERE j.student_id = s::uuid AND j.state = 'ELIGIBLE')
          AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.student_id = s::uuid AND bk.status IN ('CONFIRMED','IN_PROGRESS'))`;
      stillNotBooked += nb.length;
      if (nb.length === 0) continue;
      const rows = await sql<{ id: string }[]>`
        INSERT INTO notifications (student_id, channel, template, payload, neutral_text, created_at)
        SELECT s::uuid, 'IN_APP', 'ADMIN_BOOKING_REMINDER',
               ${sql.json({ sentBy: ctx.userId })},
               ${text},
               app_now()
        FROM unnest(${nb.map((r) => r.student_id)}::uuid[]) AS s
        -- Re-check everything in the same statement so a booking made or a reminder
        -- sent meanwhile isn't doubled up.
        WHERE EXISTS (SELECT 1 FROM interview_journeys j WHERE j.student_id = s::uuid AND j.state = 'ELIGIBLE')
          AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.student_id = s::uuid AND bk.status IN ('CONFIRMED','IN_PROGRESS'))
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.student_id = s::uuid AND n.template = 'ADMIN_BOOKING_REMINDER'
              AND n.created_at > app_now() - interval '72 hours'
          )
        RETURNING id`;
      sent += rows.length;
    }

    const skipped = Math.max(0, stillNotBooked - sent);
    const noLongerEligible = selected.length - stillNotBooked;
    const message =
      `Reminder sent to ${sent} student${sent === 1 ? "" : "s"}.` +
      (skipped > 0 ? ` ${skipped} skipped (reminded within the last 72 h).` : "") +
      (noLongerEligible > 0 ? ` ${noLongerEligible} skipped (booked or no longer eligible).` : "");
    return apiOk({ ok: true, sent, skipped, message });
  } catch (e) {
    return apiError(e);
  }
}
