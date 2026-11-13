import { redirect } from "next/navigation";
import Link from "next/link";
import { getCtx } from "@/lib/auth";
import { sql } from "@/db";
import { getStudentDashboard } from "@/services/studentView";
import { toIST } from "@/lib/time";
import { PageTitle, Section } from "@/components/student/ui/Section";
import { BadgeMedal } from "@/components/student/ui/BadgeMedal";

export default async function ProfilePage() {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const dash = await getStudentDashboard(ctx.studentId);

  const badges = await sql<{ badge: string; track: string; track_code: string; level: number; awarded_at: Date; status: string; miles: number }[]>`
    SELECT b.name badge, t.name track, t.code track_code, b.level, sb.awarded_at, sb.status, sb.miles
    FROM student_badges sb JOIN badges b ON b.id = sb.badge_id JOIN tracks t ON t.id = b.track_id
    WHERE sb.student_id = ${ctx.studentId}
    ORDER BY sb.awarded_at DESC`;

  // Badges with an interview on the way or a dated way back (spec S7 badge shelf).
  const inProgress = dash.journeys
    .map((j) => {
      const c = j.ctx;
      const line =
        j.state === "BOOKED"
          ? `Interview on ${c.interviewDateHuman}`
          : j.state === "AWAITING_RESULT"
            ? `Interview on ${c.interviewDayHuman ?? c.interviewDateHuman} · result ${c.resultAtHuman ? `at ${c.resultAtHuman}` : "pending"}`
            : j.state === "FAILED" && c.nextUnlockDateHuman
              ? `Reattempt from ${c.nextUnlockDateHuman}`
              : j.state === "RETAKE_LATER" && c.retakeDateHuman
                ? `Retake from ${c.retakeDateHuman}`
                : j.state === "NO_SHOW" && c.missedRebookDateHuman
                  ? `Rebook from ${c.missedRebookDateHuman}`
                  : null;
      return line ? { j, line } : null;
    })
    .filter(Boolean) as { j: (typeof dash.journeys)[number]; line: string }[];

  return (
    <div className="max-w-3xl">
      <PageTitle title={ctx.name} />

      {/* Same ranking as /leaderboard (getStudentDashboard ranks through services/leaderboard). */}
      <dl className="mb-12 grid grid-cols-2 border-y-[1.5px] border-graphite">
        <div className="border-r border-rule py-4 pr-4">
          <dt className="text-pencil">Rank among {dash.tier}s</dt>
          <dd className="font-display text-4xl font-black text-graphite">#{dash.rank}</dd>
        </div>
        <div className="py-4 pl-6">
          <dt className="text-pencil">Miles</dt>
          <dd className="font-display text-4xl font-black text-graphite">{dash.miles.toLocaleString("en-IN")}</dd>
        </div>
      </dl>

      <Section title="Badges you've earned" link={{ href: dash.hasBadge ? "/leaderboard" : "/leaderboard?tab=pre", label: "See the leaderboard" }}>
        {badges.length === 0 ? (
          <p className="py-5 text-pencil">
            None yet. Clear an interview to earn your first.{" "}
            <Link href="/tracks" className="font-semibold text-ballpoint underline underline-offset-4">
              See your badges
            </Link>
          </p>
        ) : (
          <ul>
            {badges.map((b, i) => {
              const nullified = b.status === "NULLIFIED";
              return (
                <li key={i} className="flex items-center justify-between gap-4 border-b border-rule py-4">
                  <span className="flex min-w-0 items-center gap-4">
                    <BadgeMedal track={b.track_code} level={b.level} state={nullified ? "nullified" : "earned"} size="sm" />
                    <span className="min-w-0">
                      <span className="block font-bold text-graphite">{b.badge}</span>
                      <span className="block text-[15px] text-pencil">{b.track}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[15px] text-pencil">
                    {nullified ? "Nullified" : "Earned"} {toIST(b.awarded_at).toFormat("d LLL yyyy")}
                    {!nullified && <span className="block font-bold text-gold-ink">+{b.miles.toLocaleString("en-IN")} Miles</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {inProgress.length > 0 && (
        <Section title="In progress" className="mt-12">
          <ul>
            {inProgress.map(({ j, line }) => (
              <li key={j.journeyId} className="flex items-center justify-between gap-4 border-b border-rule py-4">
                <span className="flex min-w-0 items-center gap-4">
                  <BadgeMedal
                    track={j.trackCode}
                    level={j.badgeLevel}
                    state={j.state === "AWAITING_RESULT" ? "pending" : j.state === "BOOKED" ? "booked" : "waiting"}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <Link href={`/badge/${j.journeyId}`} className="block font-bold text-graphite underline-offset-4 hover:underline">
                      {j.badgeName.split("·")[1]?.trim()}
                    </Link>
                    <span className="block text-[15px] text-pencil">{j.trackName}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right text-[15px] font-semibold text-amberline">{line}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
