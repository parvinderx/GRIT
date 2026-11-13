import { sql } from "@/db";
import { toIST } from "@/lib/time";

export interface LbBadge {
  /** Short mark shown in the chip (derived from the badge name; may be the full name). */
  letter: string;
  /** Full badge level name from the badges table, e.g. "Novice". */
  name: string;
  level: number;
  /** tracks.code, for the medal colour. */
  track: string;
  trackName: string;
}

/** The rank just above you, and how far away it is. Null at #1. */
export interface NextGoal {
  aboveRank: number;
  /** "Karthik M." (first name + initial). */
  aboveName: string;
  aboveMiles: number;
  gap: number;
}

export interface LbRow {
  rank: number;
  name: string;
  batch: string | null;
  section: string | null;
  badges: LbBadge[];
  miles: number;
  isMe: boolean;
}

export type LbTab = "qualiflyers" | "pre";

export interface Leaderboard {
  rows: LbRow[];
  /** Every badge mark that appears on this tab, in level order, with its full name. */
  legend: LbBadge[];
  me: { rank: number; tier: string; miles: number; tieNote: string | null; next: NextGoal | null; lead: number | null } | null;
}

export const TIER_LABEL: Record<LbTab, string> = { qualiflyers: "Qualiflyer", pre: "Pre-Qualiflyer" };

interface RawRow {
  id: string;
  name: string;
  batch: string | null;
  section: string | null;
  miles: number;
  badges: { level: number; name: string; track: string; track_name: string }[] | null;
  /** When the latest active badge was earned (its interview time): the Miles tie-break. */
  latest_badge_at: Date | null;
}

/** "Karthik Menon" -> "Karthik M." */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

/**
 * Everyone, in leaderboard order: total Miles (base + active badges); on equal Miles,
 * whoever earned their latest badge first (its interview time, spec S7), then whoever
 * joined GRIT first. The single ranking rule: the dashboard, profile and result pages
 * all rank through here.
 */
async function loadRanked(): Promise<RawRow[]> {
  return sql<RawRow[]>`
    SELECT st.id, u.display_name name, st.batch, st.section,
           (st.base_miles + COALESCE((SELECT sum(miles) FROM student_badges sb WHERE sb.student_id=st.id AND sb.status='ACTIVE'),0))::int miles,
           (SELECT json_agg(json_build_object('level', b.level, 'name', b.name, 'track', t.code, 'track_name', t.name) ORDER BY t.sort, b.level)
              FROM student_badges sb JOIN badges b ON b.id=sb.badge_id JOIN tracks t ON t.id = b.track_id
             WHERE sb.student_id=st.id AND sb.status='ACTIVE') badges,
           (SELECT max(sb.awarded_at) FROM student_badges sb WHERE sb.student_id=st.id AND sb.status='ACTIVE') latest_badge_at
    FROM students st JOIN users u ON u.id = st.user_id
    ORDER BY miles DESC, latest_badge_at ASC NULLS LAST, st.created_at ASC`;
}

const inTab = (r: RawRow, tab: LbTab) => (tab === "qualiflyers" ? !!r.badges?.length : !r.badges?.length);

/** "Novice" → "N", "Grand Master" → "GM". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function goalAt(rows: RawRow[], idx: number): { next: NextGoal | null; lead: number | null } {
  if (idx < 0) return { next: null, lead: null };
  const above = idx > 0 ? rows[idx - 1] : null;
  const below = idx + 1 < rows.length ? rows[idx + 1] : null;
  return {
    next: above
      ? { aboveRank: idx, aboveName: shortName(above.name), aboveMiles: above.miles, gap: Math.max(0, above.miles - rows[idx].miles) }
      : null,
    lead: !above && below ? rows[idx].miles - below.miles : null,
  };
}

/** The student's tier and rank within that tier (exactly as the leaderboard shows it), plus the next goal. */
export async function getStudentStanding(
  studentId: string
): Promise<{ tier: string; tab: LbTab; rank: number; next: NextGoal | null; lead: number | null }> {
  const all = await loadRanked();
  const me = all.find((r) => r.id === studentId);
  const tab: LbTab = me && me.badges?.length ? "qualiflyers" : "pre";
  const tabRows = all.filter((r) => inTab(r, tab));
  const idx = tabRows.findIndex((r) => r.id === studentId);
  return { tier: TIER_LABEL[tab], tab, rank: idx >= 0 ? idx + 1 : 1, ...goalAt(tabRows, idx) };
}

export async function getLeaderboard(studentId: string, tab: LbTab): Promise<Leaderboard> {
  const all = await loadRanked();
  const tabRows = all.filter((r) => inTab(r, tab));

  // Marks come from the badges table names. If two different names would share
  // a mark, show those names in full so no letter is ambiguous.
  const names = new Map<string, number>(); // name -> level
  for (const r of tabRows) for (const b of r.badges ?? []) if (!names.has(b.name)) names.set(b.name, b.level);
  const byInitials = new Map<string, string[]>();
  for (const n of names.keys()) byInitials.set(initials(n), [...(byInitials.get(initials(n)) ?? []), n]);
  const markFor = (name: string) => {
    const i = initials(name);
    return i && (byInitials.get(i)?.length ?? 0) === 1 ? i : name;
  };
  const legend: LbBadge[] = [...names.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([name, level]) => ({ letter: markFor(name), name, level, track: "", trackName: "" }));

  const rows: LbRow[] = tabRows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    batch: r.batch,
    section: r.section,
    badges: (r.badges ?? []).map((b) => ({ letter: markFor(b.name), name: b.name, level: b.level, track: b.track, trackName: b.track_name })),
    miles: r.miles,
    isMe: r.id === studentId,
  }));

  const mine = rows.find((r) => r.isMe) ?? null;
  let me: Leaderboard["me"] = null;
  if (mine) {
    const myIdx = tabRows.findIndex((r) => r.id === studentId);
    const tied = rows.find((r) => !r.isMe && r.miles === mine.miles && r.rank === mine.rank + 1);
    const myBadgeAt = tabRows[myIdx]?.latest_badge_at ?? null;
    const theirBadgeAt = tied ? tabRows[tied.rank - 1]?.latest_badge_at ?? null : null;
    const byBadgeTime = !!myBadgeAt && (!theirBadgeAt || myBadgeAt.getTime() < theirBadgeAt.getTime());
    me = {
      rank: mine.rank,
      tier: TIER_LABEL[tab],
      miles: mine.miles,
      tieNote: tied
        ? byBadgeTime
          ? `Level on Miles with #${tied.rank}. You're ahead because you earned your badge first (${toIST(myBadgeAt!).toFormat("d LLL, h:mm a")} IST).`
          : `Level on Miles with #${tied.rank}. You're ahead because you joined GRIT first.`
        : null,
      ...goalAt(tabRows, myIdx),
    };
  }

  return { rows, legend, me };
}
