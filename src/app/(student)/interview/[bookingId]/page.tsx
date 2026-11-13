import { notFound, redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { ApiError } from "@/lib/errors";
import { getBookingForStudent } from "@/services/bookingView";
import { toIST, formatTime, timeOnly } from "@/lib/time";
import { ServerCountdown } from "@/components/primitives/ServerCountdown";
import { MyInterviewActions } from "@/components/student/MyInterviewActions";
import { JoinWindow } from "@/components/student/JoinWindow";
import { HeroFrame } from "@/components/student/ui/Hero";
import { Ticket } from "@/components/student/ui/Ticket";
import { ButtonLink } from "@/components/student/ui/Button";
import { BackLink } from "@/components/student/ui/Section";

export default async function MyInterviewPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const { bookingId } = await params;
  if (!isUuid(bookingId)) notFound();
  const b = await getBookingForStudent(bookingId, ctx.studentId).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });

  if (b.windowState === "cancelled") {
    return (
      <HeroFrame
        headingId="interview-title"
        status={{ tone: "quiet", icon: "CalendarX", text: "Cancelled" }}
        headline="This booking was cancelled"
        note={<p>This interview won&apos;t take place, so there&apos;s nothing to join. Your home page shows what you can do next.</p>}
        actions={
          <ButtonLink kind="outline" href="/home">
            Go to your home page
          </ButtonLink>
        }
      />
    );
  }

  if (b.windowState === "live" || b.windowState === "waiting") {
    return (
      <JoinWindow
        bookingId={b.bookingId}
        startIso={b.startIso}
        joinByIso={b.graceEndsIso}
        interviewerFirstName={b.interviewerFirstName}
        waiting={b.windowState === "waiting"}
        bookingCode={b.bookingCode}
      />
    );
  }

  const day = toIST(b.startIso).toFormat("cccc d LLL");
  const past = b.windowState === "past";
  const soon = b.windowState === "under12h";

  return (
    <div className="space-y-10">
      <div>
        <BackLink href="/home" label="Home" />
        <HeroFrame
          headingId="interview-title"
          status={
            past
              ? { tone: "quiet", icon: "Clock", text: "Ended" }
              : { tone: "info", icon: "CalendarCheck", text: soon ? "Interview booked, changes closed" : "Interview booked" }
          }
          headline={past ? "This interview has ended" : `${day}, ${formatTime(b.startIso)} IST`}
          note={
            past ? (
              <p>Your result shows on your home page once it&apos;s published, usually within 24 hours of the interview.</p>
            ) : (
              <p>
                {soon ? (
                  <>
                    Starts in{" "}
                    <strong className="text-graphite">
                      <ServerCountdown targetIso={b.startIso} serverNowIso={b.serverNowIso} expiredText="a moment" />
                    </strong>
                    .{" "}
                  </>
                ) : null}
                Come back to this page at {timeOnly(b.joinOpensIso)}. Refresh this page then to see the Join button.
              </p>
            )
          }
          actions={
            past ? (
              <ButtonLink kind="outline" href="/home">
                Go to your home page
              </ButtonLink>
            ) : (
              <MyInterviewActions
                bookingId={b.bookingId}
                journeyId={b.journeyId}
                startIso={b.startIso}
                windowState={b.windowState}
                changesLeft={b.changesLeft}
              />
            )
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
      </div>
    </div>
  );
}
