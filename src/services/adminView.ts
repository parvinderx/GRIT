import { sql } from "@/db";
import { serverNow } from "@/lib/clock";
import type { JourneyState } from "@/lib/state-machine";
import { OUTCOME_DUE_HOURS } from "@/services/interviewerView";

/** "GRIT-2024-0108" → "••••••••••0108" (same masking everywhere on the admin side). */
export function maskGritId(gritId: string): string {
  return gritId.replace(/.(?=.{4})/g, "•");
}

export type DeadlineRisk = "Critical" | "High" | "Watch" | "OK";

export interface TrackerRow {
  journeyId: string;
  studentId: string;
  studentName: string;
  gritIdMasked: string;
  batch: string | null;
  section: string | null;
  campus: string | null;
  trackName: string;
  trackCode: string;
  badgeName: string;
  state: JourneyState;
  /** Whole days since eligibleSinceIso on the simulated clock; null when not ELIGIBLE. */
  daysEligible: number | null;
  /** ELIGIBLE journeys only: when the journey last became ELIGIBLE (journey_events), else its updated_at. */
  eligibleSinceIso: string | null;
  bookingStartIso: string | null;
  /** The journey's CONFIRMED / IN_PROGRESS booking, for reassign / void. */
  liveBookingId: string | null;
  interviewerName: string | null;
  attemptsUsed: number;
  maxAttempts: number;
  changesUsed: number;
  badgeDateIso: string | null;
  hasBadge: boolean;
  /** The student has a CONFIRMED / IN_PROGRESS booking on any journey (one at a time, uq_bookings_student_upcoming). */
  studentHasLiveBooking: boolean;
  /** Student-level "not booked": this journey is ELIGIBLE and the student has no live booking on any journey. */
  notBooked: boolean;
  risk: DeadlineRisk;
  lastReminderIso: string | null;
  caseCode: string | null;
  caseId: string | null;
}

/** Tile counts are distinct STUDENTS (a student has one journey per badge). */
export interface TrackerTiles {
  eligible: number;
  booked: number;
  /** Students with an ELIGIBLE journey and no CONFIRMED/IN_PROGRESS booking on any journey. */
  notBooked: number;
  /** Students with a Critical or High deadline risk on any journey. */
  atRisk: number;
  /** Students with no active badge and an ELIGIBLE journey but no live booking. */
  noBadgeNotBooked: number;
  /** Students with a journey in AWAITING_RESULT. */
  resultPending: number;
  /** Students whose interviewer owes an overdue outcome (needs ctx.allOverdueJourneyIds). */
  outcomesOverdue: number;
}

export interface AdminTracker {
  serverTimeIso: string;
  deadlineIso: string;
  rows: TrackerRow[];
  tracks: { code: string; name: string }[];
}

const COOLDOWN_STATES: JourneyState[] = ["FAILED", "NO_SHOW", "RETAKE_LATER"];
const DAY_MS = 86_400_000;
/** "High" risk: ready to book, not booked, for more than this many days. */
const HIGH_RISK_DAYS = 7;

/**
 * Deadline risk. The tracker's "What do risk levels mean?" disclosure transcribes
 * this function, and countOverviewStudents() repeats it in SQL — change all three together.
 */
function computeRisk(
  r: {
    state: JourneyState;
    hasBadge: boolean;
    studentHasLiveBooking: boolean;
    /** When the journey became ready to book (ELIGIBLE), or its cooldown ended. */
    readySinceMs: number;
    cooldownMs: number | null;
  },
  nowMs: number,
  deadlineMs: number
): DeadlineRisk {
  if (r.hasBadge) return "OK";
  if (r.state === "CLOSED") return "Critical";
  const inCooldownState = COOLDOWN_STATES.includes(r.state);
  if (inCooldownState && r.cooldownMs != null && r.cooldownMs > nowMs) {
    return r.cooldownMs > deadlineMs ? "Critical" : "Watch";
  }
  // ELIGIBLE, or a cooldown state whose cooldown has ended / was never set
  // (jobs.cooldownExpiry moves those to ELIGIBLE on its next run).
  if ((r.state === "ELIGIBLE" || inCooldownState) && !r.studentHasLiveBooking) {
    if ((nowMs - r.readySinceMs) / DAY_MS > HIGH_RISK_DAYS) return "High";
  }
  return "OK";
}

