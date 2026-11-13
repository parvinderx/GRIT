import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getStudentDashboard, type JourneyView } from "@/services/studentView";
import { JourneyHero } from "@/components/student/JourneyHero";
import { HeroFrame } from "@/components/student/ui/Hero";
import { Section } from "@/components/student/ui/Section";
import { BadgeShelf, groupByTrack } from "@/components/student/BadgeShelf";
import { StandingCard } from "@/components/student/StandingCard";
import { trackBookHref } from "@/lib/journey/trackChip";
import { RULES } from "@/lib/rules";

/**
 * Home reads top to bottom in the order a student asks:
 *   1. Where am I, and what do I do now?  (hero + route)
 *   2. How are my other badges going?     (tracks as rows)
 *   3. Where do I stand?                  (rank + Miles, one line each)
 */
export default async function HomePage() {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const dash = await getStudentDashboard(ctx.studentId);
  const hero = dash.hero;

  const tracks = groupByTrack(dash.journeys);

  // The hero already offers "Book" for its journey, so its row shows a status instead.
  const heroOffersBook = hero ? trackBookHref(hero) != null : false;
  // Calm "dated way forward" for every student with no badge yet, until the deadline
  // (spec: shown before the result, gone after a Pass, stays after Fail / Retake).
  const showDeadlineStrip = !dash.hasBadge && dash.daysToDeadline > 0 && !!hero;
  const deadlineDay = hero?.ctx.deadlineFullHuman?.split(",")[0] ?? hero?.ctx.deadlineHuman ?? "the deadline";
  // Miles the next badge in reach would add (for "Where you stand").
  const nextBadge = pickNextBadge(dash.journeys);
  const firstName = ctx.name.trim().split(/\s+/)[0];

  return (
    <div className="space-y-12">
      <div>
        <p className="mb-3 text-[15px] text-pencil">Hi {firstName}</p>
        {hero ? (
          <JourneyHero
            state={hero.state}
            viewState={hero.viewState}
            ctx={hero.ctx}
            allowed={hero.allowed}
            skillsCleared={hero.skillsCleared}
            skillsTotal={hero.skillsTotal}
            bookingStartIso={hero.bookingStartIso}
            serverNowIso={dash.serverTimeIso}
            trackCode={hero.trackCode}
            badgeLevel={hero.badgeLevel}
          />
        ) : (
          <HeroFrame
            headingId="hero-title"
            status={{ tone: "quiet", icon: "Info", text: "Not enrolled yet" }}
            headline="Your tracks will show up here"
            note={<p>Once your programme team enrols you in a track, its badges and your next step appear on this page.</p>}
          />
        )}
      </div>

      {showDeadlineStrip && hero && (
        <p className="-mt-6 border-l-4 border-rule bg-rule-soft px-4 py-3 text-[15px] text-graphite">
          <strong>
            {dash.daysToDeadline} day{dash.daysToDeadline === 1 ? "" : "s"}
          </strong>{" "}
          to earn your first Track Badge · deadline {deadlineDay}.
        </p>
      )}

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section title="Your badges" link={tracks.length ? { href: "/tracks", label: "All badges" } : undefined}>
          {tracks.length === 0 ? (
            <p className="py-4 text-pencil">Nothing here yet.</p>
          ) : (
            <BadgeShelf tracks={tracks} variant="compact" hideBookFor={heroOffersBook ? hero?.journeyId : undefined} />
          )}
        </Section>

        <Section title="Where you stand">
          <StandingCard
            className="mt-4"
            tier={dash.tier}
            rank={dash.rank}
            miles={dash.miles}
            next={dash.next}
            lead={dash.lead}
            hasBadge={dash.hasBadge}
            badgeMiles={nextBadge?.ctx.miles ?? null}
            showLink
          />

          <details className="group mt-6 border-t border-rule pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-bold text-graphite">
              Two rules to remember
              <span className="text-xl text-pencil transition-transform group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <ul className="mt-1 space-y-2 text-[15px] text-pencil">
              <li>{RULES.changes}</li>
              <li>{RULES.missed}</li>
            </ul>
            <Link href="/rules" className="mt-2 inline-flex min-h-11 items-center text-[15px] font-semibold text-ballpoint underline underline-offset-4">
              All interview rules
            </Link>
          </details>
        </Section>
      </div>
    </div>
  );
}

/** The badge most likely to come next: booked or pending first, then ready, then the closest locked one. */
function pickNextBadge(journeys: JourneyView[]): JourneyView | undefined {
  const order: Record<string, number> = { AWAITING_RESULT: 0, BOOKED: 1, ELIGIBLE: 2, RETAKE_LATER: 3, FAILED: 3, NO_SHOW: 3, LOCKED: 4 };
  return journeys
    .filter((j) => j.state in order)
    .sort((a, b) => order[a.state] - order[b.state] || a.skillsTotal - a.skillsCleared - (b.skillsTotal - b.skillsCleared))[0];
}
