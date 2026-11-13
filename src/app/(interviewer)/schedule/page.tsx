import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getCtx } from "@/lib/auth";
import { sql } from "@/db";
import { isUuid } from "@/lib/ids";
import { getInterviewerDay, listOutcomesDue, type ScheduleRow } from "@/services/interviewerView";
import { BriefButton } from "@/components/interviewer/BriefButton";
import { type BriefInfo } from "@/components/interviewer/InterviewBrief";
import { LiveRefresh } from "@/components/interviewer/LiveRefresh";
import { dateTime, formatTime, timeOnly, toIST } from "@/lib/time";
import { RESULT_LABEL, VOID_REASON_LABEL, WHAT_HAPPENED_LABEL, type OutcomeResult, type WhatHappened } from "@/lib/outcome";
import { cn } from "@/lib/utils";
import { HeroFrame } from "@/components/student/ui/Hero";
import { ButtonLink, btnClass } from "@/components/student/ui/Button";
import { LiveCountdown } from "@/components/student/ui/LiveCountdown";
import { Section } from "@/components/student/ui/Section";
import type { StudentTone } from "@/components/student/ui/StatusLine";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Status words per row, in the student palette (no red). */
const ROW_STATUS: Partial<Record<ScheduleRow["kind"], { text: string; tone: StudentTone }>> = {
  live: { text: "Live now", tone: "live" },
  booked: { text: "Booked", tone: "info" },
  outcome_due: { text: "Ended · outcome due", tone: "waiting" },
  submitted: { text: "Recorded, not published yet", tone: "quiet" },
  published: { text: "Published", tone: "quiet" },
  no_show: { text: "Student didn't join", tone: "quiet" },
  on_hold: { text: "On hold for review", tone: "quiet" },
};
const TONE_TEXT: Record<StudentTone, string> = {
  live: "text-mint",
  done: "text-mint",
  info: "text-ballpoint",
  waiting: "text-amberline",
  quiet: "text-pencil",
};