export async function getAdminTracker(): Promise<AdminTracker> {
  const [now, season, rows, trackRows] = await Promise.all([
    serverNow(),
    sql<{ deadline_at: Date }[]>`SELECT deadline_at FROM seasons LIMIT 1`,
    sql<
      {
        journey_id: string;
        student_id: string;
        student_name: string;
        grit_id: string;
        batch: string | null;
        section: string | null;
        campus: string | null;
        track_name: string;
        track_code: string;
        badge_name: string;
        state: JourneyState;
        updated_at: Date;
        eligible_event_at: Date | null;
        attempt_count: number;
        max_attempts: number;
        changes_count: number;
        cooldown_until: Date | null;
        booking_start: Date | null;
        live_booking_id: string | null;
        interviewer_name: string | null;
        has_badge: boolean;
        student_live: boolean;
        badge_date: Date | null;
        last_reminder: Date | null;
        case_code: string | null;
        case_id: string | null;
      }[]
    >`
      SELECT j.id journey_id, j.student_id, u.display_name student_name, st.grit_id, st.batch, st.section, st.campus,
             t.name track_name, t.code track_code, b.name badge_name,
             j.state, j.updated_at, j.attempt_count, j.max_attempts, j.changes_count, j.cooldown_until,
             -- updated_at changes on any write; the latest transition into ELIGIBLE is the real "since".
             (SELECT max(e.created_at) FROM journey_events e WHERE e.journey_id = j.id AND e.to_state = 'ELIGIBLE') eligible_event_at,
             -- Booking fields only describe a live booking (or the one awaiting its result);
             -- an ELIGIBLE retry must not show its old completed interview as "booked".
             CASE WHEN bk.status IN ('CONFIRMED','IN_PROGRESS') OR j.state IN ('BOOKED','AWAITING_RESULT')
                  THEN bk.start_at END booking_start,
             CASE WHEN bk.status IN ('CONFIRMED','IN_PROGRESS') THEN bk.id END live_booking_id,
             CASE WHEN bk.status IN ('CONFIRMED','IN_PROGRESS') OR j.state IN ('BOOKED','AWAITING_RESULT')
                  THEN iv.display_name END interviewer_name,
             EXISTS(SELECT 1 FROM student_badges sb WHERE sb.student_id=j.student_id AND sb.status='ACTIVE') has_badge,
             EXISTS(SELECT 1 FROM bookings lb WHERE lb.student_id=j.student_id AND lb.status IN ('CONFIRMED','IN_PROGRESS')) student_live,
             (SELECT sb2.awarded_at FROM student_badges sb2 WHERE sb2.student_id=j.student_id AND sb2.badge_id=j.badge_id ORDER BY sb2.awarded_at DESC LIMIT 1) badge_date,
             (SELECT max(n.created_at) FROM notifications n WHERE n.student_id=j.student_id AND n.template = 'ADMIN_BOOKING_REMINDER') last_reminder,
             ic.code case_code, ic.id case_id
      FROM interview_journeys j
      JOIN students st ON st.id = j.student_id
      JOIN users u ON u.id = st.user_id
      JOIN badges b ON b.id = j.badge_id
      JOIN tracks t ON t.id = b.track_id
      -- One booking per journey: the active one if any, else the most recent completed.
      -- (A plain join duplicated journeys that were rebooked after a fail or no-show.)
      LEFT JOIN LATERAL (
        SELECT * FROM bookings b2
        WHERE b2.journey_id = j.id AND b2.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED')
        ORDER BY (b2.status IN ('CONFIRMED','IN_PROGRESS')) DESC, b2.start_at DESC
        LIMIT 1
      ) bk ON true
      LEFT JOIN interviewers iv ON iv.id = bk.interviewer_id
      LEFT JOIN LATERAL (
        SELECT id, code FROM integrity_cases ic2
        WHERE ic2.subject_student_id = j.student_id AND ic2.status IN ('TRIAGE','OPEN','CONFIRMED')
        ORDER BY ic2.created_at DESC LIMIT 1
      ) ic ON true
      ORDER BY t.sort, b.level, u.display_name`,
    sql<{ code: string; name: string }[]>`SELECT code, name FROM tracks ORDER BY sort`,
  ]);
  const nowMs = now.getTime();
  const deadline = season[0].deadline_at;
  const deadlineMs = deadline.getTime();

  const mapped: TrackerRow[] = rows.map((r) => {
    const eligibleSince = r.eligible_event_at ?? r.updated_at;
    // Ready since: ELIGIBLE → when it became eligible; cooldown state → when the cooldown ended.
    const readySince = r.state === "ELIGIBLE" ? eligibleSince : (r.cooldown_until ?? r.updated_at);
    const bookingStartIso = r.booking_start ? r.booking_start.toISOString() : null;
    const risk = computeRisk(
      {
        state: r.state,
        hasBadge: r.has_badge,
        studentHasLiveBooking: r.student_live,
        readySinceMs: readySince.getTime(),
        cooldownMs: r.cooldown_until ? r.cooldown_until.getTime() : null,
      },
      nowMs,
      deadlineMs
    );
    return {
      journeyId: r.journey_id,
      studentId: r.student_id,
      studentName: r.student_name,
      gritIdMasked: maskGritId(r.grit_id),
      batch: r.batch,
      section: r.section,
      campus: r.campus,
      trackName: r.track_name,
      trackCode: r.track_code,
      badgeName: r.badge_name,
      state: r.state,
      daysEligible: r.state === "ELIGIBLE" ? Math.max(0, Math.floor((nowMs - eligibleSince.getTime()) / DAY_MS)) : null,
      eligibleSinceIso: r.state === "ELIGIBLE" ? eligibleSince.toISOString() : null,
      bookingStartIso,
      liveBookingId: r.live_booking_id,
      interviewerName: r.interviewer_name,
      attemptsUsed: r.attempt_count,
      maxAttempts: r.max_attempts,
      changesUsed: r.changes_count,
      badgeDateIso: r.state === "PASSED" && r.badge_date ? r.badge_date.toISOString() : null,
      hasBadge: r.has_badge,
      studentHasLiveBooking: r.student_live,
      notBooked: r.state === "ELIGIBLE" && !r.student_live,
      risk,
      lastReminderIso: r.last_reminder ? r.last_reminder.toISOString() : null,
      caseCode: r.case_code,
      caseId: r.case_id,
    };
  });

  return {
    serverTimeIso: now.toISOString(),
    deadlineIso: deadline.toISOString(),
    rows: mapped,
    tracks: trackRows.map((t) => ({ code: t.code, name: t.name })),
  };
}

/** URL filters shared by the tracker page, its CSV export and the bulk reminder. */
export interface TrackerFilterParams {
  risk?: string;
  notbooked?: string;
  overdue?: string;
  /** "48h" = journeys whose latest booking was a no-show that started in the last 48 h. */
  missed?: string;
  state?: string;
  track?: string;
  badge?: string;
  batch?: string;
  campus?: string;
  section?: string;
  /** Days since eligible bucket: "0-2" | "3-7" | "8-14" | "15+". */
  eligible?: string;
  /** "1" = students with no active badge. */
  nobadge?: string;
  q?: string;
}

/** Buckets for the "Days since eligible" filter (spec A1: 0–2, 3–7, 8–14, >14). */
export const ELIGIBLE_BUCKETS: { value: string; label: string; min: number; max: number }[] = [
  { value: "0-2", label: "0–2 days", min: 0, max: 2 },
  { value: "3-7", label: "3–7 days", min: 3, max: 7 },
  { value: "8-14", label: "8–14 days", min: 8, max: 14 },
  { value: "15+", label: "More than 14 days", min: 15, max: Infinity },
];

