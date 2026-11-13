import Link from "next/link";
import {
  ChevronRight,
  CircleCheck,
  ClipboardPen,
  Hourglass,
  LifeBuoy,
  ShieldAlert,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { requireAdminPage } from "@/lib/auth";
import { getAdminOverview } from "@/services/adminView";
import { formatDayMonth, formatDayShort, waitingFor } from "@/lib/time";
import { cn } from "@/lib/utils";

interface AttentionItem {
  key: string;
  icon: LucideIcon;
  count: number;
  /** "3 emergency waivers" — count + unit. */
  title: string;
  line: string;
  href: string;
  linkLabel: string;
  tone: "alert" | "review" | "pending";
}

const TONE: Record<AttentionItem["tone"], string> = {
  alert: "bg-alert/10 text-alert",
  review: "bg-review/10 text-review",
  pending: "bg-amber/15 text-ink",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

export default async function OverviewPage() {
  const ctx = await requireAdminPage();
  const isProgramAdmin = ctx.roles.includes("PROGRAM_ADMIN");
  const o = await getAdminOverview();
  const nowMs = new Date(o.serverTimeIso).getTime();
  const decider = isProgramAdmin ? "" : " A Program Admin decides these.";

  // Routine order (spec · interview team daily operations): emergencies → integrity →
  // overdue outcomes → other approvals. Missed interviews are listed under "For information".
  const items: AttentionItem[] = [];
  if (o.emergencies.count > 0) {
    items.push({
      key: "emergency",
      icon: LifeBuoy,
      count: o.emergencies.count,
      title: plural(o.emergencies.count, "emergency waiver"),
      line: `Students who reported an emergency close to their interview.${o.emergencies.oldestIso ? ` Oldest waiting ${waitingFor(new Date(o.emergencies.oldestIso).getTime(), nowMs)}.` : ""}${decider}`,
      href: "/approvals?filter=emergency",
      linkLabel: "Review emergencies",
      tone: "alert",
    });
  }
  const casesTotal = o.cases.triage + o.cases.open;
  if (casesTotal > 0) {
    const parts = [o.cases.triage ? `${o.cases.triage} in triage` : null, o.cases.open ? `${o.cases.open} under review` : null].filter(Boolean);
    items.push({
      key: "cases",
      icon: ShieldAlert,
      count: casesTotal,
      title: plural(casesTotal, "integrity case"),
      line: `${parts.join(", ")} — waiting for a Program Admin's decision.`,
      href: "/cases?filter=open",
      linkLabel: "Open the cases",
      tone: "review",
    });
  }
  if (o.overdue.total > 0) {
    const who = o.overdue.byInterviewer.slice(0, 3).map((x) => `${x.name} ${x.count}`).join(" · ");
    const more = o.overdue.byInterviewer.length > 3 ? ` · +${o.overdue.byInterviewer.length - 3} more` : "";
    items.push({
      key: "overdue",
      icon: ClipboardPen,
      count: o.overdue.total,
      title: plural(o.overdue.total, "outcome") + " overdue",
      line: `Not recorded 24 h after the interview (one per student journey): ${who}${more}.`,
      href: "/tracker?overdue=1",
      linkLabel: "See the students affected",
      tone: "alert",
    });
  }
  if (o.otherApprovals.count > 0) {
    items.push({
      key: "approvals",
      icon: Hourglass,
      count: o.otherApprovals.count,
      title: plural(o.otherApprovals.count, "approval") + " waiting",
      line: `Result changes, attempts, cooldowns, hours and access.${o.otherApprovals.oldestIso ? ` Oldest waiting ${waitingFor(new Date(o.otherApprovals.oldestIso).getTime(), nowMs)}.` : ""}${decider}`,
      href: "/approvals",
      linkLabel: "Open approvals",
      tone: "pending",
    });
  }

  const short = o.capacityGap > 0;
  const headline: { label: string; value: string; unit: string; sub: string; href: string; alert: boolean }[] = [
    {
      label: "Not booked",
      value: o.notBooked.toLocaleString("en-IN"),
      unit: o.notBooked === 1 ? "student" : "students",
      sub: "Ready to book, with no interview booked on any track",
      href: "/tracker?notbooked=1",
      alert: false,
    },
    {
      label: "At deadline risk",
      value: o.atRisk.toLocaleString("en-IN"),
      unit: o.atRisk === 1 ? "student" : "students",
      sub: `Critical or High risk of missing ${formatDayMonth(o.deadlineIso)}`,
      href: "/tracker?risk=1",
      alert: o.atRisk > 0,
    },
    {
      label: "Capacity gap",
      value: short ? o.capacityGap.toLocaleString("en-IN") : Math.abs(o.capacityGap).toLocaleString("en-IN"),
      unit: short ? "students short" : "slots spare",
      sub: short
        ? `More unbooked students than slots open for booking now (next ${o.horizonDays} days)`
        : `Slots open for booking now (next ${o.horizonDays} days) cover everyone not booked`,
      href: "/capacity",
      alert: short,
    },
  ];

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-ink">Overview</h1>
      <p className="mb-5 text-ink-2">What needs you first · {formatDayShort(o.serverTimeIso)}</p>

      <section aria-labelledby="attention" className="mb-6">
        <h2 id="attention" className="mb-2 font-heading text-base font-semibold text-ink">Needs attention</h2>
        {items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-6">
            <CircleCheck className="size-5 text-go" aria-hidden />
            <p className="font-medium text-ink">Nothing needs you right now.</p>
          </div>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {items.map((it) => (
              <li key={it.key}>
                <Link href={it.href} className="flex min-h-11 items-start gap-3 px-5 py-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cobalt">
                  <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", TONE[it.tone])}>
                    <it.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{it.title}</span>
                    <span className="block text-sm text-ink-2">{it.line}</span>
                    <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-cobalt underline underline-offset-4">
                      {it.linkLabel}
                      <ChevronRight className="size-4" aria-hidden />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}

        {(o.noShows48h > 0 || o.resultPending > 0) && (
          <div className="mt-3 rounded-2xl border border-dashed border-border px-5 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">For information · no action here</p>
            <ul className="mt-1 space-y-1 text-sm text-ink-2">
              {o.noShows48h > 0 && (
                <li className="flex flex-wrap items-center gap-x-2">
                  <UserX className="size-4" aria-hidden />
                  <span>{plural(o.noShows48h, "missed interview")} in the last 48 h. Students with attempts left can book again after their cooldown; anyone at the attempt limit can&apos;t.</span>
                  <Link href="/tracker?missed=48h" className="inline-flex min-h-11 items-center font-medium text-cobalt underline underline-offset-4">
                    See in tracker
                  </Link>
                </li>
              )}
              {o.resultPending > 0 && (
                <li className="flex flex-wrap items-center gap-x-2">
                  <Hourglass className="size-4" aria-hidden />
                  <span>{plural(o.resultPending, "result")} pending (interview done, result not yet published).</span>
                  <Link href="/tracker?state=AWAITING_RESULT" className="inline-flex min-h-11 items-center font-medium text-cobalt underline underline-offset-4">
                    See in tracker
                  </Link>
                </li>
              )}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="numbers">
        <h2 id="numbers" className="mb-2 font-heading text-base font-semibold text-ink">Headline numbers</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {headline.map((h) => (
            <Link
              key={h.label}
              href={h.href}
              className={cn(
                "block rounded-2xl border bg-card px-5 py-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt",
                h.alert ? "border-alert/40" : "border-border"
              )}
            >
              <span className="block text-sm font-medium text-ink-2">{h.label}</span>
              <span className="mt-1 flex items-baseline gap-1.5">
                <span className={cn("font-heading text-3xl font-bold", h.alert ? "text-alert" : "text-ink")}>{h.value}</span>
                <span className="text-sm text-ink-2">{h.unit}</span>
              </span>
              <span className="mt-1 block text-xs text-ink-2">{h.sub}</span>
              <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-cobalt underline underline-offset-4">
                Open <ChevronRight className="size-4" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
