import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getStudentDashboard, type JourneyView } from "@/services/studentView";
import { PageTitle } from "@/components/student/ui/Section";
import { BadgeShelf, groupByTrack } from "@/components/student/BadgeShelf";
import { BadgeMedal } from "@/components/student/ui/BadgeMedal";
import { btnClass } from "@/components/student/ui/Button";
import { badgeShort, trackBookHref } from "@/lib/journey/trackChip";

/** The one next step on this page (it gets the highlighter). */
function nextStep(js: JourneyView[]): { text: React.ReactNode; href?: string; cta?: string } | null {
  const ready = js.find((j) => trackBookHref(j));
  if (ready) {
    return { text: <><strong>{ready.trackName} · {badgeShort(ready.badgeName)}</strong> is ready to book.</>, href: trackBookHref(ready), cta: "Book a time" };
  }
  const pending = js.find((j) => j.state === "AWAITING_RESULT");
  if (pending) {
    return {
      text: (
        <>
          Your <strong>{badgeShort(pending.badgeName)}</strong> result{" "}
          {pending.ctx.resultAtHuman ? `comes out at ${pending.ctx.resultAtHuman}` : "is on the way"}.
        </>
      ),
    };
  }
  const closest = js
    .filter((j) => j.state === "LOCKED" && j.skillsTotal > j.skillsCleared)
    .sort((a, b) => a.skillsTotal - a.skillsCleared - (b.skillsTotal - b.skillsCleared))[0];
  if (closest) {
    const left = closest.skillsTotal - closest.skillsCleared;
    return {
      text: (
        <>
          <strong>{badgeShort(closest.badgeName)}</strong> in {closest.trackName}: {left} skill{left === 1 ? "" : "s"} to go.
        </>
      ),
      href: `/badge/${closest.journeyId}`,
      cta: "See which skills",
    };
  }
  return null;
}

export default async function TracksPage() {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const dash = await getStudentDashboard(ctx.studentId);
  const tracks = groupByTrack(dash.journeys);
  const earnedJs = dash.journeys.filter((j) => j.state === "PASSED");
  const milesFromBadges = earnedJs.reduce((n, j) => n + j.ctx.miles, 0);
  const step = nextStep(dash.journeys);

  return (
    <div className="max-w-4xl">
      <PageTitle title="Your badges" intro={tracks.length ? "Each badge needs its skills cleared, then one interview." : undefined} />

      {tracks.length === 0 ? (
        <p className="border-l-4 border-pencil bg-rule-soft px-5 py-4 text-pencil">
          Your tracks will show up here once your programme team enrols you.
        </p>
      ) : (
        <>
          <div className="grit-card mb-8 grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8 sm:p-6">
            <div className="flex items-center gap-4">
              <span className="flex -space-x-3" aria-hidden>
                {earnedJs.length > 0
                  ? earnedJs.slice(0, 4).map((j) => (
                      <BadgeMedal key={j.journeyId} track={j.trackCode} level={j.badgeLevel} state="earned" size="sm" />
                    ))
                  : <BadgeMedal track="ai-product" level={1} state="locked" size="sm" />}
              </span>
              <div>
                <p className="font-display text-3xl font-black leading-none text-graphite">
                  {earnedJs.length} <span className="text-xl font-extrabold text-pencil">of {dash.journeys.length}</span>
                </p>
                <p className="text-[15px] text-pencil">
                  badges earned{milesFromBadges > 0 ? ` · ${milesFromBadges.toLocaleString("en-IN")} Miles from badges` : ""}
                </p>
              </div>
            </div>
            {step && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t-2 border-dashed border-rule pt-4 sm:border-l-2 sm:border-t-0 sm:pl-8 sm:pt-0">
                <p className="text-graphite">
                  <span className="block text-[14px] font-bold uppercase tracking-wide text-pencil">Next</span>
                  {step.text}
                </p>
                {step.href && step.cta && (
                  <Link href={step.href} className={btnClass("next")}>
                    {step.cta}
                  </Link>
                )}
              </div>
            )}
          </div>

          <BadgeShelf tracks={tracks} variant="path" />
        </>
      )}
    </div>
  );
}
