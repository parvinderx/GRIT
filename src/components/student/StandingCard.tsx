import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NextGoal } from "@/services/leaderboard";

/**
 * Where the student stands, with one concrete next goal: the Miles to the rank above,
 * the lead at #1, or (no badge yet) the badge that moves them into the Qualiflyers.
 */
export function StandingCard({
  tier,
  rank,
  miles,
  next,
  lead,
  hasBadge,
  badgeMiles,
  tieNote,
  showLink = false,
  className,
}: {
  tier: string;
  rank: number;
  miles: number;
  next: NextGoal | null;
  lead: number | null;
  hasBadge: boolean;
  /** Miles the student's next badge would add (e.g. 150), if one is in reach. */
  badgeMiles?: number | null;
  tieNote?: string | null;
  showLink?: boolean;
  className?: string;
}) {
  const n = (v: number) => v.toLocaleString("en-IN");
  const qualiflyer = hasBadge;
  const pct = next && next.aboveMiles > 0 ? Math.max(4, Math.min(100, Math.round((miles / next.aboveMiles) * 100))) : 100;

  return (
    <div className={cn("grit-card", className)}>
      <p className="grit-band flex items-center gap-2 bg-ballpoint px-5 py-3 text-[15px] font-bold text-white">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full border-2",
            qualiflyer ? "border-gold bg-gold-soft text-gold-ink" : "border-white/70 bg-white/10 text-white"
          )}
          aria-hidden
        >
          <svg viewBox="0 0 20 20" className="size-3.5" fill="currentColor">
            <path d="M10 2.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.8l5-.7z" />
          </svg>
        </span>
        {tier}
      </p>

      <div className="p-5">
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-[14px] text-pencil">Your rank</dt>
          <dd className="font-display text-4xl font-black leading-none text-graphite">#{rank}</dd>
        </div>
        <div>
          <dt className="text-[14px] text-pencil">Miles</dt>
          <dd className="font-display text-4xl font-black leading-none text-graphite">{n(miles)}</dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-rule pt-4">
        {!qualiflyer ? (
          <p className="text-graphite">
            Earn your first badge{badgeMiles ? ` (+${n(badgeMiles)} Miles)` : ""} to join the <strong>Qualiflyers</strong>.
          </p>
        ) : next ? (
          <>
            <p className="text-graphite">
              {next.gap === 0 ? (
                <>
                  You and <strong>#{next.aboveRank} {next.aboveName}</strong> are level on Miles.
                </>
              ) : (
                <>
                  #{next.aboveRank} {next.aboveName} is <strong>{n(next.gap)} Miles</strong> ahead of you.
                </>
              )}
              {badgeMiles && badgeMiles > next.gap ? ` Your next badge (+${n(badgeMiles)}) would put you ahead.` : ""}
            </p>
            <div
              className="mt-3 h-2.5 overflow-hidden rounded-full bg-rule-soft"
              role="progressbar"
              aria-label={`Miles toward #${next.aboveRank}`}
              aria-valuemin={0}
              aria-valuemax={next.aboveMiles}
              aria-valuenow={miles}
            >
              <div className="h-full rounded-full bg-ballpoint" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <p className="text-graphite">
            You&apos;re <strong>#1</strong> among {tier}s{lead != null && lead > 0 ? `, ${n(lead)} Miles ahead of #2` : ""}.
          </p>
        )}
        {tieNote && <p className="mt-2 text-[14px] text-pencil">{tieNote}</p>}
      </div>

      </div>
      {showLink && (
        <Link
          href={hasBadge ? "/leaderboard" : "/leaderboard?tab=pre"}
          className="-mt-2 mb-3 ml-5 inline-flex min-h-11 items-center font-semibold text-ballpoint underline underline-offset-4"
        >
          See the leaderboard
        </Link>
      )}
    </div>
  );
}
