import { NextRequest } from "next/server";
import { requireCtx, requireRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { filterTrackerRows, getAdminTracker, resolveTrackerFilterContext, trackerFilterParamsFrom } from "@/services/adminView";
import { serverNow } from "@/lib/clock";
import { DateTime } from "luxon";
import { IST } from "@/lib/env";

/** RFC 4180 cell, defused against spreadsheet formula injection: a cell starting
 *  with = + - @ (or tab / CR) gets a leading single quote so it's read as text. */
function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function istDay(iso: string | null): string {
  return iso ? DateTime.fromISO(iso, { zone: IST }).toFormat("yyyy-LL-dd HH:mm") : "";
}

/** CSV export of the booking tracker. Honours the same filters as the page. */
export async function GET(req: NextRequest) {
  try {
    // Admin-only: /api is outside the middleware matcher, so the role check must live here.
    const ctx = await requireCtx();
    requireRole(ctx, "PROGRAM_ADMIN", "INTERVIEW_ADMIN");

    const sp = req.nextUrl.searchParams;
    const filters = trackerFilterParamsFrom((k) => sp.get(k));
    const [t, fctx] = await Promise.all([getAdminTracker(), resolveTrackerFilterContext(filters)]);
    const rows = filterTrackerRows(t.rows, filters, fctx);

    const header = [
      "Student", "GRIT ID", "Batch", "Section", "Track", "Badge", "State",
      "Eligible since (IST)", "Booking (IST)", "Interviewer", "Attempts", "Deadline risk", "Last reminder (IST)",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.studentName, r.gritIdMasked, r.batch, r.section, r.trackName, r.badgeName, r.state,
          istDay(r.eligibleSinceIso), istDay(r.bookingStartIso), r.interviewerName,
          `${r.attemptsUsed}/${r.maxAttempts}`, r.risk, istDay(r.lastReminderIso),
        ].map(csvCell).join(",")
      );
    }
    const now = await serverNow();
    const stamp = DateTime.fromJSDate(now).setZone(IST).toFormat("yyyyLLdd-HHmm");

    return new Response("﻿" + lines.join("\r\n") + "\r\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="grit-tracker-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
