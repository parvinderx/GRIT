import { sql } from "@/db";
import { CONFIRMED_FEEDBACK } from "./integrity";
import { serverNow } from "@/lib/clock";
import { formatDayShort, formatTime, toIST } from "@/lib/time";
import { FREE_CHANGES } from "@/lib/rules";
import {
  deriveViewState,
  computeStudentActions,
  type JourneyState,
  type ViewState,
  type ActionKey,
} from "@/lib/state-machine";
import type { JourneyCtx } from "@/lib/journey/statusConfig";
import { getStudentMiles } from "./students";
import { getStudentStanding, type NextGoal } from "./leaderboard";

export interface JourneyView {
  journeyId: string;
  trackCode: string;
  trackName: string;
  badgeName: string; // "AI Product Mastery · Novice"
  badgeLevel: number;
  state: JourneyState;
  viewState: ViewState;
  allowed: ActionKey[];
  ctx: JourneyCtx;
  bookingId: string | null;
  bookingStartIso: string | null;
  sort: number;
  skillsCleared: number;
  skillsTotal: number;
  /** Next badge up in the same track (by level), and the student's journey for it if enrolled. */
  nextBadge: { name: string; badgeName: string; journeyId: string | null } | null;
}

export interface StudentDashboard {
  miles: number;
  serverTimeIso: string;
  daysToDeadline: number;
  hasBadge: boolean;
  rankLabel: string;
  rank: number;
  tier: string;
  /** The rank just above (null at #1) and the lead over #2 when at #1. */
  next: NextGoal | null;
  lead: number | null;
  journeys: JourneyView[];
  hero: JourneyView | null;
}

/**
 * Which journey the dashboard hero shows. Actionable / time-critical states win:
 *   BOOKED > AWAITING_RESULT > ELIGIBLE > cooldowns (FAILED/RETAKE_LATER/NO_SHOW)
 *   > PASSED > ON_HOLD > NULLIFIED > CLOSED > LOCKED.
 * Exception: a badge awarded in the last PASSED_HERO_DAYS days (student_badges.awarded_at)
 * is celebrated above everything except a booked interview (which is time-critical).
 */
const HERO_RANK: Record<JourneyState, number> = {
  BOOKED: 9,
  AWAITING_RESULT: 8,
  ELIGIBLE: 7,
  FAILED: 6,
  RETAKE_LATER: 6,
  NO_SHOW: 6,
  PASSED: 5,
  ON_HOLD: 4,
  NULLIFIED: 3,
  CLOSED: 2,
  LOCKED: 1,
};
const RECENT_PASS_RANK = 8.5;
const PASSED_HERO_DAYS = 3;