/** Server-side lookups some filters need (resolveTrackerFilterContext fills them). */
export interface TrackerFilterContext {
  /** ?overdue=1: journeys whose interviewer owes an overdue outcome. */
  overdueJourneyIds?: Set<string>;
  /** ?missed=48h: journeys whose latest booking was a no-show in the last 48 h. */
  missedJourneyIds?: Set<string>;
  /** ?q=: students whose full GRIT ID matches (matched in SQL; the raw ID never leaves the server). */
  gritMatchStudentIds?: Set<string>;
  /** Every overdue-outcome journey, for the tile (filled only when resolve is asked for tiles). */
  allOverdueJourneyIds?: Set<string>;
}

/** Read the tracker filter params from a URLSearchParams / plain object. */
export function trackerFilterParamsFrom(get: (k: string) => string | null | undefined): TrackerFilterParams {
  const v = (k: string) => {
    const x = get(k);
    return typeof x === "string" && x !== "" ? x : undefined;
  };
  return {
    risk: v("risk"),
    notbooked: v("notbooked"),
    overdue: v("overdue"),
    missed: v("missed"),
    state: v("state"),
    track: v("track"),
    badge: v("badge"),
    batch: v("batch"),
    campus: v("campus"),
    section: v("section"),
    eligible: v("eligible"),
    nobadge: v("nobadge"),
    q: v("q"),
  };
}

/** Students whose raw GRIT ID contains `q` (case-insensitive). */
async function studentIdsMatchingGritId(q: string): Promise<Set<string>> {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await sql<{ id: string }[]>`SELECT id FROM students WHERE grit_id ILIKE ${`%${escaped}%`}`;
  return new Set(rows.map((r) => r.id));
}

/** Journeys whose most recent booking is a NO_SHOW that started in the last 48 h. */
export async function getMissed48hJourneyIds(): Promise<string[]> {
  const rows = await sql<{ journey_id: string }[]>`
    SELECT lb.journey_id FROM (
      SELECT DISTINCT ON (bk.journey_id) bk.journey_id, bk.status, bk.start_at
      FROM bookings bk
      ORDER BY bk.journey_id, bk.start_at DESC, bk.created_at DESC
    ) lb
    WHERE lb.status = 'NO_SHOW'
      AND lb.start_at > app_now() - interval '48 hours' AND lb.start_at <= app_now()`;
  return rows.map((r) => r.journey_id);
}

/** Run only the lookups the given filters need, in parallel. */
export async function resolveTrackerFilterContext(
  p: TrackerFilterParams,
  opts: { forTiles?: boolean } = {}
): Promise<TrackerFilterContext & { overdue: OverdueOutcome[] }> {
  const q = p.q?.trim();
  const [overdue, missed, grit] = await Promise.all([
    p.overdue === "1" || opts.forTiles ? getOverdueOutcomes() : Promise.resolve([] as OverdueOutcome[]),
    p.missed === "48h" ? getMissed48hJourneyIds() : Promise.resolve([] as string[]),
    q ? studentIdsMatchingGritId(q) : Promise.resolve(new Set<string>()),
  ]);
  return {
    overdue,
    overdueJourneyIds: new Set(overdue.map((o) => o.journeyId)),
    allOverdueJourneyIds: opts.forTiles ? new Set(overdue.map((o) => o.journeyId)) : undefined,
    missedJourneyIds: new Set(missed),
    gritMatchStudentIds: grit,
  };
}

/** Apply the tracker's URL filters (resolve `c` with resolveTrackerFilterContext). */
export function filterTrackerRows(rows: TrackerRow[], p: TrackerFilterParams, c: TrackerFilterContext = {}): TrackerRow[] {
  const query = p.q?.toLowerCase().trim();
  let out = rows;
  if (p.risk === "1") out = out.filter((r) => r.risk === "Critical" || r.risk === "High");
  if (p.notbooked === "1") out = out.filter((r) => r.notBooked);
  if (p.overdue === "1") {
    const ids = c.overdueJourneyIds ?? new Set<string>();
    out = out.filter((r) => ids.has(r.journeyId));
  }
  if (p.missed === "48h") {
    const ids = c.missedJourneyIds ?? new Set<string>();
    out = out.filter((r) => ids.has(r.journeyId));
  }
  if (p.state && p.state !== "all") out = out.filter((r) => r.state === p.state);
  if (p.track && p.track !== "all") out = out.filter((r) => r.trackCode === p.track);
  if (p.badge && p.badge !== "all") out = out.filter((r) => r.badgeName === p.badge);
  if (p.batch && p.batch !== "all") out = out.filter((r) => r.batch === p.batch);
  if (p.campus && p.campus !== "all") out = out.filter((r) => r.campus === p.campus);
  if (p.section && p.section !== "all") out = out.filter((r) => r.section === p.section);
  if (p.nobadge === "1") out = out.filter((r) => !r.hasBadge);
  const bucket = ELIGIBLE_BUCKETS.find((b) => b.value === p.eligible);
  if (bucket) out = out.filter((r) => r.daysEligible != null && r.daysEligible >= bucket.min && r.daysEligible <= bucket.max);
  if (query) {
    const grit = c.gritMatchStudentIds;
    out = out.filter(
      (r) =>
        r.studentName.toLowerCase().includes(query) ||
        (grit ? grit.has(r.studentId) : r.gritIdMasked.toLowerCase().includes(query))
    );
  }
  return out;
}

const distinctStudents = (rows: TrackerRow[], pred: (r: TrackerRow) => boolean) =>
  new Set(rows.filter(pred).map((r) => r.studentId)).size;

/**
 * Tile counts (distinct students) under the current filters, each ignoring its
 * own filter key — so a tile shows what you'd get by switching it on.
 */
