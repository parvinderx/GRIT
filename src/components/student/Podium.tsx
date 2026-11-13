import { cn } from "@/lib/utils";
import { shortName, type LbRow } from "@/services/leaderboard";
import { BadgeMedal } from "./ui/BadgeMedal";

const PLACE = {
  1: { metal: "linear-gradient(135deg,#fff3c2,#f6cb4f 40%,#c08a12 75%,#f3d06a)", edge: "#f6cb4f", height: "h-32", tint: "48%" },
  2: { metal: "linear-gradient(135deg,#ffffff,#cfd6e2 45%,#8e97a8 80%,#dfe4ec)", edge: "#cfd6e2", height: "h-24", tint: "30%" },
  3: { metal: "linear-gradient(135deg,#ffd9b8,#d4955e 45%,#8a5228 80%,#e3a877)", edge: "#d4955e", height: "h-16", tint: "22%" },
} as const;

export function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function Crown() {
  return (
    <svg viewBox="0 0 32 22" className="h-6 w-9 drop-shadow-[0_0_8px_rgba(246,203,79,0.6)]" aria-hidden>
      <path d="M3 19 1.5 5l8 6.5L16 1l6.5 10.5 8-6.5L29 19Z" fill="#f6cb4f" stroke="#9a6d0c" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="1.5" cy="5" r="1.8" fill="#fff3c2" />
      <circle cx="16" cy="1.6" r="1.8" fill="#fff3c2" />
      <circle cx="30.5" cy="5" r="1.8" fill="#fff3c2" />
    </svg>
  );
}

/** The top three of a leaderboard tab: 2nd · 1st · 3rd on metal-edged plinths, a crown on 1st. */
export function Podium({ rows }: { rows: LbRow[] }) {
  const top = rows.slice(0, 3);
  if (top.length === 0) return null;

  return (
    <div
      className="relative mb-8 overflow-hidden rounded-2xl border border-rule px-3 pt-8 sm:px-6"
      style={{
        background:
          "radial-gradient(60% 70% at 50% 18%, color-mix(in srgb, var(--color-grit-purple) 35%, transparent), transparent 75%), var(--color-cream)",
      }}
    >
      {/* Rank order in the DOM (screen readers); 2nd · 1st · 3rd on screen. */}
      <ol aria-label="Top three" className="flex items-end justify-center gap-2 sm:gap-4">
        {top.map((r) => {
          const p = PLACE[r.rank as 1 | 2 | 3];
          const first = r.rank === 1;
          return (
            <li
              key={r.rank}
              className={cn(
                "flex w-1/3 min-w-0 max-w-48 flex-col items-center text-center",
                first ? "order-2" : r.rank === 2 ? "order-1" : "order-3"
              )}
            >
              {first && <Crown />}
              <span
                className={cn("flex items-center justify-center rounded-full p-[3px]", first ? "size-20" : "size-16")}
                style={{ background: p.metal, boxShadow: first ? "0 0 28px rgba(246,203,79,0.45)" : undefined }}
                aria-hidden
              >
                <span
                  className={cn(
                    "flex size-full items-center justify-center rounded-full bg-cream font-display font-bold text-graphite",
                    first ? "text-2xl" : "text-lg"
                  )}
                >
                  {initials(r.name)}
                </span>
              </span>
              <p className="mt-2 w-full truncate font-bold text-graphite">{r.isMe ? "You" : shortName(r.name)}</p>
              <p className="text-[14px] text-pencil">
                <span className={cn("font-display font-bold text-graphite", first ? "text-xl" : "text-lg")}>
                  {r.miles.toLocaleString("en-IN")}
                </span>{" "}
                Miles
              </p>
              {r.badges.length > 0 && (
                <span className="mt-1 flex flex-wrap justify-center">
                  {r.badges.map((b, i) => (
                    <BadgeMedal key={i} track={b.track} level={b.level} state="earned" size="xs" label={`${b.trackName} ${b.name}`} />
                  ))}
                </span>
              )}
              <div
                className={cn("mt-3 flex w-full items-start justify-center rounded-t-2xl pt-3", p.height)}
                style={{
                  borderTop: `4px solid ${p.edge}`,
                  background: `linear-gradient(180deg, color-mix(in srgb, var(--color-grit-purple) ${p.tint}, var(--color-cream)), var(--color-cream))`,
                }}
              >
                <span
                  className="flex size-9 items-center justify-center rounded-full font-display text-lg font-bold text-[#1a1300]"
                  style={{ background: p.metal }}
                >
                  {r.rank}
                  <span className="sr-only"> place</span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
