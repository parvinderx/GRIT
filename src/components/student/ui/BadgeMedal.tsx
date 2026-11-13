import { cn } from "@/lib/utils";
import { trackTheme } from "@/lib/journey/trackTheme";

export type MedalState =
  | "earned" // badge earned: gold sunburst, glowing core, laurel, ribbons
  | "pending" // interview done, result on the way
  | "booked" // interview booked
  | "ready" // skills cleared, ready to book
  | "waiting" // not cleared / retake / missed: a dated way back
  | "progress" // skills still to clear (arc shows how far)
  | "locked" // waiting on the badge below
  | "closed" // booking closed
  | "nullified"; // badge removed after a review

const SIZE = { xs: 30, sm: 44, md: 76, lg: 132, xl: 184 } as const;
const ROMAN = ["", "I", "II", "III", "IV", "V"];
const CX = 60;
const CY = 56;

/** A 16-point sunburst around the medal: the "medal" silhouette. */
function sunburst(outer: number, inner: number, points = 16): string {
  const pts: string[] = [];
  for (let k = 0; k < points * 2; k++) {
    const a = (k * Math.PI) / points - Math.PI / 2;
    const r = k % 2 === 0 ? outer : inner;
    pts.push(`${(CX + r * Math.cos(a)).toFixed(2)},${(CY + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}
const BURST = sunburst(51, 45);

/** Laurel leaves along the lower half of the core, left and right. */
function laurel(): { x: number; y: number; rot: number }[] {
  // SVG angles (y down): 90° is the bottom. Each branch climbs from the bottom up one side.
  const left = [118, 142, 166, 190, 214];
  const right = [62, 38, 14, -10, -34];
  const r = 28;
  const leaf = (deg: number, tilt: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: CX + r * Math.cos(a), y: CY + 2 + r * Math.sin(a), rot: deg + 90 + tilt };
  };
  return [...left.map((d) => leaf(d, 28)), ...right.map((d) => leaf(d, -28))];
}
const LEAVES = laurel();

function Sparkle({ x, y, s, delay }: { x: number; y: number; s: number; delay: string }) {
  return (
    <path
      className="medal-sparkle"
      style={{ animationDelay: delay, transformOrigin: `${x}px ${y}px` }}
      d={`M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z`}
      fill="#fff6c9"
    />
  );
}

/**
 * A track badge as a medal. Earned: a gold sunburst medal with a glowing track-colour
 * core, laurel wreath, level numeral, name banner and ribbons, so it reads as an
 * achievement. Not yet earned: the same silhouette, unlit, with a ring that says where
 * the student is. Every state is also named in `label` and in the caller's text, so the
 * medal is never the only signal. `isNew` plays a one-time settle-and-shine; sparkles
 * twinkle on large earned medals (both respect prefers-reduced-motion).
 */
export function BadgeMedal({
  track,
  level,
  state,
  progress = 0,
  size = "md",
  label,
  name,
  isNew = false,
  className,
}: {
  /** tracks.code */
  track: string;
  /** 1 = Novice, 2 = Specialist, ... */
  level: number;
  state: MedalState;
  /** 0..1, for the "progress" arc (skills cleared / total). */
  progress?: number;
  size?: keyof typeof SIZE;
  /** Accessible name. Omit when the medal sits next to the same text. */
  label?: string;
  /** Level name for the banner on large earned medals ("Novice"). */
  name?: string;
  isNew?: boolean;
  className?: string;
}) {
  const t = trackTheme(track);
  const w = SIZE[size];
  const h = Math.round((w * 136) / 120);
  const earned = state === "earned";
  const big = size === "md" || size === "lg" || size === "xl";
  const dim = state === "locked" || state === "closed" || state === "nullified";
  const C = 2 * Math.PI * 44;
  const arc = Math.max(0, Math.min(1, progress)) * C;

  const ring = (() => {
    switch (state) {
      case "booked":
        return <circle cx={CX} cy={CY} r="44" fill="none" stroke="var(--color-ballpoint)" strokeWidth="5" />;
      case "ready":
        return <circle cx={CX} cy={CY} r="44" fill="none" stroke={t.hue} strokeWidth="5" />;
      case "pending":
        return <circle cx={CX} cy={CY} r="44" fill="none" stroke="var(--color-amberline)" strokeWidth="4" strokeDasharray="7 5" />;
      case "waiting":
        return <circle cx={CX} cy={CY} r="44" fill="none" stroke="var(--color-amberline)" strokeWidth="3" />;
      case "progress":
        return (
          <>
            <circle cx={CX} cy={CY} r="44" fill="none" stroke="var(--color-rule)" strokeWidth="5" />
            {arc > 0 && (
              <circle
                cx={CX}
                cy={CY}
                r="44"
                fill="none"
                stroke={t.hue}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${arc} ${C}`}
                transform={`rotate(-90 ${CX} ${CY})`}
              />
            )}
          </>
        );
      case "nullified":
        return <circle cx={CX} cy={CY} r="44" fill="none" stroke="var(--color-silver)" strokeWidth="4" />;
      default:
        return <circle cx={CX} cy={CY} r="44" fill="none" stroke="var(--color-pencil)" strokeWidth="2.5" strokeDasharray="4 5" opacity="0.7" />;
    }
  })();

  return (
    <span
      className={cn("relative inline-block shrink-0", isNew && earned && "medal-new", className)}
      style={{ width: w, height: h }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 120 136" width={w} height={h} aria-hidden overflow="visible">
        <defs>
          <linearGradient id="m-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff3c2" />
            <stop offset="0.35" stopColor="#f6cb4f" />
            <stop offset="0.7" stopColor="#c08a12" />
            <stop offset="1" stopColor="#f3d06a" />
          </linearGradient>
          <linearGradient id="m-gold-deep" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9a52b" />
            <stop offset="1" stopColor="#8a6008" />
          </linearGradient>
          {/* Earned palette: premium onyx + gold (ui-ux-pro-max "Premium dark + gold accent"). */}
          <radialGradient id="m-onyx" cx="0.35" cy="0.28" r="0.85">
            <stop offset="0" stopColor="#57534e" />
            <stop offset="0.5" stopColor="#292524" />
            <stop offset="1" stopColor="#0c0a09" />
          </radialGradient>
          <linearGradient id="m-onyx-ribbon" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#44403c" />
            <stop offset="1" stopColor="#1c1917" />
          </linearGradient>
          <radialGradient id="m-gold-glow" cx="0.5" cy="0.45" r="0.5">
            <stop offset="0" stopColor="#f6cb4f" stopOpacity="0.45" />
            <stop offset="0.6" stopColor="#ca8a04" stopOpacity="0.14" />
            <stop offset="1" stopColor="#ca8a04" stopOpacity="0" />
          </radialGradient>
          <clipPath id="m-core-clip">
            <circle cx={CX} cy={CY} r="36" />
          </clipPath>
        </defs>

        {earned ? (
          <>
            {big && <circle cx={CX} cy={CY} r="62" fill="url(#m-gold-glow)" />}
            {/* ribbons */}
            <polygon points="42,86 30,132 45,123 55,134 62,94" fill="url(#m-onyx-ribbon)" stroke="#ca8a04" strokeWidth="1.2" strokeLinejoin="round" />
            <polygon points="78,86 90,132 75,123 65,134 58,94" fill="url(#m-onyx-ribbon)" stroke="#ca8a04" strokeWidth="1.2" strokeLinejoin="round" />
            {/* gold sunburst + rim */}
            <polygon points={BURST} fill="url(#m-gold)" stroke="#9a6d0c" strokeWidth="0.8" strokeLinejoin="round" />
            <circle cx={CX} cy={CY} r="41" fill="url(#m-gold-deep)" />
            <circle cx={CX} cy={CY} r="39.5" fill="none" stroke="#ffe9a3" strokeWidth="1" opacity="0.7" />
            {/* onyx core; a thin ring in the track colour keeps tracks apart */}
            <circle cx={CX} cy={CY} r="36" fill="url(#m-onyx)" />
            <circle cx={CX} cy={CY} r="33" fill="none" stroke={t.hue} strokeWidth="1.6" opacity="0.9" />
            {/* gold laurel */}
            <g fill="url(#m-gold)" opacity="0.95">
              {LEAVES.map((l, i) => (
                <ellipse key={i} cx={l.x} cy={l.y} rx="4.4" ry="1.7" transform={`rotate(${l.rot} ${l.x} ${l.y})`} />
              ))}
            </g>
            {/* star + numeral */}
            <polygon
              points="60,26.5 62.3,31.6 67.8,32 63.6,35.6 65,41 60,38 55,41 56.4,35.6 52.2,32 57.7,31.6"
              fill="#ffe27a"
            />
            <text
              x={CX}
              y="69"
              textAnchor="middle"
              fontFamily="var(--font-space-grotesk), system-ui, sans-serif"
              fontWeight="800"
              fontSize="25"
              fill="#000"
              opacity="0.5"
              dx="0.8"
              dy="1"
            >
              {ROMAN[level] ?? level}
            </text>
            <text x={CX} y="69" textAnchor="middle" fontFamily="var(--font-space-grotesk), system-ui, sans-serif" fontWeight="800" fontSize="25" fill="url(#m-gold)">
              {ROMAN[level] ?? level}
            </text>
            {/* shine across the core (new badges) */}
            {isNew && (
              <g clipPath="url(#m-core-clip)">
                <rect className="medal-shine" x="28" y="0" width="16" height="112" fill="#fff" opacity="0" />
              </g>
            )}
            {/* name banner */}
            {big && name && (
              <g>
                <polygon points="22,94 30,94 30,108 22,108 26,101" fill="#9a6d0c" />
                <polygon points="98,94 90,94 90,108 98,108 94,101" fill="#9a6d0c" />
                <rect x="28" y="92" width="64" height="17" rx="3" fill="url(#m-gold)" stroke="#9a6d0c" strokeWidth="0.8" />
                <text
                  x={CX}
                  y="104"
                  textAnchor="middle"
                  fontFamily="var(--font-space-grotesk), system-ui, sans-serif"
                  fontWeight="800"
                  fontSize="8.5"
                  letterSpacing="1.2"
                  fill="#3a2700"
                >
                  {name.toUpperCase()}
                </text>
              </g>
            )}
            {(size === "lg" || size === "xl") && (
              <g>
                <Sparkle x={10} y={22} s={6} delay="0s" />
                <Sparkle x={110} y={30} s={5} delay="0.8s" />
                <Sparkle x={106} y={88} s={4} delay="1.6s" />
                <Sparkle x={16} y={78} s={3.5} delay="2.2s" />
              </g>
            )}
          </>
        ) : (
          <>
            {/* the unlit medal: same silhouette, quiet */}
            <polygon points={BURST} fill="var(--color-rule-soft)" opacity="0.9" />
            {ring}
            <circle cx={CX} cy={CY} r="36" fill={dim ? "var(--color-rule-soft)" : t.soft} />
            <text
              x={CX}
              y="65"
              textAnchor="middle"
              fontFamily="var(--font-space-grotesk), system-ui, sans-serif"
              fontWeight="800"
              fontSize="26"
              fill={dim ? "var(--color-pencil)" : t.hue}
              opacity={dim ? 0.7 : 1}
            >
              {ROMAN[level] ?? level}
            </text>
            {state === "nullified" && (
              <line x1="34" y1="82" x2="86" y2="30" stroke="var(--color-pencil)" strokeWidth="4" strokeLinecap="round" />
            )}
            {(state === "locked" || state === "closed") && (
              <g>
                <circle cx="89" cy="85" r="13" fill="var(--color-cream)" stroke="var(--color-rule)" strokeWidth="2" />
                <rect x="82.5" y="84" width="13" height="10" rx="2" fill="var(--color-pencil)" />
                <path d="M85.5 84 v-3.2 a3.5 3.5 0 0 1 7 0 V84" fill="none" stroke="var(--color-pencil)" strokeWidth="2" />
              </g>
            )}
          </>
        )}
      </svg>
    </span>
  );
}
