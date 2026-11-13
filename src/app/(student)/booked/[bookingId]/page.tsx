import { notFound, redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { ApiError } from "@/lib/errors";
import { getBookingForStudent } from "@/services/bookingView";
import { RULES } from "@/lib/rules";
import { toIST, formatTime, timeOnly } from "@/lib/time";
import { HeroFrame } from "@/components/student/ui/Hero";
import { Ticket } from "@/components/student/ui/Ticket";
import { ButtonLink } from "@/components/student/ui/Button";
import { Section } from "@/components/student/ui/Section";

export default async function BookedPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const { bookingId } = await params;
  if (!isUuid(bookingId)) notFound();
  const b = await getBookingForStudent(bookingId, ctx.studentId).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  // A cancelled or finished booking isn't "booked": the interview page explains it.
  if (b.windowState === "cancelled" || b.windowState === "past") redirect(`/interview/${bookingId}`);

  const when = `${toIST(b.startIso).toFormat("ccc d LLL")}, ${formatTime(b.startIso)} IST`;

  // These happen in this order, so they're numbered.
  const steps: { title: string; body: string }[] = [
    { title: "Before the day", body: RULES.changes },
    { title: "On the day", body: `Open your interview page. Join opens at ${timeOnly(b.joinOpensIso)}. ${RULES.missed}` },
    { title: "After", body: `${RULES.resultTiming} It shows on your home page.` },
  ];

  const keepReady = [
    "Camera and mic working",
    "Your college ID",
    "A quiet room",
    `Your booking code, ${b.bookingCode}. You'll read it out to your interviewer.`,
  ];
  const changesLine =
    b.windowState !== "scheduled"
      ? "Changes are closed now."
      : b.changesLeft > 0
      ? `${b.changesLeft} change${b.changesLeft === 1 ? "" : "s"} left. You can reschedule or cancel until ${toIST(b.changeCutoffIso).toFormat("ccc d LLL")}, ${formatTime(b.changeCutoffIso)} IST.`
      : "No free changes left on this booking.";

  return (
    <div className="space-y-12">
      <HeroFrame
        headingId="booked-title"
        status={{ tone: "done", icon: "CheckCircle2", text: "Booking confirmed" }}
        headline={<>You&apos;re booked for {when}</>}
        mark
        note={
          <>
            <p>Add it to your calendar now so the reminder finds you on the day.</p>
            <p className="mt-3 text-graphite">
              Your booking code is <strong className="font-display text-xl tracking-[0.14em]">{b.bookingCode}</strong>. You&apos;ll read it out
              to your interviewer when you join. It&apos;s also in the calendar invite.
            </p>
          </>
        }
        actions={
          <>
            <ButtonLink kind="next" href={`/api/v1/bookings/${bookingId}/calendar`} download={`grit-interview-${bookingId}.ics`}>
              Add to calendar
            </ButtonLink>
            <ButtonLink kind="link" href={`/interview/${bookingId}`}>
              Open your interview page
            </ButtonLink>
          </>
        }
        aside={
          <Ticket
            badgeName={b.badgeName}
            startIso={b.startIso}
            joinOpensIso={b.joinOpensIso}
            joinByIso={b.graceEndsIso}
            interviewerFirstName={b.interviewerFirstName}
            bookingCode={b.bookingCode}
            showWhen={false}
          />
        }
      />

      <div className="grid max-w-3xl gap-12 sm:grid-cols-2">
        <Section title="Keep ready">
          <ul className="mt-3 space-y-2 text-graphite">
            {keepReady.map((k) => (
              <li key={k} className="flex gap-3">
                <span className="mt-2 size-2 shrink-0 rounded-full bg-ballpoint" aria-hidden />
                {k}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Changes">
          <p className="mt-3 text-graphite">{changesLine}</p>
        </Section>
      </div>

      <Section title="What happens next" link={{ href: "/rules", label: "All interview rules" }} className="max-w-3xl">
        <ol>
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-4 border-b border-rule py-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-graphite font-display font-extrabold">
                {i + 1}
              </span>
              <div>
                <p className="font-bold text-graphite">{s.title}</p>
                <p className="mt-0.5 text-pencil">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