export function computeTrackerTiles(rows: TrackerRow[], p: TrackerFilterParams, c: TrackerFilterContext = {}): TrackerTiles {
  const withoutState = filterTrackerRows(rows, { ...p, state: undefined }, c);
  const withoutNotBooked = filterTrackerRows(rows, { ...p, notbooked: undefined }, c);
  const withoutRisk = filterTrackerRows(rows, { ...p, risk: undefined }, c);
  const withoutNoBadge = filterTrackerRows(rows, { ...p, nobadge: undefined, notbooked: undefined }, c);
  const withoutOverdue = filterTrackerRows(rows, { ...p, overdue: undefined }, c);
  const overdueIds = c.allOverdueJourneyIds ?? new Set<string>();
  return {
    eligible: distinctStudents(withoutState, (r) => r.state === "ELIGIBLE"),
    booked: distinctStudents(withoutState, (r) => r.state === "BOOKED"),
    notBooked: distinctStudents(withoutNotBooked, (r) => r.notBooked),
    atRisk: distinctStudents(withoutRisk, (r) => r.risk === "Critical" || r.risk === "High"),
    noBadgeNotBooked: distinctStudents(withoutNoBadge, (r) => r.notBooked && !r.hasBadge),
    resultPending: distinctStudents(withoutState, (r) => r.state === "AWAITING_RESULT"),
    outcomesOverdue: distinctStudents(withoutOverdue, (r) => overdueIds.has(r.journeyId)),
  };
}

// ── Outcomes overdue ─────────────────────────────────────────────────────────
export interface OverdueOutcome {
  bookingId: string;
  journeyId: string;
  interviewerName: string;
  startIso: string;
  /** start + OUTCOME_DUE_HOURS: when the outcome became overdue. */
  dueIso: string;
}

/**
 * Every interviewer's overdue outcomes, using the interviewer queue's rule
 * (listOutcomesDue): a live or completed booking with no submitted outcome, the
 * slot has ended (or the booking is COMPLETED), the journey isn't ON_HOLD — and,
 * to be overdue, more than OUTCOME_DUE_HOURS have passed since the start.
 * One row per journey (its oldest overdue booking), so the overview count and the
 * tracker's ?overdue=1 list count the same thing.
 */
export async function getOverdueOutcomes(): Promise<OverdueOutcome[]> {
  const rows = await sql<{ booking_id: string; journey_id: string; interviewer_name: string; start_at: Date; due_at: Date }[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (bk.journey_id)
             bk.id booking_id, bk.journey_id, iv.display_name interviewer_name, bk.start_at,
             bk.start_at + make_interval(hours => ${OUTCOME_DUE_HOURS}) due_at
      FROM bookings bk
      JOIN interview_journeys j ON j.id = bk.journey_id
      JOIN interviewers iv ON iv.id = bk.interviewer_id
      LEFT JOIN interview_outcomes o ON o.booking_id = bk.id
      WHERE bk.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED')
        AND o.submitted_at IS NULL
        AND j.state <> 'ON_HOLD'
        AND (bk.status = 'COMPLETED'
             OR app_now() >= bk.start_at + make_interval(mins => (SELECT slot_duration_minutes FROM season_rules LIMIT 1)))
        AND app_now() > bk.start_at + make_interval(hours => ${OUTCOME_DUE_HOURS})
      ORDER BY bk.journey_id, bk.start_at, bk.id
    ) x
    ORDER BY start_at, booking_id`;
  return rows.map((r) => ({
    bookingId: r.booking_id,
    journeyId: r.journey_id,
    interviewerName: r.interviewer_name,
    startIso: r.start_at.toISOString(),
    dueIso: r.due_at.toISOString(),
  }));
}

// ── Overview (admin home) ────────────────────────────────────────────────────
export interface AdminOverview {
  serverTimeIso: string;
  deadlineIso: string;
  /** Journeys whose latest booking was a no-show in the last 48 h (= tracker ?missed=48h). */
  noShows48h: number;
  emergencies: { count: number; oldestIso: string | null };
  cases: { triage: number; open: number };
  /** Journeys with an overdue outcome (= tracker ?overdue=1 rows). */
  overdue: { total: number; byInterviewer: { name: string; count: number }[] };
  /** Pending approvals other than emergency waivers (those are listed above). */
  otherApprovals: { count: number; oldestIso: string | null };
  /** Journeys AWAITING_RESULT. */
  resultPending: number;
  /** Students (= tracker "Not booked" tile with no filters). */
  notBooked: number;
  /** Students (= tracker "At risk" tile with no filters). */
  atRisk: number;
  /** Not-booked students minus slots open for booking now (> 0 = short). */
  capacityGap: number;
  horizonDays: number;
}

/**
 * Student-level counts for the overview, in SQL — the same definitions as
 * TrackerRow.notBooked and computeRisk() (keep them in sync).
 */
async function countOverviewStudents(): Promise<{ not_booked: number; at_risk: number; result_pending: number }> {
  const r = await sql<{ not_booked: number; at_risk: number; result_pending: number }[]>`
    WITH jr AS (
      SELECT j.student_id, j.state, j.cooldown_until, j.updated_at,
             EXISTS(SELECT 1 FROM student_badges sb WHERE sb.student_id = j.student_id AND sb.status = 'ACTIVE') has_badge,
             EXISTS(SELECT 1 FROM bookings lb WHERE lb.student_id = j.student_id AND lb.status IN ('CONFIRMED','IN_PROGRESS')) student_live,
             COALESCE((SELECT max(e.created_at) FROM journey_events e WHERE e.journey_id = j.id AND e.to_state = 'ELIGIBLE'), j.updated_at) eligible_since
      FROM interview_journeys j
    ), env AS (SELECT app_now() now_at, (SELECT deadline_at FROM seasons LIMIT 1) deadline_at)
    SELECT
      count(DISTINCT jr.student_id) FILTER (WHERE jr.state = 'ELIGIBLE' AND NOT jr.student_live)::int not_booked,
      count(DISTINCT jr.student_id) FILTER (WHERE NOT jr.has_badge AND (
        jr.state = 'CLOSED'
        OR (jr.state IN ('FAILED','NO_SHOW','RETAKE_LATER') AND jr.cooldown_until > env.now_at AND jr.cooldown_until > env.deadline_at)
        OR (NOT jr.student_live AND (
              (jr.state = 'ELIGIBLE' AND jr.eligible_since < env.now_at - make_interval(days => ${HIGH_RISK_DAYS}))
           OR (jr.state IN ('FAILED','NO_SHOW','RETAKE_LATER')
               AND (jr.cooldown_until IS NULL OR jr.cooldown_until <= env.now_at)
               AND COALESCE(jr.cooldown_until, jr.updated_at) < env.now_at - make_interval(days => ${HIGH_RISK_DAYS}))))
      ))::int at_risk,
      count(*) FILTER (WHERE jr.state = 'AWAITING_RESULT')::int result_pending
    FROM jr CROSS JOIN env`;
  return r[0];
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [env, capacity, overdueRows, students, missed, counts] = await Promise.all([
    sql<{ now_at: Date; deadline_at: Date }[]>`SELECT app_now() now_at, (SELECT deadline_at FROM seasons LIMIT 1) deadline_at`,
    capacityGapCounts(),
    getOverdueOutcomes(),
    countOverviewStudents(),
    getMissed48hJourneyIds(),
    sql<
      {
        emerg_n: number;
        emerg_oldest: Date | null;
        other_n: number;
        other_oldest: Date | null;
        triage: number;
        open: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM approvals WHERE status = 'PENDING' AND action = 'EMERGENCY_WAIVER') emerg_n,
        (SELECT min(created_at) FROM approvals WHERE status = 'PENDING' AND action = 'EMERGENCY_WAIVER') emerg_oldest,
        (SELECT count(*)::int FROM approvals WHERE status = 'PENDING' AND action <> 'EMERGENCY_WAIVER') other_n,
        (SELECT min(created_at) FROM approvals WHERE status = 'PENDING' AND action <> 'EMERGENCY_WAIVER') other_oldest,
        (SELECT count(*)::int FROM integrity_cases WHERE status = 'TRIAGE') triage,
        (SELECT count(*)::int FROM integrity_cases WHERE status = 'OPEN') open`,
  ]);
  const c = counts[0];
  const byName = new Map<string, number>();
  for (const o of overdueRows) byName.set(o.interviewerName, (byName.get(o.interviewerName) ?? 0) + 1);
  return {
    serverTimeIso: env[0].now_at.toISOString(),
    deadlineIso: env[0].deadline_at.toISOString(),
    noShows48h: missed.length,
    emergencies: { count: c.emerg_n, oldestIso: c.emerg_oldest ? c.emerg_oldest.toISOString() : null },
    cases: { triage: c.triage, open: c.open },
    overdue: {
      total: overdueRows.length,
      byInterviewer: [...byName.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    },
    otherApprovals: { count: c.other_n, oldestIso: c.other_oldest ? c.other_oldest.toISOString() : null },
    resultPending: students.result_pending,
    notBooked: students.not_booked,
    atRisk: students.at_risk,
    capacityGap: capacity.demand - capacity.openNow,
    horizonDays: capacity.horizon,
  };
}

