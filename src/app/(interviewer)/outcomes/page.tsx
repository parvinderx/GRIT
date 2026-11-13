import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { listOutcomesDue } from "@/services/interviewerView";
import { dateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { PageTitle } from "@/components/student/ui/Section";
import { HeroFrame } from "@/components/student/ui/Hero";
import { ButtonLink, btnClass } from "@/components/student/ui/Button";
import { LiveCountdown } from "@/components/student/ui/LiveCountdown";

/** Every interview that still needs an outcome, across all days, oldest deadline first. */
export default async function OutcomesDuePage() {
  const ctx = await getCtx();
  if (!ctx?.interviewerId) redirect("/start");
  const { items, serverNowIso } = await listOutcomesDue(ctx.interviewerId);

  if (items.length === 0) {
    return (
      <HeroFrame
        headingId="outcomes-title"
        status={{ tone: "done", icon: "CheckCircle2", text: "Nothing owed" }}
        headline="You're all caught up"
        note={<p>Every interview you&apos;ve taken has an outcome recorded.</p>}
        actions={
          <ButtonLink kind="outline" href="/schedule">
            Back to today
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="max-w-4xl">
      <PageTitle
        title="Outcomes due"
        intro="Record each outcome within 24 hours of the interview. Oldest first. All times IST."
      />
      <ol className="border-t-[1.5px] border-graphite">
        {items.map((it, i) => (
          <li key={it.bookingId} className="grid gap-3 border-b border-rule py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6">
            <div className="min-w-0">
              <p className="font-bold text-graphite">
                {it.studentName}, {it.badge}
              </p>
              <p className="text-pencil">Interview on {dateTime(it.startIso)}</p>
            </div>
            {it.overdue ? (
              <p className="font-bold text-amberline">Overdue since {dateTime(it.outcomeDueIso)}</p>
            ) : (
              <LiveCountdown
                size="sm"
                targetIso={it.outcomeDueIso}
                serverNowIso={serverNowIso}
                label="Due in"
                doneText="Overdue"
                refreshAtZero
              />
            )}
            <Link
              href={`/outcome/${it.bookingId}?from=outcomes`}
              className={cn(btnClass(i === 0 ? "next" : "outline", "min-h-11 px-4 text-[15px]"))}
            >
              Record outcome
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