export async function getStudentDashboard(studentId: string): Promise<StudentDashboard> {
  const now = await serverNow();
  const nowMs = now.getTime();

  const rules = (await sql<
    { change_cutoff_hours: number; priority_booking_cutoff_hours: number; join_open_minutes: number; join_grace_minutes: number; deadline_at: Date }[]
  >`
    SELECT sr.change_cutoff_hours, sr.priority_booking_cutoff_hours, sr.join_open_minutes, sr.join_grace_minutes, s.deadline_at
    FROM season_rules sr JOIN seasons s ON s.id = sr.season_id LIMIT 1`)[0];

  const rows = await sql<
    {
      journey_id: string;
      state: JourneyState;
      state_reason: string | null;
      cooldown_until: Date | null;
      priority_rebook: boolean;
      attempt_count: number;
      max_attempts: number;
      changes_count: number;
      badge_id: string;
      badge_name: string;
      badge_level: number;
      badge_miles: number;
      track_name: string;
      track_code: string;
      sort: number;
      booking_id: string | null;
      booking_start: Date | null;
      booking_code: string | null;
      interviewer_name: string | null;
    }[]
  >`
    SELECT j.id journey_id, j.state, j.state_reason, j.cooldown_until, j.priority_rebook,
           j.attempt_count, j.max_attempts, j.changes_count,
           b.id badge_id, b.name badge_name, b.level badge_level, b.miles badge_miles,
           t.name track_name, t.code track_code, t.sort,
           bk.id booking_id, bk.start_at booking_start, bk.booking_code,
           iv.display_name interviewer_name
    FROM interview_journeys j
    JOIN badges b ON b.id = j.badge_id
    JOIN tracks t ON t.id = b.track_id
    -- The journey's CURRENT booking only: a live one (CONFIRMED/IN_PROGRESS), or the
    -- completed one while its result is pending. An ELIGIBLE retry, a cooldown or a
    -- PASSED journey carries no booking (past interviews come from lastOutcomes/missed).
    LEFT JOIN LATERAL (
      SELECT * FROM bookings b2
      WHERE b2.journey_id = j.id
        AND (b2.status IN ('CONFIRMED','IN_PROGRESS')
             OR (j.state IN ('BOOKED','AWAITING_RESULT') AND b2.status = 'COMPLETED'))
      ORDER BY (b2.status IN ('CONFIRMED','IN_PROGRESS')) DESC, b2.start_at DESC
      LIMIT 1
    ) bk ON true
    LEFT JOIN interviewers iv ON iv.id = bk.interviewer_id
    WHERE j.student_id = ${studentId}
    ORDER BY t.sort, b.level`;

  // skill progress per journey
  const prog = await sql<{ journey_id: string; total: number; cleared: number }[]>`
    SELECT j.id journey_id, count(r.*)::int total,
           count(*) FILTER (WHERE sl.level >= r.min_level)::int cleared
    FROM interview_journeys j
    JOIN badge_skill_requirements r ON r.badge_id = j.badge_id
    LEFT JOIN student_skill_levels sl ON sl.student_id = j.student_id AND sl.skill_id = r.skill_id
    WHERE j.student_id = ${studentId}
    GROUP BY j.id`;
  const progById = new Map(prog.map((p) => [p.journey_id, p]));

  // latest released outcome per journey (any attempt) — feeds the result page.
  // Released = the publisher locked it and marked it RELEASED (jobs.outcomePublisher).
  const lastOutcomes = await sql<
    { journey_id: string; result: "PASS" | "FAIL" | "RETAKE_LATER"; feedback: string | null; focus_areas: string[] | null; start_at: Date }[]
  >`
    SELECT DISTINCT ON (bk.journey_id) bk.journey_id, o.result, o.feedback_to_student feedback, o.focus_areas, bk.start_at
    FROM interview_outcomes o
    JOIN bookings bk ON bk.id = o.booking_id
    JOIN interview_journeys j ON j.id = bk.journey_id
    WHERE j.student_id = ${studentId}
      AND o.result IS NOT NULL
      AND o.locked_at IS NOT NULL
      AND o.review_status = 'RELEASED'
    ORDER BY bk.journey_id, bk.start_at DESC`;
  const lastOutcomeById = new Map(lastOutcomes.map((o) => [o.journey_id, o]));

  // Journeys whose recorded result is held for a review (integrity or second review): "Result pending".
  const heldRows = await sql<{ journey_id: string }[]>`
    SELECT DISTINCT bk.journey_id
    FROM interview_outcomes o
    JOIN bookings bk ON bk.id = o.booking_id
    JOIN interview_journeys j ON j.id = bk.journey_id
    WHERE j.student_id = ${studentId} AND o.review_status IN ('WITHHELD','PENDING_SECOND_REVIEW') AND o.locked_at IS NULL`;
  const heldIds = new Set(heldRows.map((h) => h.journey_id));

  // Recorded, not yet released, not held: the student can see when it comes out.
  const dueRows = await sql<{ journey_id: string; publish_at: Date }[]>`
    SELECT DISTINCT ON (bk.journey_id) bk.journey_id, o.publish_at
    FROM interview_outcomes o
    JOIN bookings bk ON bk.id = o.booking_id
    JOIN interview_journeys j ON j.id = bk.journey_id
    WHERE j.student_id = ${studentId} AND j.state = 'AWAITING_RESULT' AND o.review_status = 'NONE'
      AND o.locked_at IS NULL AND o.result IS NOT NULL AND o.publish_at IS NOT NULL
    ORDER BY bk.journey_id, o.publish_at DESC`;
  const resultAtById = new Map(dueRows.map((d) => [d.journey_id, d.publish_at]));
  const activeBadgeCount = (await sql<{ n: number }[]>`
    SELECT count(*)::int n FROM student_badges WHERE student_id = ${studentId} AND status = 'ACTIVE'`)[0].n;

  // latest missed booking per journey (NO_SHOW bookings aren't in the main join)
  const missed = await sql<{ journey_id: string; start_at: Date }[]>`
    SELECT DISTINCT ON (bk.journey_id) bk.journey_id, bk.start_at
    FROM bookings bk JOIN interview_journeys j ON j.id = bk.journey_id
    WHERE j.student_id = ${studentId} AND bk.status = 'NO_SHOW'
    ORDER BY bk.journey_id, bk.start_at DESC`;
  const missedById = new Map(missed.map((m) => [m.journey_id, m.start_at]));

  // latest called-off booking per journey (for "Your last interview on … was called off")
  const calledOff = await sql<{ journey_id: string; start_at: Date }[]>`
    SELECT DISTINCT ON (bk.journey_id) bk.journey_id, bk.start_at
    FROM bookings bk JOIN interview_journeys j ON j.id = bk.journey_id
    WHERE j.student_id = ${studentId} AND j.priority_rebook AND bk.status IN ('VOID','CANCELLED','CANCELLED_LATE')
    ORDER BY bk.journey_id, bk.start_at DESC`;
  const calledOffById = new Map(calledOff.map((m) => [m.journey_id, m.start_at]));

  // when each earned badge was awarded (hero: celebrate a recent pass)
  const awarded = await sql<{ badge_id: string; awarded_at: Date }[]>`
    SELECT DISTINCT ON (badge_id) badge_id, awarded_at FROM student_badges
    WHERE student_id = ${studentId} AND status = 'ACTIVE'
    ORDER BY badge_id, awarded_at DESC`;
  const awardedByBadge = new Map(awarded.map((a) => [a.badge_id, a.awarded_at]));

  // next badge in the same track
  const nextBadges = await sql<{ journey_id: string; name: string; track_name: string; next_journey_id: string | null }[]>`
    SELECT j.id journey_id, nb.name, t.name track_name, nj.id next_journey_id
    FROM interview_journeys j
    JOIN badges b ON b.id = j.badge_id
    JOIN tracks t ON t.id = b.track_id
    JOIN LATERAL (
      SELECT b2.id, b2.name FROM badges b2
      WHERE b2.track_id = b.track_id AND b2.level > b.level
      ORDER BY b2.level LIMIT 1
    ) nb ON true
    LEFT JOIN interview_journeys nj ON nj.badge_id = nb.id AND nj.student_id = j.student_id
    WHERE j.student_id = ${studentId}`;
  const nextBadgeById = new Map(nextBadges.map((n) => [n.journey_id, n]));

  const miles = await getStudentMiles(studentId);
  const hasBadgeRow = await sql<{ has: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM student_badges WHERE student_id = ${studentId} AND status='ACTIVE') has`;
  const hasBadge = hasBadgeRow[0].has;

  // The student's booked interview, if any (one interview at a time).
  const otherBooked = rows.find((r) => r.booking_id && r.state === "BOOKED");

  const deadlineHuman = toIST(rules.deadline_at).toFormat("d LLL");
  const deadlineFullHuman = toIST(rules.deadline_at).toFormat("d LLL yyyy, h:mm a") + " IST";

  const daysToDeadline = Math.max(
    0,
    Math.ceil((rules.deadline_at.getTime() - nowMs) / 86_400_000)
  );

  const journeys: JourneyView[] = rows.map((r) => {
    const bookingStartMs = r.booking_start ? r.booking_start.getTime() : null;
    const hasOtherUpcoming = !!otherBooked && r.state === "ELIGIBLE";
    const journeyForView = {
      state: r.state,
      priorityRebook: r.priority_rebook,
      attemptCount: r.attempt_count,
      maxAttempts: r.max_attempts,
      stateReason: r.state_reason,
    };
    const viewState = deriveViewState(journeyForView, {
      nowMs,
      bookingStartMs,
      changeCutoffHours: rules.change_cutoff_hours,
      joinOpenMinutes: rules.join_open_minutes,
      joinGraceMinutes: rules.join_grace_minutes,
      hasOtherUpcoming,
    });

    // interviewer identity + code only inside the join window (security)
    const inJoinWindow =
      bookingStartMs != null &&
      nowMs >= bookingStartMs - rules.join_open_minutes * 60_000 &&
      nowMs <= bookingStartMs + rules.join_grace_minutes * 60_000;

    const p = progById.get(r.journey_id);
    const last = r.state === "AWAITING_RESULT" ? undefined : lastOutcomeById.get(r.journey_id);
    const missedAt = r.state === "NO_SHOW" ? missedById.get(r.journey_id) : undefined;
    const calledOffAt = r.state === "ELIGIBLE" && r.priority_rebook ? calledOffById.get(r.journey_id) : undefined;
    // The interview this card talks about: the missed one for NO_SHOW, the current
    // booking when there is one, the called-off one for priority rebooking, else the
    // last released interview (PASSED / FAILED / RETAKE_LATER).
    const interviewAt =
      r.state === "NO_SHOW"
        ? (missedAt ?? null)
        : (r.booking_start ?? calledOffAt ?? (r.state === "ELIGIBLE" ? undefined : last?.start_at) ?? null);
    const nb = nextBadgeById.get(r.journey_id);
    const cooldownPastDeadline =
      !hasBadge && !!r.cooldown_until && r.cooldown_until.getTime() > rules.deadline_at.getTime();

    const ctx: JourneyCtx = {
      journeyId: r.journey_id,
      bookingId: r.booking_id,
      badgeName: `${r.track_name} · ${r.badge_name}`,
      miles: r.badge_miles,
      skillsRemaining: p ? p.total - p.cleared : undefined,
      skillsCleared: p?.cleared,
      skillsTotal: p?.total,
      skillList: undefined,
      attemptsLeft: Math.max(0, r.max_attempts - r.attempt_count),
      maxAttempts: r.max_attempts,
      daysToDeadline,
      changesLeft: Math.max(0, FREE_CHANGES - r.changes_count),
      daysToInterview: bookingStartMs ? Math.max(0, Math.ceil((bookingStartMs - nowMs) / 86_400_000)) : undefined,
      interviewTimeHuman: interviewAt ? formatTime(interviewAt) : undefined,
      joinOpenHuman: bookingStartMs ? formatTime(new Date(bookingStartMs - rules.join_open_minutes * 60_000)) : undefined,
      changeCutoffHuman: bookingStartMs
        ? `${formatDayShort(new Date(bookingStartMs - rules.change_cutoff_hours * 3_600_000))}, ${formatTime(new Date(bookingStartMs - rules.change_cutoff_hours * 3_600_000))}`
        : undefined,
      otherBadgeName:
        otherBooked && otherBooked.journey_id !== r.journey_id ? `${otherBooked.track_name} · ${otherBooked.badge_name}` : undefined,
      otherInterviewDateHuman: otherBooked?.booking_start ? formatDayShort(otherBooked.booking_start) : undefined,
      interviewDateHuman: interviewAt ? formatDayShort(interviewAt) : undefined,
      otherBookingId: otherBooked && otherBooked.journey_id !== r.journey_id ? otherBooked.booking_id : undefined,
      hasPublishedOutcome: !!last,
      resultUnderReview: r.state === "AWAITING_RESULT" && heldIds.has(r.journey_id),
      // A confirmed integrity case records the interview as Fail with this exact note.
      notClearedAfterReview: r.state === "FAILED" && last?.feedback === CONFIRMED_FEEDBACK,
      lastOutcomeResult: last?.result,
      lastFeedback: last?.feedback ?? undefined,
      lastFocusAreas: last?.focus_areas ?? undefined,
      lastInterviewDateHuman: last ? formatDayShort(last.start_at) : undefined,
      nextUnlockDateHuman: r.cooldown_until ? formatDayShort(r.cooldown_until) : undefined,
      retakeDateHuman: r.cooldown_until ? formatDayShort(r.cooldown_until) : undefined,
      missedRebookDateHuman: r.cooldown_until ? formatDayShort(r.cooldown_until) : undefined,
      interviewerFirstName: inJoinWindow && r.interviewer_name ? r.interviewer_name.split(" ")[0] : undefined,
      bookingCode: inJoinWindow ? r.booking_code ?? undefined : undefined,
      hasCooldownDate: !!r.cooldown_until,
      cooldownPastDeadline,
      deadlineHuman,
      deadlineFullHuman,
      priorityCutoffHours: r.priority_rebook ? rules.priority_booking_cutoff_hours : undefined,
      resultAtHuman: (() => {
        const at = resultAtById.get(r.journey_id);
        if (!at || heldIds.has(r.journey_id)) return undefined;
        const sameDay = toIST(at).hasSame(toIST(now), "day");
        return sameDay ? `${formatTime(at)} today` : `${formatDayShort(at)}, ${formatTime(at)}`;
      })(),
      interviewDateLongHuman: interviewAt ? toIST(interviewAt).toFormat("d LLL yyyy") : undefined,
      interviewDayHuman: interviewAt ? toIST(interviewAt).toFormat("d LLL") : undefined,
      firstBadge: r.state === "PASSED" && activeBadgeCount === 1,
      earnedRecently: (() => {
        if (r.state !== "PASSED") return false;
        const at = awardedByBadge.get(r.badge_id);
        return !!at && nowMs - at.getTime() <= PASSED_HERO_DAYS * 86_400_000;
      })(),
      nextBadgeName: nb?.name,
      nextBadgeJourneyId: nb?.next_journey_id ?? null,
      lastWasRetake: last?.result === "RETAKE_LATER",
    };

    const allowed = computeStudentActions(
      { ...journeyForView, cooldownUntil: r.cooldown_until },
      {
        nowMs,
        bookingStartMs,
        changeCutoffHours: rules.change_cutoff_hours,
        joinOpenMinutes: rules.join_open_minutes,
        joinGraceMinutes: rules.join_grace_minutes,
        hasOtherUpcoming,
        changesCount: r.changes_count,
        joinWindowOpen: inJoinWindow,
      }
    );

    return {
      journeyId: r.journey_id,
      trackCode: r.track_code,
      trackName: r.track_name,
      badgeName: ctx.badgeName,
      badgeLevel: r.badge_level,
      state: r.state,
      viewState,
      allowed,
      ctx,
      bookingId: r.booking_id,
      bookingStartIso: r.booking_start ? r.booking_start.toISOString() : null,
      sort: r.sort,
      skillsCleared: p?.cleared ?? 0,
      skillsTotal: p?.total ?? 0,
      nextBadge: nb ? { name: nb.name, badgeName: `${nb.track_name} · ${nb.name}`, journeyId: nb.next_journey_id } : null,
    };
  });

  const badgeIdByJourney = new Map(rows.map((r) => [r.journey_id, r.badge_id]));
  const heroRank = (j: JourneyView) => {
    if (j.state === "PASSED") {
      const at = awardedByBadge.get(badgeIdByJourney.get(j.journeyId) ?? "");
      if (at && nowMs - at.getTime() <= PASSED_HERO_DAYS * 86_400_000) return RECENT_PASS_RANK;
    }
    return HERO_RANK[j.state];
  };
  const hero = journeys.slice().sort((a, b) => heroRank(b) - heroRank(a))[0] ?? null;

  // Same ranking as /leaderboard: rank within the student's tier, created_at tie-break.
  const { rank, tier, next, lead } = await getStudentStanding(studentId);
  const rankLabel = `${tier} · #${rank}`;

  return {
    miles,
    serverTimeIso: now.toISOString(),
    daysToDeadline,
    hasBadge,
    rankLabel,
    rank,
    tier,
    next,
    lead,
    journeys,
    hero,
  };
}