/** Badge counts for the admin nav: cases needing a decision, pending approvals. */
export async function getAdminNavCounts(): Promise<{ cases: number; approvals: number }> {
  const r = (
    await sql<{ cases: number; approvals: number }[]>`
      SELECT (SELECT count(*)::int FROM integrity_cases WHERE status IN ('TRIAGE','OPEN')) cases,
             (SELECT count(*)::int FROM approvals WHERE status = 'PENDING') approvals`
  )[0];
  return r;
}

// ── Capacity (A2) ────────────────────────────────────────────────────────────
export interface CapacityDay {
  dateIso: string;
  label: string;
  open: number;
  booked: number;
}
export interface InterviewerLoad {
  name: string;
  booked: number;
  open: number;
}
export interface AdminCapacity {
  serverTimeIso: string;
  deadlineIso: string;
  /** season_rules.horizon_days — how far ahead slots exist. */
  horizonDays: number;
  days: CapacityDay[];
  /** Students with an ELIGIBLE journey and no live booking on any journey. */
  demandTotal: number;
  /** OPEN slots in the horizon a student can book right now (bookable_from <= now). */
  openTotal: number;
  /** OPEN slots in the horizon that aren't bookable yet (bookable_from later). */
  openingLaterTotal: number;
  /** demandTotal − openTotal: > 0 means that many students can't book with the slots open for booking now. */
  gap: number;
  interviewers: InterviewerLoad[];
  /** short = notBooked − openSlots (> 0 = short; ≤ 0 = spare). Open slots can serve several tracks. */
  byTrack: { track: string; notBooked: number; openSlots: number; short: number }[];
  pools: {
    deadlineShare: number;
    priorityShare: number;
    releaseHours: number;
    /** OPEN slots in the horizon reserved for DEADLINE / PRIORITY audiences (0 = pools not applied). */
    reservedOpenSlots: number;
  };
}

/** Demand (not-booked students) vs OPEN slots in the horizon, bookable now / later. */
async function capacityGapCounts(): Promise<{ horizon: number; demand: number; openNow: number; openLater: number }> {
  const r = (
    await sql<{ horizon: number; demand: number; open_now: number; open_later: number }[]>`
      WITH h AS (SELECT horizon_days FROM season_rules LIMIT 1)
      SELECT h.horizon_days horizon,
        (SELECT count(DISTINCT j.student_id) FROM interview_journeys j
         WHERE j.state = 'ELIGIBLE'
           AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.student_id = j.student_id AND bk.status IN ('CONFIRMED','IN_PROGRESS')))::int demand,
        (SELECT count(*) FROM interview_slots s
         WHERE s.status = 'OPEN' AND s.start_at >= app_now() AND s.start_at < app_now() + make_interval(days => h.horizon_days)
           AND s.bookable_from <= app_now())::int open_now,
        (SELECT count(*) FROM interview_slots s
         WHERE s.status = 'OPEN' AND s.start_at >= app_now() AND s.start_at < app_now() + make_interval(days => h.horizon_days)
           AND s.bookable_from > app_now())::int open_later
      FROM h`
  )[0];
  return { horizon: r.horizon, demand: r.demand, openNow: r.open_now, openLater: r.open_later };
}