/** The confirmation shown after an outcome is saved (?done=bookingId). */
async function savedNote(bookingId: string, interviewerId: string) {
  const r = (
    await sql<{ student: string; what: string; result: string | null; publish_at: Date | null; review: string }[]>`
      SELECT u.display_name student, o.what_happened what, o.result, o.publish_at, o.review_status review
      FROM interview_outcomes o
      JOIN bookings bk ON bk.id = o.booking_id
      JOIN students s ON s.id = bk.student_id
      JOIN users u ON u.id = s.user_id
      WHERE o.booking_id = ${bookingId} AND bk.interviewer_id = ${interviewerId}`
  )[0];
  if (!r) return null;
  const first = r.student.split(" ")[0];
  if (r.what !== "COMPLETED") {
    return { text: `Recorded for ${first}: ${WHAT_HAPPENED_LABEL[r.what as WhatHappened] ?? r.what}. This applies straight away.`, editable: false };
  }
  const label = r.result ? RESULT_LABEL[r.result as OutcomeResult] : "Outcome";
  if (r.review !== "NONE") return { text: `Saved "${label}" for ${first}. It's held for the interview team to review.`, editable: false };
  return {
    text: `Saved "${label}" for ${first}. It publishes to them at ${r.publish_at ? timeOnly(r.publish_at.toISOString()) : "the end of the edit window"}.`,
    editable: true,
  };
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string; done?: string }> }) {
  const ctx = await getCtx();
  if (!ctx?.interviewerId) redirect("/start");
  const { date, done } = await searchParams;
  const [day, queue] = await Promise.all([getInterviewerDay(ctx.interviewerId, date), listOutcomesDue(ctx.interviewerId)]);
  const saved = done && isUuid(done) ? await savedNote(done, ctx.interviewerId) : null;

  // day.serverNowIso comes from the simulated clock, so "today" follows it.
  const isToday = toIST(day.dateIso).hasSame(toIST(day.serverNowIso), "day");
  const nowMs = Date.parse(day.serverNowIso);

  const briefOf = (r: ScheduleRow): BriefInfo => ({
    bookingId: r.bookingId!,
    studentName: r.studentName,
    badge: r.badge,
    bookingCode: r.bookingCode,
    skillsCleared: r.skillsCleared,
    startIso: r.startIso,
    canStart: (r.kind === "live" || r.kind === "outcome_due") && nowMs >= Date.parse(r.startIso),
    live: r.kind === "live",
    release: r.kind === "booked" && Date.parse(r.startIso) > nowMs ? Date.parse(r.startIso) - nowMs >= 24 * 3_600_000 : null,
  });

  const interviews = day.rows.filter((r) => r.bookingId);
  const openCount = day.rows.filter((r) => r.kind === "open").length;

  // ── The hero: what needs me now (today only) ──────────────────────────────────
  const live = isToday ? day.rows.find((r) => r.kind === "live") : undefined;
  const owed = queue.items[0];
  const next = isToday ? day.rows.find((r) => r.kind === "booked" && Date.parse(r.startIso) > nowMs) : undefined;

  let hero: React.ReactNode = null;
  if (isToday) {
    if (live) {
      hero = (
        <HeroFrame
          headingId="today-title"
          status={{ tone: "live", icon: "Radio", text: "Live now", pulse: true }}
          headline={`${live.studentName}, ${formatTime(live.startIso)}`}
          note={
            <>
              <p>
                {live.badge}
                {live.bookingCode ? `. Booking code ${live.bookingCode}.` : "."}
              </p>
              {Date.parse(live.startIso) > nowMs && (
                <LiveCountdown className="mt-5" targetIso={live.startIso} serverNowIso={day.serverNowIso} label="Starts in" doneText="It's time to start." />
              )}
            </>
          }
          actions={
            <ButtonLink kind="live" href={`/room/${live.bookingId}`}>
              Join the room
            </ButtonLink>
          }
        />
      );
    } else if (owed) {
      hero = (
        <HeroFrame
          headingId="today-title"
          status={{ tone: "waiting", icon: "Hourglass", text: plural(queue.items.length, "outcome to record", "outcomes to record") }}
          headline={`Record ${owed.studentName.split(" ")[0]}'s outcome`}
          mark
          note={
            <>
              <p>
                {owed.studentName}, {owed.badge}. Interview on {dateTime(owed.startIso)}.
              </p>
              {owed.overdue ? (
                <p className="mt-2 font-bold text-amberline">Overdue since {dateTime(owed.outcomeDueIso)}.</p>
              ) : (
                <LiveCountdown className="mt-5" targetIso={owed.outcomeDueIso} serverNowIso={queue.serverNowIso} label="Due in" doneText="Overdue" />
              )}
            </>
          }
          actions={
            <>
              <ButtonLink kind="next" href={`/outcome/${owed.bookingId}`}>
                Record outcome
              </ButtonLink>
              {queue.items.length > 1 && (
                <ButtonLink kind="link" href="/outcomes">
                  See all {queue.items.length}
                </ButtonLink>
              )}
            </>
          }
        />
      );
    } else if (next) {
      hero = (
        <HeroFrame
          headingId="today-title"
          status={{ tone: "info", icon: "CalendarCheck", text: "Next interview" }}
          headline={`${next.studentName} at ${formatTime(next.startIso)}`}
          note={
            <>
              <p>{next.badge}. Read the brief before you start; the room opens 10 minutes before.</p>
              <LiveCountdown className="mt-5" targetIso={next.startIso} serverNowIso={day.serverNowIso} label="Starts in" doneText="It's time." />
            </>
          }
          actions={<BriefButton info={briefOf(next)} label="Read the brief" />}
        />
      );
    } else {
      hero = (
        <HeroFrame
          headingId="today-title"
          status={{ tone: "quiet", icon: "CalendarCheck", text: "Today" }}
          headline={interviews.length ? "No more interviews today" : "No interviews today"}
          note={<p>Students book into your open slots up to 14 days ahead. Change your hours any time.</p>}
          actions={
            <ButtonLink kind="outline" href="/availability">
              Set your hours
            </ButtonLink>
          }
        />
      );
    }
  }

  return (
    <div className="space-y-10">
      <LiveRefresh />

      {saved && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-mint bg-mint-soft px-5 py-4">
          <p className="font-bold text-graphite">{saved.text}</p>
          {saved.editable && (
            <Link href={`/outcome/${done}`} className={btnClass("link")}>
              Edit it
            </Link>
          )}
        </div>
      )}

      {hero}

      <Section title={isToday ? "Your day" : "Schedule"}>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-2">
            <Link href={`/schedule?date=${day.prevIso}`} aria-label="Previous day" className="inline-flex size-11 items-center justify-center rounded-lg border-[1.5px] border-rule bg-white hover:border-graphite">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            <p className={cn("min-w-[11rem] text-center font-display text-lg font-extrabold", !isToday && "text-graphite")}>{day.label}</p>
            <Link href={`/schedule?date=${day.nextIso}`} aria-label="Next day" className="inline-flex size-11 items-center justify-center rounded-lg border-[1.5px] border-rule bg-white hover:border-graphite">
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
            {!isToday && (
              <Link href="/schedule" className={btnClass("link", "ml-2")}>
                Back to today
              </Link>
            )}
          </div>
          <p className="text-pencil">
            {interviews.length === 0 ? "No interviews" : plural(interviews.length, "interview", "interviews")}, all times IST
          </p>
        </div>

        <ul className="border-t border-rule">
          {interviews.map((r) => {
            const st =
              r.kind === "voided"
                ? { text: `Called off${r.voidReason && VOID_REASON_LABEL[r.voidReason] ? `, ${VOID_REASON_LABEL[r.voidReason]}` : ""}`, tone: "quiet" as StudentTone }
                : ROW_STATUS[r.kind] ?? { text: r.kind, tone: "quiet" as StudentTone };
            return (
              <li
                key={r.slotId}
                className={cn(
                  "grid grid-cols-[6.5rem_1fr] items-center gap-x-4 gap-y-2 border-b border-rule py-3 sm:grid-cols-[6.5rem_1fr_auto]",
                  r.kind === "live" && "-mx-3 rounded-lg border-[1.5px] border-mint bg-mint-soft px-3"
                )}
              >
                <span className="whitespace-nowrap font-display text-lg font-extrabold text-graphite">{formatTime(r.startIso)}</span>
                <span className="min-w-0">
                  <span className="block truncate font-bold text-graphite">
                    {r.studentName}
                    <span className="font-normal text-pencil">, {r.badge}</span>
                  </span>
                  <span className={cn("block text-[14px] font-bold", TONE_TEXT[st.tone])}>
                    {st.text}
                    {r.result ? `: ${RESULT_LABEL[r.result as OutcomeResult] ?? r.result}` : ""}
                  </span>
                </span>
                <span className="col-span-2 sm:col-span-1">
                  <RowAction r={r} nowMs={nowMs} brief={briefOf(r)} />
                </span>
              </li>
            );
          })}
        </ul>
        <p className="py-3 text-pencil">
          {openCount > 0 ? `${plural(openCount, "open slot", "open slots")} nobody has booked yet. ` : ""}
          <Link href="/availability" className="font-semibold text-ballpoint underline underline-offset-4">
            Change your hours
          </Link>
        </p>
      </Section>
    </div>
  );
}

/** Exactly one action per row. */
function RowAction({ r, nowMs, brief }: { r: ScheduleRow; nowMs: number; brief: BriefInfo }) {
  const small = "min-h-11 px-4 text-[15px]";
  switch (r.kind) {
    case "live":
      return (
        <Link href={`/room/${r.bookingId}`} className={btnClass("live", small)}>
          Join the room
        </Link>
      );
    case "booked":
      return <BriefButton info={brief} label="Brief" />;
    case "outcome_due":
      return (
        <Link href={`/outcome/${r.bookingId}`} className={btnClass("outline", small)}>
          Record outcome
        </Link>
      );
    case "submitted":
      return (
        <Link href={`/outcome/${r.bookingId}`} className={btnClass("outline", small)}>
          {r.editUntilIso && Date.parse(r.editUntilIso) > nowMs ? `Edit until ${timeOnly(r.editUntilIso)}` : "View"}
        </Link>
      );
    case "published":
    case "no_show":
    case "voided":
    case "on_hold":
      return (
        <Link href={`/outcome/${r.bookingId}`} className={btnClass("link")}>
          View
        </Link>
      );
    default:
      return null;
  }
}