export interface JourneyHistoryItem {
  bookingId: string;
  dateHuman: string;
  /** Student-safe label only: never a score, a note, a hold reason or who interviewed. */
  label: "Badge earned" | "Not cleared" | "Retake later" | "Missed" | "Called off: didn't count" | "Result pending" | "Badge removed after a review";
  /** Whether this interview used one of the badge's attempts. null = not decided yet. */
  counted: boolean | null;
}

/**
 * Past interviews on one journey, newest first. Results appear only once RELEASED
 * (same gate as the result page); a held or unreleased result reads "Result pending".
 * Attempts are used by Fail and No-show only (jobs.ts); Retake later and called-off don't.
 */
export async function getJourneyHistory(journeyId: string, studentId: string): Promise<JourneyHistoryItem[]> {
  const rows = await sql<{ booking_id: string; start_at: Date; status: string; result: "PASS" | "FAIL" | "RETAKE_LATER" | null; nullified: boolean }[]>`
    SELECT bk.id booking_id, bk.start_at, bk.status,
           EXISTS (SELECT 1 FROM student_badges sb WHERE sb.outcome_id = o.id AND sb.status = 'NULLIFIED') OR j.state = 'NULLIFIED' nullified,
           CASE WHEN o.review_status = 'RELEASED' AND o.locked_at IS NOT NULL THEN o.result END result
    FROM bookings bk
    JOIN interview_journeys j ON j.id = bk.journey_id
    LEFT JOIN interview_outcomes o ON o.booking_id = bk.id
    WHERE bk.journey_id = ${journeyId} AND j.student_id = ${studentId}
      AND bk.status IN ('COMPLETED', 'NO_SHOW', 'VOID')
    ORDER BY bk.start_at DESC`;
  return rows.map((r): JourneyHistoryItem => {
    const dateHuman = `${formatDayShort(r.start_at)}, ${formatTime(r.start_at)} IST`;
    if (r.status === "NO_SHOW") return { bookingId: r.booking_id, dateHuman, label: "Missed", counted: true };
    if (r.status === "VOID") return { bookingId: r.booking_id, dateHuman, label: "Called off: didn't count", counted: false };
    if (r.result === "PASS" && r.nullified) return { bookingId: r.booking_id, dateHuman, label: "Badge removed after a review", counted: false };
    if (r.result === "PASS") return { bookingId: r.booking_id, dateHuman, label: "Badge earned", counted: false };
    if (r.result === "FAIL") return { bookingId: r.booking_id, dateHuman, label: "Not cleared", counted: true };
    if (r.result === "RETAKE_LATER") return { bookingId: r.booking_id, dateHuman, label: "Retake later", counted: false };
    return { bookingId: r.booking_id, dateHuman, label: "Result pending", counted: null };
  });
}