export async function getAdminCapacity(): Promise<AdminCapacity> {
  const [now, ruleRows, gap] = await Promise.all([
    serverNow(),
    sql<{ horizon_days: number; deadline_at: Date; dec_deadline_reserve: string; dec_priority_reserve: string; pool_release_hours: number }[]>`
      SELECT sr.horizon_days, s.deadline_at, sr.dec_deadline_reserve, sr.dec_priority_reserve, sr.pool_release_hours
      FROM seasons s JOIN season_rules sr ON sr.season_id = s.id LIMIT 1`,
    capacityGapCounts(),
  ]);
  const rule = ruleRows[0];
  const horizon = rule.horizon_days;

  const [perDay, reservedRows, load, trackRows] = await Promise.all([
    sql<{ daystr: string; open_cnt: number; booked_cnt: number }[]>`
      SELECT to_char((start_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS daystr,
             count(*) FILTER (WHERE status = 'OPEN')::int AS open_cnt,
             count(*) FILTER (WHERE status = 'BOOKED')::int AS booked_cnt
      FROM interview_slots
      WHERE status IN ('OPEN','BOOKED')
        AND start_at >= app_now() AND start_at < app_now() + make_interval(days => ${horizon})
      GROUP BY 1 ORDER BY 1`,
    sql<{ n: number }[]>`
      SELECT count(*)::int n FROM interview_slots
      WHERE status = 'OPEN' AND audience IN ('DEADLINE','PRIORITY')
        AND start_at >= app_now() AND start_at < app_now() + make_interval(days => ${horizon})`,
    sql<{ name: string; booked_cnt: number; open_cnt: number }[]>`
      SELECT iv.display_name name,
             count(*) FILTER (WHERE s.status='BOOKED')::int AS booked_cnt,
             count(*) FILTER (WHERE s.status='OPEN')::int AS open_cnt
      FROM interviewers iv
      LEFT JOIN interview_slots s ON s.interviewer_id = iv.id
        AND s.status IN ('OPEN','BOOKED')
        AND s.start_at >= app_now() AND s.start_at < app_now() + make_interval(days => ${horizon})
      WHERE iv.active
      GROUP BY iv.display_name ORDER BY iv.display_name`,
    sql<{ track: string; not_booked: number; open_slots: number }[]>`
      SELECT t.name track,
        (SELECT count(DISTINCT j.student_id) FROM interview_journeys j JOIN badges b2 ON b2.id = j.badge_id
         WHERE b2.track_id = t.id AND j.state = 'ELIGIBLE'
           AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.student_id = j.student_id AND bk.status IN ('CONFIRMED','IN_PROGRESS')))::int not_booked,
        (SELECT count(*) FROM interview_slots s
         JOIN interviewer_tracks it ON it.interviewer_id = s.interviewer_id AND it.track_id = t.id
         WHERE s.status = 'OPEN' AND s.bookable_from <= app_now()
           AND s.start_at >= app_now() AND s.start_at < app_now() + make_interval(days => ${horizon}))::int open_slots
      FROM tracks t ORDER BY t.sort`,
  ]);

  const days: CapacityDay[] = perDay.map((d) => {
    const dt = new Date(d.daystr + "T00:00:00+05:30");
    return {
      dateIso: d.daystr,
      label: dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }),
      open: d.open_cnt,
      booked: d.booked_cnt,
    };
  });

  const interviewers: InterviewerLoad[] = load.map((l) => ({ name: l.name, booked: l.booked_cnt, open: l.open_cnt }));
  const byTrack = trackRows.map((r) => ({ track: r.track, notBooked: r.not_booked, openSlots: r.open_slots, short: r.not_booked - r.open_slots }));

  return {
    serverTimeIso: now.toISOString(),
    deadlineIso: rule.deadline_at.toISOString(),
    horizonDays: horizon,
    days,
    demandTotal: gap.demand,
    openTotal: gap.openNow,
    openingLaterTotal: gap.openLater,
    gap: gap.demand - gap.openNow,
    interviewers,
    byTrack,
    pools: {
      deadlineShare: Number(rule.dec_deadline_reserve),
      priorityShare: Number(rule.dec_priority_reserve),
      releaseHours: rule.pool_release_hours,
      reservedOpenSlots: reservedRows[0].n,
    },
  };
}

// ── Approvals (A4) ───────────────────────────────────────────────────────────
export interface ApprovalRow {
  id: string;
  action: string;
  reason: string | null;
  requestedByName: string | null;
  requestedById: string | null;
  /** Requester's staff roles ("Program Admin", "Interview Admin", "Interviewer"). */
  requesterRoleLabel: string | null;
  interviewerUserId: string | null;
  interviewerName: string | null;
  createdAtIso: string;
  /** Who the request is about, when it carries a journey. */
  subject: { studentName: string; gritIdMasked: string | null; journey: string } | null;
  /** The integrity case for this request's student (open first), if any. */
  caseId: string | null;
  caseCode: string | null;
  /** MORE_HOURS requests: the capacity gap captured when filed. */
  gapAtFiling: number | null;
}

function roleLabel(roles: string | null): string | null {
  if (!roles) return null;
  const set = roles.split(",");
  if (set.includes("PROGRAM_ADMIN")) return "Program Admin";
  if (set.includes("INTERVIEW_ADMIN")) return "Interview Admin";
  if (set.includes("INTERVIEWER")) return "Interviewer";
  if (set.includes("STUDENT")) return "Student";
  return null;
}

