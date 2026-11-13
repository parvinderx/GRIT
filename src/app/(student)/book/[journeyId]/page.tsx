import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { sql } from "@/db";
import { serverNow } from "@/lib/clock";
import { getAvailableTimes } from "@/services/availability";
import { SlotPicker } from "@/components/student/SlotPicker";
import { toIST } from "@/lib/time";
import { BackLink, PageTitle } from "@/components/student/ui/Section";
import { ButtonLink } from "@/components/student/ui/Button";

export default async function BookPage({ params }: { params: Promise<{ journeyId: string }> }) {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const { journeyId } = await params;

  const head = (
    await sql<{ badge_name: string; track_name: string; has_badge: boolean }[]>`
      SELECT b.name badge_name, t.name track_name,
             EXISTS(SELECT 1 FROM student_badges sb WHERE sb.student_id=${ctx.studentId} AND sb.status='ACTIVE') has_badge
      FROM interview_journeys j JOIN badges b ON b.id=j.badge_id JOIN tracks t ON t.id=b.track_id
      WHERE j.id=${journeyId} AND j.student_id=${ctx.studentId}`
  )[0];
  if (!head) redirect("/home");

  const { times, canBook } = await getAvailableTimes(journeyId, ctx.studentId);
  const now = await serverNow();

  // Last day to book and still fit a retry (after the longest cooldown) before the deadline.
  // Only shown once that date is inside the bookable window, so it's never noise.
  const rule = (
    await sql<{ deadline_at: Date; fail_cooldown_days: number; horizon_days: number }[]>`
      SELECT s.deadline_at, sr.fail_cooldown_days, sr.horizon_days
      FROM seasons s JOIN season_rules sr ON sr.season_id = s.id LIMIT 1`
  )[0];
  let bookByHuman: string | null = null;
  const deadlineHuman = rule ? toIST(rule.deadline_at).toFormat("d LLL") : null;
  if (rule) {
    const bookBy = new Date(rule.deadline_at.getTime() - rule.fail_cooldown_days * 86_400_000);
    const horizonEnd = now.getTime() + rule.horizon_days * 86_400_000;
    if (bookBy.getTime() > now.getTime() && bookBy.getTime() < horizonEnd) bookByHuman = toIST(bookBy).toFormat("ccc d LLL");
  }

  return (
    <div>
      <BackLink href="/home" label="Home" />
      <PageTitle
        title="Pick a time for your interview"
        intro={`${head.track_name}, ${head.badge_name} badge. A 30-minute live video interview. All times are IST.`}
      />

      {!canBook ? (
        <div className="max-w-[60ch] border-l-4 border-pencil bg-rule-soft px-5 py-4">
          <p className="font-bold text-graphite">Booking isn&apos;t open for this badge right now.</p>
          <p className="mt-1 text-pencil">Your home page shows why, and when you can book.</p>
          <ButtonLink kind="link" href="/home">
            Go to your home page
          </ButtonLink>
        </div>
      ) : (
        <SlotPicker
          journeyId={journeyId}
          times={times}
          serverNowIso={now.toISOString()}
          showDeadlineHint={!head.has_badge}
          bookByHuman={bookByHuman}
          deadlineHuman={deadlineHuman}
        />
      )}
    </div>
  );
}
