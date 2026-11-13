import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getStudentDashboard } from "@/services/studentView";
import { VIEW, type JourneyCtx } from "@/lib/journey/statusConfig";
import { STUDENT_STATUS } from "@/lib/journey/studentHero";
import { buildRoute } from "@/lib/journey/route";
import { HeroFrame } from "@/components/student/ui/Hero";
import { Route } from "@/components/student/ui/Route";
import { BadgeMedal } from "@/components/student/ui/BadgeMedal";
import { Achievement } from "@/components/student/ui/Achievement";
import { badgeShort } from "@/lib/journey/trackChip";
import { ButtonLink } from "@/components/student/ui/Button";
import { Section } from "@/components/student/ui/Section";

/** The interviewer's note and focus areas. Shown first after the hero: it's what a student can act on. */
function Feedback({ title, c }: { title: string; c: JourneyCtx }) {
  const focus = c.lastFocusAreas ?? [];
  return (
    <Section title={title} className="max-w-3xl">
      {c.lastFeedback ? (
        <blockquote className="mt-5 border-l-4 border-graphite pl-5 text-xl leading-relaxed text-graphite">
          &ldquo;{c.lastFeedback}&rdquo;
        </blockquote>
      ) : (
        <p className="mt-4 text-pencil">
          Your interviewer didn&apos;t leave a written note.{focus.length > 0 ? " The focus areas below show what to work on." : ""}
        </p>
      )}
      {focus.length > 0 && (
        <>
          <h3 className="mt-8 text-lg font-extrabold text-graphite">Work on these next</h3>
          <ul className="mt-2" aria-label="Focus areas">
            {focus.map((f) => (
              <li key={f} className="flex items-center gap-3 border-b border-rule py-3 font-bold text-graphite">
                <span className="size-2 rounded-full bg-ballpoint" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

export default async function ResultPage({ params }: { params: Promise<{ journeyId: string }> }) {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const { journeyId } = await params;
  const dash = await getStudentDashboard(ctx.studentId);
  const j = dash.journeys.find((x) => x.journeyId === journeyId);
  if (!j) redirect("/home");
  const c = j.ctx;
  const def = VIEW[j.viewState];
  const status = STUDENT_STATUS[j.viewState](c);

  // ── Earned ──────────────────────────────────────────────────────────────────
  if (j.state === "PASSED") {
    return (
      <div className="space-y-12">
        <HeroFrame
          headingId="result-title"
          status={status}
          headline={def.title(c)}
          mark
          note={
            <>
              <p>{def.body(c)}</p>
              {c.firstBadge && <p className="mt-2 font-bold text-graphite">You&apos;re now a Qualiflyer.</p>}
            </>
          }
          actions={
            <>
              <ButtonLink kind="next" href="/leaderboard">
                See your rank
              </ButtonLink>
              {j.nextBadge ? (
                <ButtonLink kind="link" href={j.nextBadge.journeyId ? `/badge/${j.nextBadge.journeyId}` : "/tracks"}>
                  Start {j.nextBadge.name}
                </ButtonLink>
              ) : (
                <ButtonLink kind="link" href="/tracks">
                  See your other badges
                </ButtonLink>
              )}
            </>
          }
          aside={
            <Achievement
              track={j.trackCode}
              trackName={j.trackName}
              level={j.badgeLevel}
              levelName={badgeShort(c.badgeName)}
              miles={c.miles}
              earnedOn={c.interviewDateLongHuman}
              isNew={!!c.earnedRecently}
            />
          }
        />

        <div className="grid gap-12 lg:grid-cols-2">
          <Section title="Where you stand now">
            <dl className="divide-y divide-rule">
              <div className="flex items-baseline justify-between py-3">
                <dt className="text-pencil">
                  Total Miles <span className="font-bold text-gold-ink">(+{c.miles.toLocaleString("en-IN")} from this badge)</span>
                </dt>
                <dd className="font-display text-2xl font-extrabold text-graphite">{dash.miles.toLocaleString("en-IN")}</dd>
              </div>
              <div className="flex items-baseline justify-between py-3">
                <dt className="text-pencil">Rank among {dash.tier}s</dt>
                <dd className="font-display text-2xl font-extrabold text-graphite">#{dash.rank}</dd>
              </div>
            </dl>
          </Section>
          <Section title="Note from your interviewer">
            <p className="mt-4 text-graphite">{c.lastFeedback ? `“${c.lastFeedback}”` : <span className="text-pencil">No written note this time.</span>}</p>
          </Section>
        </div>
      </div>
    );
  }

  // ── Result pending (spec S6 "before") ───────────────────────────────────────
  if (j.state === "AWAITING_RESULT") {
    return (
      <div className="space-y-12">
        <HeroFrame
          headingId="result-title"
          status={status}
          headline={c.resultUnderReview ? "Your result is being reviewed" : c.resultAtHuman ? `Your result comes out at ${c.resultAtHuman}` : "Your result is on the way"}
          note={
            <>
              <p>{def.body(c)}</p>
              <p className="mt-2">
                If you clear it, your badge is dated {c.interviewDayHuman ?? "your interview day"}, your interview day, and adds{" "}
                {c.miles.toLocaleString("en-IN")} Miles.
              </p>
            </>
          }
          aside={
            <div className="flex items-center gap-4 lg:flex-col lg:items-start">
              <BadgeMedal track={j.trackCode} level={j.badgeLevel} state="pending" size="lg" label={`${c.badgeName}, result pending`} />
              <p className="font-bold text-amberline">Result pending</p>
            </div>
          }
        />
        <Section title="What happens next" className="max-w-3xl">
          <ul className="mt-3 space-y-3 text-graphite">
            <li>
              <strong>Pass:</strong> the badge and {c.miles.toLocaleString("en-IN")} Miles are yours, and you move up the leaderboard.
            </li>
            <li>
              <strong>Retake later:</strong> book again after a short wait. It doesn&apos;t use an attempt.
            </li>
            <li>
              <strong>Not cleared:</strong> you get feedback and the date your next attempt opens.
            </li>
          </ul>
        </Section>
      </div>
    );
  }

  // ── Not cleared / retake / missed ───────────────────────────────────────────
  // FAILED uses an attempt; RETAKE_LATER doesn't (jobs.ts outcomePublisher leaves attempt_count alone).
  if (j.state === "FAILED" || j.state === "RETAKE_LATER" || j.state === "NO_SHOW") {
    const canRemind = !!c.hasCooldownDate && !c.cooldownPastDeadline;
    const missed = j.state === "NO_SHOW";
    return (
      <div className="space-y-12">
        <HeroFrame
          headingId="result-title"
          status={status}
          headline={def.title(c)}
          note={
            <>
              <p>{def.body(c)}</p>
              <p className="mt-2">
                {missed ? `${c.attemptsLeft ?? 0} of ${c.maxAttempts ?? 0} attempts left. ` : ""}
                {(c.daysToDeadline ?? 0) > 0
                  ? `${c.daysToDeadline} day${c.daysToDeadline === 1 ? "" : "s"} to the ${c.deadlineHuman ?? "season"} deadline.`
                  : `The ${c.deadlineHuman ?? "season"} deadline has passed.`}
              </p>
              {j.state === "RETAKE_LATER" && <p className="mt-2 font-bold text-graphite">Not counted as an attempt.</p>}
              <p className="mt-3 text-graphite">One interview doesn&apos;t define your GRIT.</p>
            </>
          }
          actions={
            <>
              {canRemind && (
                <ButtonLink kind="outline" href={`/api/v1/journeys/${journeyId}/calendar`} download>
                  {c.nextUnlockDateHuman ? `Remind me on ${c.nextUnlockDateHuman}` : "Add a reminder for that day"}
                </ButtonLink>
              )}
              <ButtonLink kind="link" href="/practise">
                How to practise
              </ButtonLink>
              {missed && (
                <ButtonLink kind="link" href="/help">
                  Problem on our side? Report it
                </ButtonLink>
              )}
            </>
          }
          aside={<Route title={c.badgeName} stops={buildRoute({ state: j.state, ctx: c, skillsCleared: j.skillsCleared, skillsTotal: j.skillsTotal })} />}
        />

        {missed && !c.hasPublishedOutcome ? (
          <Section title="No feedback for a missed interview" className="max-w-3xl">
            <p className="mt-4 text-pencil">
              Use the time before rebooking to practise the skills for this badge.{" "}
              <Link href="/practise" className="font-semibold text-ballpoint underline underline-offset-4">
                See how to practise
              </Link>
            </p>
          </Section>
        ) : (
          <Feedback
            c={c}
            title={missed ? `Feedback from your last interview${c.lastInterviewDateHuman ? `, ${c.lastInterviewDateHuman}` : ""}` : "Feedback from your interviewer"}
          />
        )}
      </div>
    );
  }

  // ── Closed (attempt limit, or closed with feedback on file) ─────────────────
  if (j.state === "CLOSED" && (j.viewState === "CLOSED_ATTEMPT_LIMIT" || c.hasPublishedOutcome)) {
    return (
      <div className="space-y-12">
        <HeroFrame
          headingId="result-title"
          status={status}
          headline={def.title(c)}
          note={
            <>
              <p>{def.body(c)}</p>
              {j.viewState === "CLOSED_ATTEMPT_LIMIT" && (
                <p className="mt-2">The interview team reviews every case within 5 working days and will let you know.</p>
              )}
            </>
          }
          actions={
            <ButtonLink kind="outline" href="/help">
              Contact GRIT support
            </ButtonLink>
          }
        />
        {c.hasPublishedOutcome && (
          <Feedback c={c} title={`Feedback from your last interview${c.lastInterviewDateHuman ? `, ${c.lastInterviewDateHuman}` : ""}`} />
        )}
      </div>
    );
  }

  redirect(`/home`);
}
