import { BadgeMedal } from "./BadgeMedal";

/**
 * The earned badge, presented as an achievement: the large onyx-and-gold medal on a warm gold glow,
 * the badge name, its track, the Miles it added and the date. Used beside a Pass on Home,
 * the result page and the badge page.
 */
export function Achievement({
  track,
  trackName,
  level,
  levelName,
  miles,
  earnedOn,
  isNew,
}: {
  track: string;
  trackName: string;
  level: number;
  levelName: string;
  miles: number;
  /** "14 Nov 2026" */
  earnedOn?: string;
  isNew?: boolean;
}) {
  return (
    <div
      className="relative flex flex-col items-center overflow-hidden rounded-2xl border border-rule px-6 pb-6 pt-5 text-center"
      style={{
        background:
          "radial-gradient(120% 80% at 50% 0%, rgba(202,138,4,0.28), transparent 70%), var(--color-rule-soft)",
      }}
    >
      <BadgeMedal
        track={track}
        level={level}
        state="earned"
        size="xl"
        name={levelName}
        isNew={isNew}
        label={`${trackName} ${levelName}, earned`}
      />
      <p className="mt-2 font-display text-2xl font-bold leading-tight text-graphite">{levelName}</p>
      <p className="text-[15px] text-pencil">{trackName}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-gold/60 bg-gold-soft px-3 py-1 text-[15px] font-bold text-gold-ink">
          +{miles.toLocaleString("en-IN")} Miles
        </span>
        {earnedOn && <span className="text-[14px] text-pencil">Earned {earnedOn}</span>}
      </div>
    </div>
  );
}
