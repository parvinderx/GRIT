import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getLeaderboard } from "@/services/leaderboard";
import { getStudentDashboard } from "@/services/studentView";
import { cn } from "@/lib/utils";
import { PageTitle, Section } from "@/components/student/ui/Section";
import { Podium, initials } from "@/components/student/Podium";
import { StandingCard } from "@/components/student/StandingCard";
import { BadgeMedal } from "@/components/student/ui/BadgeMedal";

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const { tab } = await searchParams;
  let active: "qualiflyers" | "pre" = tab === "pre" ? "pre" : "qualiflyers";
  let lb = await getLeaderboard(ctx.studentId, active);
  // No tab chosen: open on the student's own group, so "Your place" is always there.
  if (!tab && !lb.rows.some((r) => r.isMe)) {
    const pre = await getLeaderboard(ctx.studentId, "pre");
    if (pre.rows.some((r) => r.isMe)) {
      active = "pre";
      lb = pre;
    }
  }
  const dash = await getStudentDashboard(ctx.studentId);
  // Miles the student's next badge would add, for the goal line.
  const inReach = dash.journeys.find((j) => ["AWAITING_RESULT", "BOOKED", "ELIGIBLE"].includes(j.state));
  const rest = lb.rows.slice(3);
  const topMiles = Math.max(1, lb.rows[0]?.miles ?? 1);

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <PageTitle title="Leaderboard" intro="Ranked by total Miles. Every badge you earn adds Miles." className="mb-6" />

        <nav aria-label="Leaderboard groups" className="mb-6 flex gap-1 border-b border-rule">
          {[
            { key: "qualiflyers", href: "/leaderboard?tab=q", label: "Qualiflyers", hint: "1+ badge" },
            { key: "pre", href: "/leaderboard?tab=pre", label: "Pre-Qualiflyers", hint: "no badge yet" },
          ].map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active === t.key ? "page" : undefined}
              className={cn(
                "relative flex min-h-12 items-center gap-2 px-3 font-bold",
                active === t.key ? "text-graphite" : "text-pencil hover:text-graphite"
              )}
            >
              {t.label}
              <span className="hidden text-[13px] font-normal text-pencil sm:inline">{t.hint}</span>
              {active === t.key && <span className="absolute inset-x-3 -bottom-px h-[3px] rounded-t bg-graphite" aria-hidden />}
            </Link>
          ))}
        </nav>

        <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-pencil">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-highlight/50 bg-highlight/10 px-2.5 py-0.5 text-[13px] font-bold text-highlight">
            <span className="size-1.5 rounded-full bg-highlight" aria-hidden />
            Season 2026-27
          </span>
          <span>
            <strong className="text-graphite">{lb.rows.length}</strong> {active === "pre" ? "Pre-Qualiflyers" : "Qualiflyers"}
          </span>
          {lb.rows[0] && (
            <span>
              Top score <strong className="text-graphite">{lb.rows[0].miles.toLocaleString("en-IN")}</strong> Miles
            </span>
          )}
        </p>

        {active === "pre" && (
          <p className="mb-6 border-l-4 border-gold bg-gold-soft px-4 py-3 text-graphite">
            One badge moves you up to the <strong>Qualiflyers</strong>.
          </p>
        )}

        {lb.rows.length === 0 ? (
          <p className="py-8 text-pencil">No one here yet.</p>
        ) : (
          <>
            <Podium rows={lb.rows} />

            {rest.length > 0 && (
              <ol start={4} aria-label="Everyone else" className="space-y-2">
                {rest.map((r) => (
                  <li
                    key={r.rank}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-3 py-3 sm:gap-4 sm:px-4",
                      r.isMe
                        ? "border-grit-purple bg-ballpoint-soft shadow-[0_0_0_1px_var(--color-grit-purple),0_0_24px_color-mix(in_srgb,var(--color-grit-purple)_35%,transparent)]"
                        : "border-rule bg-cream"
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rule-soft font-display text-base font-bold text-pencil">
                      {r.rank}
                    </span>
                    <span
                      className="hidden size-10 shrink-0 items-center justify-center rounded-full border border-rule bg-rule-soft font-display text-sm font-bold text-graphite sm:flex"
                      aria-hidden
                    >
                      {initials(r.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate font-bold text-graphite">
                        <span className="truncate">{r.name}</span>
                        {r.isMe && <span className="shrink-0 rounded-full bg-grit-purple px-2 py-0.5 text-[12px] font-bold text-white">You</span>}
                      </p>
                      {/* Miles against the leader: how far there is to climb. */}
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-rule-soft" aria-hidden>
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(4, Math.round((r.miles / topMiles) * 100))}%`,
                            background: "linear-gradient(90deg, var(--color-grit-purple), var(--color-ballpoint))",
                          }}
                        />
                      </span>
                    </div>
                    {r.badges.length > 0 && (
                      <span className="hidden sm:flex">
                        {r.badges.map((b, i) => (
                          <BadgeMedal key={i} track={b.track} level={b.level} state="earned" size="xs" label={`${b.trackName} ${b.name}`} />
                        ))}
                      </span>
                    )}
                    <span className="w-20 shrink-0 text-right">
                      <span className="font-display text-lg font-bold text-graphite">{r.miles.toLocaleString("en-IN")}</span>
                      <span className="block text-[13px] text-pencil">Miles</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>

      <aside className="space-y-10 lg:pt-2">
        {lb.me && (
          <Section title="Your place">
            <StandingCard
              className="mt-4"
              tier={lb.me.tier}
              rank={lb.me.rank}
              miles={lb.me.miles}
              next={lb.me.next}
              lead={lb.me.lead}
              hasBadge={active === "qualiflyers"}
              badgeMiles={inReach?.ctx.miles ?? null}
              tieNote={lb.me.tieNote}
            />
          </Section>
        )}
        <Section title="How ranking works">
          <ol className="mt-3 space-y-2 text-pencil">
            <li>Most Miles ranks first. Each badge adds its Miles.</li>
            <li>Level on Miles: whoever earned their latest badge first ranks higher, then whoever joined GRIT first.</li>
          </ol>
        </Section>
      </aside>
    </div>
  );
}