export async function getPendingApprovals(): Promise<ApprovalRow[]> {
  const rows = await sql<
    {
      id: string;
      action: string;
      reason: string | null;
      req_name: string | null;
      req_id: string | null;
      req_roles: string | null;
      iv_user: string | null;
      iv_name: string | null;
      created_at: Date;
      student_name: string | null;
      grit_id: string | null;
      journey: string | null;
      case_id: string | null;
      case_code: string | null;
      gap: string | null;
    }[]
  >`
    SELECT a.id, a.action, a.reason, ru.display_name req_name, a.requested_by req_id,
           (SELECT string_agg(r.role::text, ',') FROM user_roles r WHERE r.user_id = a.requested_by) req_roles,
           ivu.id iv_user, ivu.display_name iv_name, a.created_at,
           su.display_name student_name, st.grit_id,
           CASE WHEN j.id IS NOT NULL THEN t.name || ' · ' || b.name END journey,
           ic.id case_id, ic.code case_code,
           a.payload->>'gap' gap
    FROM approvals a
    LEFT JOIN users ru ON ru.id = a.requested_by
    LEFT JOIN interviewers iv ON iv.id = a.interviewer_id
    LEFT JOIN users ivu ON ivu.id = iv.user_id
    LEFT JOIN interview_journeys j ON j.id = a.journey_id
    LEFT JOIN students st ON st.id = j.student_id
    LEFT JOIN users su ON su.id = st.user_id
    LEFT JOIN badges b ON b.id = j.badge_id
    LEFT JOIN tracks t ON t.id = b.track_id
    LEFT JOIN LATERAL (
      SELECT ic2.id, ic2.code FROM integrity_cases ic2
      WHERE ic2.id::text = a.payload->>'caseId'
         OR (j.student_id IS NOT NULL AND ic2.subject_student_id = j.student_id)
      ORDER BY (ic2.id::text = a.payload->>'caseId') DESC NULLS LAST,
               (ic2.status IN ('TRIAGE','OPEN')) DESC, ic2.created_at DESC
      LIMIT 1
    ) ic ON true
    WHERE a.status = 'PENDING'
    ORDER BY a.created_at`;
  return rows.map((r) => {
    const gap = r.gap != null && r.gap !== "" ? Number(r.gap) : null;
    return {
      id: r.id,
      action: r.action,
      reason: r.reason,
      requestedByName: r.req_name,
      requestedById: r.req_id,
      requesterRoleLabel: roleLabel(r.req_roles),
      interviewerUserId: r.iv_user,
      interviewerName: r.iv_name,
      createdAtIso: r.created_at.toISOString(),
      subject: r.student_name
        ? { studentName: r.student_name, gritIdMasked: r.grit_id ? maskGritId(r.grit_id) : null, journey: r.journey ?? "" }
        : null,
      caseId: r.case_id,
      caseCode: r.case_code,
      gapAtFiling: gap != null && Number.isFinite(gap) ? gap : null,
    };
  });
}

// ── Integrity cases (A3) ─────────────────────────────────────────────────────
export interface CaseListRow {
  id: string;
  code: string;
  status: string;
  /** The case's recorded category / reason. */
  reason: string | null;
  studentName: string | null;
  createdAtIso: string;
  decidedAtIso: string | null;
}

/** All cases, most urgent first: in triage, then under review (oldest first), then decided (newest first). */
export async function getCaseList(): Promise<CaseListRow[]> {
  const rows = await sql<
    { id: string; code: string; status: string; reason: string | null; student: string | null; created_at: Date; decided_at: Date | null }[]
  >`
    SELECT ic.id, ic.code, ic.status, ic.reason, u.display_name student, ic.created_at, ic.decided_at
    FROM integrity_cases ic
    LEFT JOIN students s ON s.id = ic.subject_student_id
    LEFT JOIN users u ON u.id = s.user_id
    ORDER BY CASE ic.status WHEN 'TRIAGE' THEN 0 WHEN 'OPEN' THEN 1 ELSE 2 END,
             CASE WHEN ic.status IN ('TRIAGE','OPEN') THEN ic.created_at END ASC,
             COALESCE(ic.decided_at, ic.created_at) DESC`;
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    reason: r.reason,
    studentName: r.student,
    createdAtIso: r.created_at.toISOString(),
    decidedAtIso: r.decided_at ? r.decided_at.toISOString() : null,
  }));
}

export interface CaseJourney {
  id: string;
  label: string;
  state: JourneyState;
  holdPrevState: JourneyState | null;
}
export interface CaseEvent {
  atIso: string;
  action: string;
  journey: string;
  fromState: JourneyState | null;
  toState: JourneyState | null;
  actorName: string | null;
  reason: string | null;
}
export interface CaseEvidence {
  kind: "INTERVIEWER_FLAG";
  journey: string;
  interviewStartIso: string;
  interviewerName: string | null;
  reviewStatus: string;
  /** What the interviewer reported (e.g. "Face didn't match …"), migration 0007. */
  reason: string | null;
  /** The recorded result that is held (or was, before the decision). */
  result: string | null;
}
export interface CaseBadge {
  label: string;
  status: string;
  miles: number;
}

export type CaseDecisionKind = "dismiss" | "nullify" | "disqualify";

export interface CaseDetail {
  id: string;
  code: string;
  status: string;
  reason: string | null;
  /** Interviewer-chosen concern category (lib/outcome INTEGRITY_CATEGORIES). */
  category: string | null;
  subjectStudentId: string | null;
  subjectStudentName: string | null;
  /** Masked GRIT ID — what every admin sees. */
  gritIdMasked: string | null;
  /**
   * The full GRIT ID, only when the viewer can decide this case (a Program Admin
   * who didn't open it, case undecided) — the typed confirmation needs it. Else null.
   */
  gritIdForConfirm: string | null;
  openedById: string | null;
  openedByName: string | null;
  decidedByName: string | null;
  /** What was decided (migration 0006); null for cases decided before it was stored. */
  decision: CaseDecisionKind | null;
  decisionNote: string | null;
  createdAtIso: string;
  decidedAtIso: string | null;
  /** Every journey the student has this season, with its current state. */
  journeys: CaseJourney[];
  /** Integrity events for this case (tagged with its id, or untagged hold/decision events inside its window). */
  events: CaseEvent[];
  /** Interviewer integrity flags on this student's outcomes from this case's window (or linked to it). */
  evidence: CaseEvidence[];
  /** Badges nullified by this case, or under review while it is undecided. */
  badges: CaseBadge[];
}

