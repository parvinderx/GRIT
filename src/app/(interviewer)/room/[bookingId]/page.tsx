import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, Clock } from "lucide-react";
import { getCtx } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { ApiError } from "@/lib/errors";
import { sql } from "@/db";
import { getOutcomeForm } from "@/services/interviewerView";
import { interviewerJoin } from "@/services/interviewerBooking";
import { dateTime, timeOnly, toIST } from "@/lib/time";
import { HeroFrame } from "@/components/student/ui/Hero";
import { BackLink, Section } from "@/components/student/ui/Section";
import { ButtonLink, btnClass } from "@/components/student/ui/Button";
import { LiveCountdown } from "@/components/student/ui/LiveCountdown";
import { LiveRefresh } from "@/components/interviewer/LiveRefresh";

/**
 * The interview room. In production this is where the video call lives; in the
 * prototype it stands in for it. Every state ends in one clear next step:
 * before the start → wait (countdown); during → end and record; no-show → record that.
 */
export default async function RoomPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const ctx = await getCtx();
  if (!ctx?.interviewerId) redirect("/start");
  const { bookingId } = await params;
  if (!isUuid(bookingId)) notFound();
  const data = await getOutcomeForm(bookingId, ctx.interviewerId).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });

  // Already recorded, or nothing can be recorded: the outcome page explains and links on.
  if (data.alreadySubmitted || data.closedReason) redirect(`/outcome/${bookingId}`);

  // Opening the room is joining it (stands in for the video call's join event). The
  // T+15 attendance check calls the interview off if the interviewer never joined.
  await interviewerJoin({ bookingId, interviewerId: ctx.interviewerId }).catch(() => {});

  const rules = (await sql<{ slot_duration_minutes: number }[]>`SELECT slot_duration_minutes FROM season_rules LIMIT 1`)[0];
  const startMs = Date.parse(data.startIso);
  const endIso = new Date(startMs + rules.slot_duration_minutes * 60_000).toISOString();
  const nowMs = Date.parse(data.serverNowIso);
  const started = data.started || nowMs >= startMs;
  const noJoinOpen = nowMs >= Date.parse(data.noJoinFromIso);
  const first = data.studentName.split(" ")[0];

  const checks = [
    "Face matches the registered photo and college ID",
    "Camera and mic work on both sides",
    "No other tabs, notes or AI tools on their screen",
  ];

  return (
    <div className="space-y-10">
      <LiveRefresh seconds={20} />
      <div>
        <BackLink href="/schedule" label="Today" />
        <HeroFrame
          headingId="room-title"
          status={
            started
              ? { tone: "live", icon: "Radio", text: "Interview in progress", pulse: true }
              : {
                  tone: "info",
                  icon: "Clock",
                  text: toIST(data.startIso).hasSame(toIST(data.serverNowIso), "day")
                    ? `Starts at ${timeOnly(data.startIso)}`
                    : `Starts ${dateTime(data.startIso)}`,
                }
          }
          headline={`${data.studentName}, ${data.badge}`}
          mark={started}
          note={
            <>
              <p className={data.studentJoined ? "font-bold text-mint" : "font-bold text-amberline"}>
                {data.studentJoined ? `${first} has joined.` : `${first} hasn't joined yet.`}
                {data.codeVerifiedAtIso ? ` Booking code verified at ${timeOnly(data.codeVerifiedAtIso)}.` : ""}
              </p>
              {started ? (
                <LiveCountdown
                  className="mt-5"
                  targetIso={endIso}
                  serverNowIso={data.serverNowIso}
                  label="Time left"
                  doneText="Time's up. Record the outcome."
                />
              ) : (
                <LiveCountdown
                  className="mt-5"
                  targetIso={data.startIso}
                  serverNowIso={data.serverNowIso}
                  label="Starts in"
                  doneText="It's time. Start the interview."
                />
              )}
              <p className="mt-4 text-[14px]">Video calls aren&apos;t part of this prototype. This page stands in for the call.</p>
            </>
          }
          actions={
            <div className="w-full">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                {started ? (
                  <ButtonLink kind="next" href={`/outcome/${bookingId}?from=room`}>
                    End interview and record outcome
                  </ButtonLink>
                ) : (
                  <span className={btnClass("outline", "cursor-not-allowed opacity-50")} aria-disabled="true">
                    End interview and record outcome
                  </span>
                )}
                {!data.studentJoined &&
                  (noJoinOpen ? (
                    <Link href={`/outcome/${bookingId}?from=room&mark=no_join`} className={btnClass("link")}>
                      {first} didn&apos;t join
                    </Link>
                  ) : (
                    <span className="text-[15px] text-pencil">
                      If {first} doesn&apos;t join, you can record it from {timeOnly(data.noJoinFromIso)}.
                    </span>
                  ))}
              </div>
              {!started && <p className="mt-2 text-[15px] text-pencil">You can record the outcome once the interview starts at {timeOnly(data.startIso)}.</p>}
            </div>
          }
          aside={
            <div>
              <h2 className="text-lg font-extrabold text-graphite">Before you start</h2>
              <ul className="mt-2 divide-y divide-rule">
                {checks.map((c) => (
                  <li key={c} className="flex items-start gap-3 py-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-mint" strokeWidth={3} aria-hidden />
                    <span className="text-graphite">{c}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex items-center gap-2 text-[14px] text-pencil">
                <Clock className="size-4" aria-hidden /> You confirm these on the outcome form.
              </p>
            </div>
          }
        />
      </div>

      <Section title="Skills to cover" className="max-w-3xl">
        <ul className="mt-2">
          {data.skills.map((s) => (
            <li key={s} className="border-b border-rule py-3 font-bold text-graphite">
              {s}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-pencil">You&apos;ll score each of these from 1 to 4 on the outcome form.</p>
      </Section>
    </div>
  );
}
