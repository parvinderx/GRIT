import { AlertTriangle, CircleCheck, Info } from "lucide-react";
import { requireAdminPage } from "@/lib/auth";
import { getAdminCapacity } from "@/services/adminView";
import { RequestHoursButton } from "@/components/admin/ActionButtons";
import { StatusChip } from "@/components/primitives/StatusChip";
import { formatDayMonth, formatDayShort } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Fill by share booked. Every fill keeps ink text at ≥4.5:1 except the full cell (white on solid cobalt, ~6.6:1). */
function heat(booked: number, total: number): string {
  if (total === 0) return "bg-paper-2 text-ink-2";
  const pct = booked / total;
  if (pct >= 1) return "bg-cobalt text-white";
  if (pct >= 0.66) return "bg-cobalt/35 text-ink";
  if (pct >= 0.33) return "bg-cobalt/20 text-ink";
  return "bg-cobalt/10 text-ink";
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function CapacityPage() {
  await requireAdminPage();
  const c = await getAdminCapacity();
  const short = c.gap > 0;
  const anyTrackShort = c.byTrack.some((r) => r.short > 0);
  const openShare = Math.max(0, 1 - c.pools.deadlineShare - c.pools.priorityShare);
  const poolsApplied = c.pools.reservedOpenSlots > 0;

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-ink">Capacity</h1>
      <p className="mb-5 text-ink-2">Next {c.horizonDays} days · all times IST</p>

      <div
        role="status"
        className={cn(
          "mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4",
          short ? "border-alert/40 bg-alert/5" : "border-border bg-card"
        )}
      >
        <div className="flex items-start gap-3">
          {short ? <AlertTriangle className="mt-0.5 size-5 text-alert" aria-hidden /> : <Info className="mt-0.5 size-5 text-cobalt" aria-hidden />}
          <div>
            <p className={cn("font-semibold", short ? "text-alert" : "text-ink")}>
              {short
                ? `${c.gap.toLocaleString("en-IN")} ${c.gap === 1 ? "student" : "students"} can't book with the slots open for booking now`
                : "Enough slots open for booking now for everyone not yet booked"}
            </p>
            <p className="text-sm text-ink-2">
              {c.demandTotal.toLocaleString("en-IN")} {c.demandTotal === 1 ? "student" : "students"} not booked · {c.openTotal.toLocaleString("en-IN")} slots open for booking now in the next {c.horizonDays} days
              {c.openingLaterTotal > 0 ? ` · ${c.openingLaterTotal.toLocaleString("en-IN")} more open later` : ""}
            </p>
          </div>
        </div>
        {(short || anyTrackShort) && <RequestHoursButton gap={Math.max(0, c.gap)} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-1 font-heading text-base font-semibold text-ink">By track</h2>
          <p className="mb-3 text-xs text-ink-2">
            Not booked = students ready to book on that track with no interview booked on any track. Open slots = bookable now. An interviewer on
            several tracks counts toward each, so track rows can add up to more than the total.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-2">
                <tr>
                  <th className="pb-2 font-medium">Track</th>
                  <th className="pb-2 text-right font-medium">Not booked (students)</th>
                  <th className="pb-2 text-right font-medium">Open slots</th>
                  <th className="pb-2 text-right font-medium">Gap</th>
                </tr>
              </thead>
              <tbody>
                {c.byTrack.map((r) => (
                  <tr key={r.track} className="border-t border-border/60">
                    <td className="py-2.5 text-ink">{r.track}</td>
                    <td className="py-2.5 text-right text-ink-2">{r.notBooked}</td>
                    <td className="py-2.5 text-right text-ink-2">{r.openSlots}</td>
                    <td className="py-2.5 text-right">
                      {r.short > 0 ? (
                        <StatusChip tone="action" icon={AlertTriangle} label={`Short by ${r.short}`} />
                      ) : (
                        <StatusChip tone="muted" icon={CircleCheck} label={`${-r.short} spare`} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-heading text-base font-semibold text-ink">{poolsApplied ? "Seat pools" : "Planned seat pools"}</h2>
          <p className="mb-3 text-sm text-ink-2">
            Before the {formatDayMonth(c.deadlineIso)} deadline, part of each day&apos;s seats can be held back for students who need them most.
          </p>
          <div className="flex h-5 overflow-hidden rounded-full" aria-hidden>
            <span className="bg-ink" style={{ width: pct(c.pools.deadlineShare) }} />
            <span className="bg-saffron" style={{ width: pct(c.pools.priorityShare) }} />
            <span className="bg-paper-2" style={{ width: pct(openShare) }} />
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
            <li className="flex items-center gap-2"><span className="size-3 rounded bg-ink" aria-hidden /> {pct(c.pools.deadlineShare)} Deadline · students with no badge yet</li>
            <li className="flex items-center gap-2"><span className="size-3 rounded bg-saffron" aria-hidden /> {pct(c.pools.priorityShare)} Priority · rebooking after we called an interview off</li>
            <li className="flex items-center gap-2"><span className="size-3 rounded border border-ink/20 bg-paper-2" aria-hidden /> {pct(openShare)} Open to all</li>
          </ul>
          <p className="mt-3 text-xs text-ink-2">
            {poolsApplied
              ? `${c.pools.reservedOpenSlots} open slots are reserved right now. Unclaimed reserved seats open to everyone ${c.pools.releaseHours} h before the interview.`
              : "Not applied yet: no open slot is reserved, so every slot is open to all students."}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 font-heading text-base font-semibold text-ink">Booked / total slots · next {c.horizonDays} days</h2>
        <ul className="flex flex-wrap gap-2">
          {c.days.map((d) => {
            const total = d.booked + d.open;
            const day = formatDayShort(`${d.dateIso}T12:00:00+05:30`);
            const label = `${d.booked} of ${total} slots booked on ${day}`;
            return (
              <li key={d.dateIso} className="w-20 text-center" title={label}>
                <div className={cn("rounded-lg px-1 py-3 font-heading text-sm font-bold", heat(d.booked, total))}>
                  <span aria-hidden>{d.booked}/{total}</span>
                  <span className="sr-only">{label}</span>
                </div>
                <div className="mt-1 text-xs text-ink-2" aria-hidden>{d.label}</div>
              </li>
            );
          })}
          {c.days.length === 0 && <li className="text-sm text-ink-2">No open or booked slots in range.</li>}
        </ul>
        <p className="mt-3 text-xs text-ink-2">Each cell is booked / (booked + open). Darker = fuller; the numbers are always shown.</p>
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 font-heading text-base font-semibold text-ink">Interviewers</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-2">
              <tr>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 text-right font-medium">Slots ({c.horizonDays} d)</th>
                <th className="pb-2 text-right font-medium">Booked</th>
              </tr>
            </thead>
            <tbody>
              {c.interviewers.map((iv) => (
                <tr key={iv.name} className="border-t border-border/60">
                  <td className="py-2.5 text-ink">{iv.name}</td>
                  <td className="py-2.5 text-right text-ink-2">{iv.booked + iv.open}</td>
                  <td className="py-2.5 text-right text-ink-2">{iv.booked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-2">Slots counts open and booked slots only (not blocked or cancelled).</p>
      </div>
    </div>
  );
}
