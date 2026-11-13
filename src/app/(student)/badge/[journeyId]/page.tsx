import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { getCtx } from "@/lib/auth";
import { sql } from "@/db";
import { getStudentDashboard, getJourneyHistory } from "@/services/studentView";
import { RULES } from "@/lib/rules";
import { VIEW, resolveAction } from "@/lib/journey/statusConfig";
import { STUDENT_STATUS, heroKind } from "@/lib/journey/studentHero";
import { badgeShort } from "@/lib/journey/trackChip";
import { cn } from "@/lib/utils";
import { HeroFrame } from "@/components/student/ui/Hero";
import { BadgeMedal } from "@/components/student/ui/BadgeMedal";
import { Achievement } from "@/components/student/ui/Achievement";
import { medalFor } from "@/lib/journey/medal";
import { ButtonLink } from "@/components/student/ui/Button";
import { BackLink, Section } from "@/components/student/ui/Section";

export default async function BadgePage({ params }: { params: Promise<{ journeyId: string }> }) {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const { journeyId } = await params;

  const dash = await getStudentDashboard(ctx.studentId);
  const j = dash.journeys.find((x) => x.journeyId === journeyId);
  if (!j) redirect("/home");

  const skills = await sql<{ name: string; min_level: number; cleared: boolean }[]>`
    SELECT s.name, r.min_level, (COALESCE(sl.level,0) >= r.min_level) cleared
    FROM badge_skill_requirements r
    JOIN skills s ON s.id = r.skill_id
    LEFT JOIN student_skill_levels sl ON sl.student_id = ${ctx.studentId} AND sl.skill_id = r.skill_id
    WHERE r.badge_id = (SELECT badge_id FROM interview_journeys WHERE id = ${journeyId})
    ORDER BY s.name`;

  const history = await getJourneyHistory(journeyId, ctx.studentId);

  const c = j.ctx;
  const nullified = j.state === "NULLIFIED";
  const maxAttempts = c.maxAttempts ?? 3;
  const attemptsUsed = c.attemptsLeft != null ? maxAttempts - c.attemptsLeft : 0;
  const interviewIsNext = j.state === "ELIGIBLE" || j.state === "BOOKED";
  const cleared = skills.filter((s) => s.cleared).length;

  // The same one action the home hero would offer for this badge.
  const def = VIEW[j.viewState];
  const primary = def.primary ? resolveAction(def.primary, c, j.allowed) : null;
  const group = dash.journeys.filter((x) => x.trackCode === j.trackCode);
  const medal = medalFor(j, group);
  const passed = j.state === "PASSED";
  // The interview step, dated per state (spec S2).
  const step = (() => {
    switch (j.state) {
      case "BOOKED":
        return c.interviewDateHuman ? `Scheduled: ${c.interviewDateHuman}, ${c.interviewTimeHuman} IST` : "Scheduled";
      case "AWAITING_RESULT":
        return c.resultAtHuman ? `Result at ${c.resultAtHuman}` : `Result pending${c.interviewDayHuman ? ` since ${c.interviewDayHuman}` : ""}`;
      case "PASSED":
        return `Cleared · ${c.interviewDateLongHuman ?? ""}`;
      case "FAILED":
        return c.nextUnlockDateHuman ? `Not cleared · reattempt from ${c.nextUnlockDateHuman}` : "Not cleared";
      case "RETAKE_LATER":
        return c.retakeDateHuman ? `Retake from ${c.retakeDateHuman} · not counted` : "Retake later · not counted";
      case "NO_SHOW":
        return c.missedRebookDateHuman ? `Missed · rebook from ${c.missedRebookDateHuman}` : "Missed";
      default:
        return `30 min, live video${interviewIsNext ? ". This is your next step." : ""}`;
    }
  })();
  const attemptsNote =
    j.state === "RETAKE_LATER"
      ? `${attemptsUsed} of ${maxAttempts} attempts used. The retake didn't count.`
      : `${attemptsUsed} of ${maxAttempts} attempts used. Cancelled interviews don't count.`;

  return (
    <div className="space-y-12">
      <div>
        <BackLink href="/tracks" label="Badges" />
        <HeroFrame
          headingId="badge-title"
          status={STUDENT_STATUS[j.viewState](c)}
          headline={`${badgeShort(j.badgeName)} badge`}
          mark={primary?.variant === "saffron" && !!primary?.href}
          note={
            <p>
              {j.trackName}. Clear {skills.length} skill{skills.length === 1 ? "" : "s"}, then pass one 30-minute live interview to earn{" "}
              {c.miles} Miles.
            </p>
          }
          actions={
            primary?.href ? (
              <>
                <ButtonLink kind={heroKind(primary.variant)} href={primary.href} download={primary.download}>
                  {primary.label}
                </ButtonLink>
                {!passed && <span className="text-[15px] text-pencil">{attemptsNote}</span>}
              </>
            ) : undefined
          }
          aside={
            passed ? (
              <Achievement
                track={j.trackCode}
                trackName={j.trackName}
                level={j.badgeLevel}
                levelName={badgeShort(j.badgeName)}
                miles={c.miles}
                earnedOn={c.interviewDateLongHuman}
                isNew={medal.isNew}
              />
            ) : (
            <div className="flex items-center gap-4 lg:flex-col lg:items-start">
              <BadgeMedal track={medal.track} level={medal.level} state={medal.state} progress={medal.progress} size="lg" isNew={medal.isNew} label={medal.label} />
              <p className={cn("font-bold", passed ? "text-gold-ink" : nullified ? "text-pencil" : "text-graphite")}>{medal.caption}</p>
            </div>
            )
          }
        />
      </div>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section title={`What you need, ${cleared} of ${skills.length + 1} done`}>
          <ol>
            {skills.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-4 border-b border-rule py-3">
                <span className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full",
                      s.cleared ? "bg-graphite text-white" : "border-[1.5px] border-rule bg-white"
                    )}
                    aria-hidden
                  >
                    {s.cleared && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  <span className={s.cleared ? "font-bold text-graphite" : "text-pencil"}>
                    {s.name}
                    <span className="sr-only">, {s.cleared ? "cleared" : "not cleared yet"}</span>
                  </span>
                </span>
                <span className="text-[15px] text-pencil">Level {s.min_level}</span>
              </li>
            ))}
            <li className="flex items-center gap-3 py-3">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  j.state === "PASSED" ? "bg-graphite text-white" : interviewIsNext ? "bg-ballpoint ring-4 ring-ballpoint-soft" : "border-[1.5px] border-rule bg-white"
                )}
                aria-hidden
              >
                {j.state === "PASSED" ? <Check className="size-3.5" strokeWidth={3} /> : interviewIsNext ? <span className="size-2 rounded-full bg-white" /> : null}
              </span>
              <span>
                <span className="font-bold text-graphite">Level Clearance Interview</span>
                <span className="block text-[15px] text-pencil">{step}</span>
              </span>
            </li>
          </ol>
        </Section>

        <Section title="What happens in the interview">
          <ul className="mt-3 space-y-3 text-pencil">
            <li>A 30-minute live video call with one GRIT interviewer.</li>
            <li>Questions on the {skills.length} skills above. Explain how you think, not only the answer.</li>
            <li>Camera on and college ID ready. No AI tools or outside help.</li>
            <li>{RULES.resultTiming}</li>
          </ul>
        </Section>

        {history.length > 0 && (
          <Section title="Your attempts" className="lg:col-span-2">
            <ul>
              {history.map((h) => (
                <li key={h.bookingId} className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-rule py-3">
                  <span>
                    <span className="font-bold text-graphite">{h.label}</span>
                    <span className="block text-[15px] text-pencil">{h.dateHuman}</span>
                  </span>
                  <span className="text-[15px] text-pencil">
                    {h.label === "Badge earned" ? "" : h.counted === null ? "Not counted until the result is out" : h.counted ? "Counted as an attempt" : "Didn't count as an attempt"}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