export async function getCase(caseId: string, viewer: { userId: string; isProgramAdmin: boolean }): Promise<CaseDetail | null> {
  const r = (
    await sql<
      {
        id: string;
        code: string;
        status: string;
        reason: string | null;
        category: string | null;
        subject_student_id: string | null;
        student_name: string | null;
        grit_id: string | null;
        opened_by: string | null;
        opener: string | null;
        decider: string | null;
        decision: string | null;
        decision_note: string | null;
        created_at: Date;
        decided_at: Date | null;
        window_end: Date;
        booking_id: string | null;
        window_start: Date | null;
      }[]
    >`
      SELECT ic.id, ic.code, ic.status, ic.reason, ic.category, ic.subject_student_id,
             su.display_name student_name, st.grit_id,
             ic.opened_by, ou.display_name opener, du.display_name decider,
             ic.decision, ic.decision_note, ic.booking_id,
             ic.created_at, ic.decided_at,
             COALESCE(ic.decided_at, app_now()) window_end,
             -- The evidence window starts after the student's previous case opened, so
             -- flags that led to an earlier case don't show up here.
             (SELECT max(p.created_at) FROM integrity_cases p
              WHERE p.subject_student_id = ic.subject_student_id AND p.id <> ic.id AND p.created_at < ic.created_at) window_start
      FROM integrity_cases ic
      LEFT JOIN students st ON st.id = ic.subject_student_id
      LEFT JOIN users su ON su.id = st.user_id
      LEFT JOIN users ou ON ou.id = ic.opened_by
      LEFT JOIN users du ON du.id = ic.decided_by
      WHERE ic.id = ${caseId}`
  )[0];
  if (!r) return null;

  const decided = r.status === "CONFIRMED" || r.status === "DISMISSED";
  const studentId = r.subject_student_id;
  const [journeys, events, evidence, badges] = studentId
    ? await Promise.all([
        sql<{ id: string; label: string; state: JourneyState; hold_prev_state: JourneyState | null }[]>`
          SELECT j.id, t.name || ' · ' || b.name label, j.state, j.hold_prev_state
          FROM interview_journeys j JOIN badges b ON b.id = j.badge_id JOIN tracks t ON t.id = b.track_id
          WHERE j.student_id = ${studentId}
          ORDER BY t.sort, b.level`,
        sql<
          { created_at: Date; action: string; label: string; from_state: JourneyState | null; to_state: JourneyState | null; actor: string | null; reason: string | null }[]
        >`
          SELECT e.created_at, e.action, t.name || ' · ' || b.name label, e.from_state, e.to_state,
                 au.display_name actor, e.reason
          FROM journey_events e
          JOIN interview_journeys j ON j.id = e.journey_id
          JOIN badges b ON b.id = j.badge_id JOIN tracks t ON t.id = b.track_id
          LEFT JOIN users au ON au.id = e.actor_user_id
          WHERE j.student_id = ${studentId}
            AND (e.payload->>'caseId' = ${caseId}
                 -- Untagged (older) integrity events count only inside this case's window.
                 OR (e.payload->>'caseId' IS NULL
                     AND e.action IN ('hold','dismiss_hold','confirm_nullify','confirm_close')
                     AND e.created_at >= ${r.created_at} AND e.created_at <= ${r.window_end}))
          ORDER BY e.created_at, e.id`,
        sql<{ label: string; start_at: Date; interviewer: string | null; review_status: string; integrity_reason: string | null; result: string | null }[]>`
          SELECT t.name || ' · ' || b.name label, bk.start_at, iu.display_name interviewer, o.review_status, o.integrity_reason, o.result
          FROM interview_outcomes o
          JOIN bookings bk ON bk.id = o.booking_id
          JOIN interview_journeys j ON j.id = bk.journey_id
          JOIN badges b ON b.id = j.badge_id JOIN tracks t ON t.id = b.track_id
          LEFT JOIN interviewers iv ON iv.id = bk.interviewer_id
          LEFT JOIN users iu ON iu.id = iv.user_id
          WHERE bk.student_id = ${studentId} AND o.integrity_flag
            AND (bk.id = ${r.booking_id}
                 -- Cases opened before migration 0007 have no booking link: fall back to the old matching.
                 OR (${r.booking_id}::uuid IS NULL
                     AND (EXISTS (SELECT 1 FROM student_badges sb WHERE sb.outcome_id = o.id AND sb.case_id = ${caseId})
                          OR (o.created_at <= ${r.window_end}
                              AND (${r.window_start}::timestamptz IS NULL OR o.created_at > ${r.window_start}::timestamptz)))))
          ORDER BY bk.start_at`,
        sql<{ label: string; status: string; miles: number }[]>`
          SELECT t.name || ' · ' || b.name label, sb.status, sb.miles
          FROM student_badges sb JOIN badges b ON b.id = sb.badge_id JOIN tracks t ON t.id = b.track_id
          WHERE sb.student_id = ${studentId}
            AND (sb.case_id = ${caseId}
                 OR (${!decided}::boolean AND sb.status = 'UNDER_REVIEW' AND sb.case_id IS NULL))
          ORDER BY t.sort, b.level`,
      ])
    : [[], [], [], []];

  const canDecide = viewer.isProgramAdmin && r.opened_by !== viewer.userId && !decided;
  const decision = r.decision === "dismiss" || r.decision === "nullify" || r.decision === "disqualify" ? r.decision : null;

  return {
    id: r.id,
    code: r.code,
    status: r.status,
    reason: r.reason,
    category: r.category,
    subjectStudentId: r.subject_student_id,
    subjectStudentName: r.student_name,
    gritIdMasked: r.grit_id ? maskGritId(r.grit_id) : null,
    gritIdForConfirm: canDecide ? r.grit_id : null,
    openedById: r.opened_by,
    openedByName: r.opener,
    decidedByName: r.decider,
    decision,
    decisionNote: r.decision_note,
    createdAtIso: r.created_at.toISOString(),
    decidedAtIso: r.decided_at ? r.decided_at.toISOString() : null,
    journeys: journeys.map((j) => ({ id: j.id, label: j.label, state: j.state, holdPrevState: j.hold_prev_state })),
    events: events.map((e) => ({
      atIso: e.created_at.toISOString(),
      action: e.action,
      journey: e.label,
      fromState: e.from_state,
      toState: e.to_state,
      actorName: e.actor,
      reason: e.reason,
    })),
    evidence: evidence.map((e) => ({
      kind: "INTERVIEWER_FLAG" as const,
      journey: e.label,
      interviewStartIso: e.start_at.toISOString(),
      interviewerName: e.interviewer,
      reviewStatus: e.review_status,
      reason: e.integrity_reason,
      result: e.result,
    })),
    badges: badges.map((b) => ({ label: b.label, status: b.status, miles: b.miles })),
  };
}
