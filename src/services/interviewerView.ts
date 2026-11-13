import { DateTime } from "luxon";
import { protectIfLastDays } from "./reassign";
import { THIRD_RETAKE_STREAK } from "./jobs";
import type { Sql, TransactionSql } from "postgres";
import { sql } from "@/db";
import { serverNow } from "@/lib/clock";
import { IST } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { timeOnly } from "@/lib/time";
import {
  COMMUNICATION_SKILL,
  NOT_COMPLETED_NOTE_MIN,
  WHAT_HAPPENED_LABEL,
  DROPPED_FEEDBACK,
  RESULT_LABEL,
  suggestResult,
  OVERRIDE_REASON_MIN,
  INTEGRITY_CATEGORIES,
  type OutcomeResult,
  type WhatHappened,
} from "@/lib/outcome";
import { transitionJourney } from "./journeys";
import { recordNoShow } from "./jobs";
import { openIntegrityCase } from "./integrity";

export type RowKind =
  | "published"
  | "submitted"
  | "outcome_due"
  | "on_hold"
  | "no_show"
  | "voided"
  | "live"
  | "booked"
  | "open"
  | "blocked";

/** Outcome is due this long after the interview start (design doc I2: "24 h countdown"). */
export const OUTCOME_DUE_HOURS = 24;
/** The brief (and the booking code) is visible from this long before to this long after the start (design doc I2). */
const BRIEF_WINDOW_HOURS = 24;

export interface ScheduleRow {
  bookingId: string | null;
  slotId: string;
  startIso: string;
  kind: RowKind;
  studentName: string | null; // first name + last initial
  badge: string | null;
  /** Shown in the brief (T-24 h to T+24 h); the row itself only shows it while live. */
  bookingCode: string | null;
  skillsCleared: string[];
  outcomeId: string | null;
  outcomeDueIso: string | null;
  /** Submitted, not yet published and not held for review: edits are allowed until this time. */
  editUntilIso: string | null;
  result: string | null;
  /** For kind "voided": bookings.void_reason (PLATFORM | UNFAIR). */
  voidReason: string | null;
}

export interface InterviewerDay {
  dateIso: string;
  prevIso: string;
  nextIso: string;
  label: string;
  rows: ScheduleRow[];
  counts: { interviews: number; outcomesDue: number };
  serverNowIso: string;
}

function maskName(full: string): string {
  const [first, ...rest] = full.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
}

/**
 * The ONE rule for where a live booking (no outcome submitted yet) stands, shared by
 * the schedule rows and listOutcomesDue (whose SQL mirrors it):
 *   - journey ON_HOLD                          → on_hold (no outcome can be recorded)
 *   - booking COMPLETED, or now ≥ start + slot_duration_minutes → outcome_due
 *   - now ≥ start − join_open_minutes          → live (Start interview enabled from start)
 *   - otherwise                                → booked
 */
function liveBookingKind(o: {
  nowMs: number;
  startMs: number;
  bookingStatus: string;
  journeyState: string | null;
  joinOpenMinutes: number;
  slotDurationMinutes: number;
}): RowKind {
  if (o.journeyState === "ON_HOLD") return "on_hold";
  if (o.bookingStatus === "COMPLETED" || o.nowMs >= o.startMs + o.slotDurationMinutes * 60_000) return "outcome_due";
  if (o.nowMs >= o.startMs - o.joinOpenMinutes * 60_000) return "live";
  return "booked";
}

export async function getInterviewerDay(interviewerId: string, dayIso?: string): Promise<InterviewerDay> {
  const now = await serverNow();
  const parsed = dayIso ? DateTime.fromISO(dayIso, { zone: IST }) : null;
  // A malformed ?date= falls back to today instead of erroring.
  const base = parsed?.isValid ? parsed : DateTime.fromJSDate(now).setZone(IST);
  const dayStart = base.startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });

  const rules = (await sql<{ join_open_minutes: number; slot_duration_minutes: number }[]>`
    SELECT join_open_minutes, slot_duration_minutes FROM season_rules LIMIT 1`)[0];

  // One booking per slot: the live / no-show one, or a voided one the interviewer
  // recorded an outcome for (PLATFORM / UNFAIR). CANCELLED slots with none of those
  // (hours removed after an old booking was cancelled) aren't shown: a new slot may
  // already exist at that time.
  const slots = await sql<
    {
      slot_id: string;
      start_at: Date;
      slot_status: string;
      booking_id: string | null;
      booking_status: string | null;
      booking_code: string | null;
      void_reason: string | null;
      student_name: string | null;
      student_id: string | null;
      journey_state: string | null;
      badge: string | null;
      track: string | null;
      badge_id: string | null;
      outcome_id: string | null;
      publish_at: Date | null;
      locked_at: Date | null;
      result: string | null;
      submitted_at: Date | null;
      review_status: string | null;
    }[]
  >`
    SELECT sl.id slot_id, sl.start_at, sl.status slot_status,
           bk.id booking_id, bk.status booking_status, bk.booking_code, bk.void_reason,
           u.display_name student_name, st.id student_id, j.state journey_state,
           b.name badge, t.name track, b.id badge_id,
           o.id outcome_id, o.publish_at, o.locked_at, o.result, o.submitted_at, o.review_status
    FROM interview_slots sl
    LEFT JOIN LATERAL (
      SELECT x.* FROM bookings x
      WHERE x.slot_id = sl.id
        AND (x.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED','NO_SHOW')
             OR (x.status = 'VOID' AND EXISTS (SELECT 1 FROM interview_outcomes xo WHERE xo.booking_id = x.id)))
      ORDER BY (x.status = 'VOID'), x.created_at DESC
      LIMIT 1
    ) bk ON true
    LEFT JOIN students st ON st.id = bk.student_id
    LEFT JOIN users u ON u.id = st.user_id
    LEFT JOIN interview_journeys j ON j.id = bk.journey_id
    LEFT JOIN badges b ON b.id = j.badge_id
    LEFT JOIN tracks t ON t.id = b.track_id
    LEFT JOIN interview_outcomes o ON o.booking_id = bk.id
    WHERE sl.interviewer_id = ${interviewerId}
      AND sl.start_at >= ${dayStart.toJSDate()} AND sl.start_at < ${dayEnd.toJSDate()}
      AND (sl.status <> 'CANCELLED' OR bk.id IS NOT NULL)
    ORDER BY sl.start_at`;

  const nowMs = now.getTime();
  let outcomesDue = 0;
  let interviews = 0;

  const rows: ScheduleRow[] = await Promise.all(
    slots.map(async (s) => {
      const startMs = s.start_at.getTime();

      let kind: RowKind;
      if (!s.booking_id) kind = s.slot_status === "BLOCKED" ? "blocked" : "open";
      // Student absent: either the attendance check marked it, or the interviewer recorded
      // "Student didn't join" (which also stores a locked outcome row). No outcome is owed.
      else if (s.booking_status === "NO_SHOW") kind = "no_show";
      // Interviewer recorded "Couldn't happen" / "Couldn't finish fairly": attempt voided.
      else if (s.booking_status === "VOID") kind = "voided";
      else if (s.locked_at) kind = "published";
      else if (s.submitted_at) kind = "submitted";
      else
        kind = liveBookingKind({
          nowMs,
          startMs,
          bookingStatus: s.booking_status!,
          journeyState: s.journey_state,
          joinOpenMinutes: rules.join_open_minutes,
          slotDurationMinutes: rules.slot_duration_minutes,
        });

      if (s.booking_id && kind !== "voided") interviews++;
      if (kind === "outcome_due") outcomesDue++;

      // skills cleared (brief) — only for an actual booking
      let skills: string[] = [];
      if (s.badge_id && s.student_id) {
        const sk = await sql<{ name: string }[]>`
          SELECT sk.name FROM badge_skill_requirements r JOIN skills sk ON sk.id = r.skill_id
          WHERE r.badge_id = ${s.badge_id} ORDER BY sk.name`;
        skills = sk.map((x) => x.name);
      }

      const owesOutcome = kind === "outcome_due" || kind === "live" || kind === "booked";
      const outcomeDueIso = owesOutcome && s.booking_id ? new Date(startMs + OUTCOME_DUE_HOURS * 3_600_000).toISOString() : null;

      return {
        bookingId: s.booking_id,
        slotId: s.slot_id,
        startIso: s.start_at.toISOString(),
        kind,
        studentName: s.student_name ? maskName(s.student_name) : null,
        badge: s.badge && s.track ? `${s.track} · ${s.badge}` : null,
        bookingCode: Math.abs(nowMs - startMs) <= BRIEF_WINDOW_HOURS * 3_600_000 ? s.booking_code : null,
        skillsCleared: skills,
        outcomeId: s.outcome_id,
        outcomeDueIso,
        // A held outcome (integrity flag → WITHHELD) can't be edited, so no edit window.
        editUntilIso:
          kind === "submitted" && s.publish_at && (s.review_status ?? "NONE") === "NONE" ? s.publish_at.toISOString() : null,
        result: s.locked_at ? s.result : null,
        voidReason: kind === "voided" ? s.void_reason : null,
      };
    })
  );

  return {
    dateIso: dayStart.toISO()!,
    prevIso: dayStart.minus({ days: 1 }).toISODate()!,
    nextIso: dayStart.plus({ days: 1 }).toISODate()!,
    label: dayStart.toFormat("cccc, d LLL yyyy"),
    rows,
    counts: { interviews, outcomesDue },
    serverNowIso: now.toISOString(),
  };
}

export interface OutcomeDueItem {
  bookingId: string;
  studentName: string; // first name + last initial
  badge: string; // "Track · Badge"
  startIso: string;
  /** start + OUTCOME_DUE_HOURS. */
  outcomeDueIso: string;
  overdue: boolean;
}

/**
 * Bookings of this interviewer that still owe an outcome, across ALL days, oldest
 * deadline first. One definition, used by the /outcomes page, the schedule's
 * "outcomes to record" block AND the nav badge (layout), so the three always agree.
 * It mirrors liveBookingKind's "outcome_due": a live booking (not NO_SHOW /
 * cancelled / void) with no submitted outcome, whose journey isn't ON_HOLD (no
 * outcome can be recorded then), that the attendance check already marked COMPLETED
 * or whose interview time (start + slot_duration_minutes) is over.
 */
export async function listOutcomesDue(interviewerId: string): Promise<{ items: OutcomeDueItem[]; serverNowIso: string }> {
  const now = await serverNow();
  const rows = await sql<{ booking_id: string; start_at: Date; student_name: string; badge: string; track: string }[]>`
    SELECT bk.id booking_id, bk.start_at, u.display_name student_name, b.name badge, t.name track
    FROM bookings bk
    JOIN students st ON st.id = bk.student_id
    JOIN users u ON u.id = st.user_id
    JOIN interview_journeys j ON j.id = bk.journey_id
    JOIN badges b ON b.id = j.badge_id
    JOIN tracks t ON t.id = b.track_id
    LEFT JOIN interview_outcomes o ON o.booking_id = bk.id
    WHERE bk.interviewer_id = ${interviewerId}
      AND bk.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED')
      AND o.submitted_at IS NULL
      AND j.state <> 'ON_HOLD'
      AND (bk.status = 'COMPLETED'
           OR app_now() >= bk.start_at + make_interval(mins => (SELECT slot_duration_minutes FROM season_rules LIMIT 1)))
    ORDER BY bk.start_at, bk.id`;
  const nowMs = now.getTime();
  return {
    serverNowIso: now.toISOString(),
    items: rows.map((r) => {
      const due = r.start_at.getTime() + OUTCOME_DUE_HOURS * 3_600_000;
      return {
        bookingId: r.booking_id,
        studentName: maskName(r.student_name),
        badge: `${r.track} · ${r.badge}`,
        startIso: r.start_at.toISOString(),
        outcomeDueIso: new Date(due).toISOString(),
        overdue: nowMs > due,
      };
    }),
  };
}

type Querier = Sql | TransactionSql;

export async function rubricSkills(q: Querier, badgeId: string): Promise<string[]> {
  const rows = await q<{ name: string }[]>`
    SELECT sk.name FROM badge_skill_requirements r JOIN skills sk ON sk.id = r.skill_id
    WHERE r.badge_id = ${badgeId} ORDER BY sk.name`;
  return [...rows.map((x) => x.name), COMMUNICATION_SKILL];
}

export interface OutcomeFormData {
  bookingId: string;
  studentName: string;
  badge: string;
  /** Only within 24 h of the start (same rule as the brief); null otherwise. */
  bookingCode: string | null;
  skills: string[];
  startIso: string;
  serverNowIso: string;
  /** now >= start: outcomes can't be submitted before the interview starts. */
  started: boolean;
  /** "Student didn't join" is available once the student's join window has closed (start + join grace). */
  noJoinFromIso: string;
  /** The student joined (join endpoint recorded it), so "Student didn't join" isn't allowed. */
  studentJoined: boolean;
  /** The student typed the right booking code when they joined (null: not verified). */
  codeVerifiedAtIso: string | null;
  /** Attempts the student has left on this badge before this interview counts (max_attempts - attempt_count). */
  attemptsLeft: number;
  maxAttempts: number;
  /** The journey's one free dropped-call Retake later is used. */
  dropUsed: boolean;
  /** season_rules.noshow_cooldown_days. */
  noshowCooldownDays: number;
  publishPreviewIso: string;
  alreadySubmitted: boolean;
  lockedAt: string | null;
  /** False once submitted and the edit window has passed, the outcome is under review, or closedReason is set. */
  editable: boolean;
  /** Set when no outcome can be recorded (attendance check marked a no-show, the booking was called off, or the journey is on hold). */
  closedReason: string | null;
  /** Set when the outcome is held for an integrity review or a second review. */
  underReview: boolean;
  /** Held for a second review (a Pass against the suggestion). */
  secondReview: boolean;
  /** What the interviewer already submitted (for editing inside the window, or read-only once locked). */
  existing: {
    whatHappened: string;
    result: OutcomeResult | null;
    rubric: { skill: string; score: number }[];
    feedback: string;
    focusAreas: string[];
    internalNotes: string;
    integrityFlag: boolean;
    faceMatched: boolean | null;
    overrideReason: string;
    integrityCategory: string | null;
  } | null;
}

export async function getOutcomeForm(bookingId: string, interviewerId: string): Promise<OutcomeFormData> {
  const rules = (await sql<{ publish_delay_minutes: number; join_grace_minutes: number; noshow_cooldown_days: number }[]>`
    SELECT publish_delay_minutes, join_grace_minutes, noshow_cooldown_days FROM season_rules LIMIT 1`)[0];
  const row = (
    await sql<
      {
        start_at: Date;
        booking_code: string;
        booking_status: string;
        student_joined_at: Date | null;
        code_verified_at: Date | null;
        student_name: string;
        badge: string;
        track: string;
        badge_id: string;
        journey_state: string;
        attempt_count: number;
        max_attempts: number;
        drop_used: boolean;
        submitted_at: Date | null;
        locked_at: Date | null;
        publish_at: Date | null;
        what_happened: string | null;
        result: OutcomeResult | null;
        rubric: { skill: string; score: number }[] | null;
        feedback_to_student: string | null;
        focus_areas: string[] | null;
        internal_notes_encrypted: string | null;
        integrity_flag: boolean | null;
        face_matched: boolean | null;
        review_status: string | null;
        window_open: boolean | null;
        override_reason: string | null;
        integrity_category: string | null;
      }[]
    >`
      SELECT bk.start_at, bk.booking_code, bk.status booking_status, bk.student_joined_at, bk.code_verified_at,
             u.display_name student_name, b.name badge, t.name track, b.id badge_id,
             j.state journey_state, j.attempt_count, j.max_attempts, j.drop_used,
             o.submitted_at, o.locked_at, o.publish_at, o.what_happened, o.result, o.rubric, o.feedback_to_student,
             o.focus_areas, o.internal_notes_encrypted, o.integrity_flag, o.face_matched, o.review_status,
             o.override_reason, o.integrity_category,
             (o.publish_at > app_now()) window_open
      FROM bookings bk
      JOIN students st ON st.id = bk.student_id
      JOIN users u ON u.id = st.user_id
      JOIN interview_journeys j ON j.id = bk.journey_id
      JOIN badges b ON b.id = j.badge_id JOIN tracks t ON t.id = b.track_id
      LEFT JOIN interview_outcomes o ON o.booking_id = bk.id
      WHERE bk.id = ${bookingId} AND bk.interviewer_id = ${interviewerId}`
  )[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Booking not found");

  const skills = await rubricSkills(sql, row.badge_id);

  const now = await serverNow();
  const startMs = row.start_at.getTime();
  const closedReason = row.submitted_at
    ? null
    : row.booking_status === "NO_SHOW"
      ? "The attendance check marked this student as not joined, so no outcome is needed."
      : ["VOID", "CANCELLED", "CANCELLED_LATE"].includes(row.booking_status)
        ? "This interview was called off, so no outcome is needed."
        : row.journey_state === "ON_HOLD"
          ? "This student's badge is on hold with the interview team, so an outcome can't be recorded right now."
          : null;
  return {
    bookingId,
    studentName: maskName(row.student_name),
    badge: `${row.track} · ${row.badge}`,
    bookingCode: Math.abs(now.getTime() - startMs) <= BRIEF_WINDOW_HOURS * 3_600_000 ? row.booking_code : null,
    skills,
    startIso: row.start_at.toISOString(),
    serverNowIso: now.toISOString(),
    started: now.getTime() >= startMs,
    noJoinFromIso: new Date(startMs + rules.join_grace_minutes * 60_000).toISOString(),
    studentJoined: !!row.student_joined_at,
    codeVerifiedAtIso: row.code_verified_at ? row.code_verified_at.toISOString() : null,
    attemptsLeft: Math.max(0, row.max_attempts - row.attempt_count),
    maxAttempts: row.max_attempts,
    dropUsed: row.drop_used,
    noshowCooldownDays: rules.noshow_cooldown_days,
    // Once submitted, the publish time is fixed (edits don't extend it).
    publishPreviewIso: row.publish_at
      ? row.publish_at.toISOString()
      : new Date(now.getTime() + rules.publish_delay_minutes * 60_000).toISOString(),
    alreadySubmitted: !!row.submitted_at,
    lockedAt: row.locked_at ? row.locked_at.toISOString() : null,
    editable:
      !closedReason &&
      (!row.submitted_at || (!row.locked_at && row.window_open === true && (row.review_status ?? "NONE") === "NONE")),
    closedReason,
    underReview: row.review_status === "WITHHELD" || row.review_status === "PENDING_SECOND_REVIEW",
    secondReview: row.review_status === "PENDING_SECOND_REVIEW",
    existing: row.submitted_at
      ? {
          whatHappened: row.what_happened ?? "COMPLETED",
          result: row.result,
          rubric: row.rubric ?? [],
          feedback: row.feedback_to_student ?? "",
          focusAreas: row.focus_areas ?? [],
          internalNotes: row.internal_notes_encrypted ?? "",
          integrityFlag: !!row.integrity_flag,
          faceMatched: row.face_matched,
          overrideReason: row.override_reason ?? "",
          integrityCategory: row.integrity_category,
        }
      : null,
  };
}

export interface SubmitOutcomeInput {
  interviewerId: string;
  userId: string;
  bookingId: string;
  whatHappened: WhatHappened;
  /** Required for COMPLETED; ignored otherwise. */
  result: OutcomeResult | null;
  suggestedResult?: OutcomeResult | null;
  rubric: { skill: string; score: number }[];
  feedback?: string;
  focusAreas?: string[];
  internalNotes?: string;
  integrityFlag?: boolean;
  /** Interviewer's face check: true matches, false doesn't (the result is held for review). Required for COMPLETED. */
  faceMatched?: boolean | null;
  /** Only when the code wasn't verified at join: the interviewer heard the student read out the right code. */
  codeMatched?: boolean;
  /** Internal justification when the result differs from the rubric's suggestion. */
  overrideReason?: string;
  /** Required with integrityFlag (lib/outcome INTEGRITY_CATEGORIES). */
  integrityCategory?: string | null;
  /** DROPPED: at least 15 minutes were assessed before the call dropped. */
  assessed15?: boolean;
}

const ALREADY_NO_SHOW = "This student is already marked as not joined.";

/**
 * Interviewer records what happened. Never before the booking's start time.
 *
 * COMPLETED: the normal outcome. Needs the face check answered (faceMatched), the booking code verified
 *   at join or confirmed (codeMatched), a result and every rubric
 *   skill scored 1-4. Sets publish_at = now + publish_delay (15 min); the interviewer can
 *   edit until then and jobs.outcomePublisher publishes it. integrityFlag holds it
 *   (review_status WITHHELD: the publisher skips it, it can't be edited any more, and
 *   the student keeps seeing "Result pending") until the interview team reviews it. If
 *   the T+15 attendance check hasn't run yet (journey still BOOKED), this applies the
 *   same `attend` transition the check would: the interviewer confirming the student's
 *   identity is the attendance evidence. Submitting COMPLETED again (a double click, or
 *   two tabs) inside the edit window is treated as an edit.
 *
 * NO_JOIN ("Student didn't join"): same effect as the attendance-check no-show
 *   (jobs.recordNoShow): booking NO_SHOW, journey NO_SHOW, 1 attempt counted, no-show
 *   cooldown, closes at the attempt limit. Only while the journey is still BOOKED, only
 *   after the join window (start + join_grace) and only if the student never joined
 *   (bookings.student_joined_at IS NULL).
 *
 * PLATFORM / UNFAIR: not the student's fault, so the attempt is voided: booking VOID
 *   (void_reason = PLATFORM | UNFAIR), journey -> ELIGIBLE via `interviewer_fault` with
 *   priority_rebook = true, attempt_count unchanged, no cooldown. The slot time has
 *   passed by then, so the slot is CANCELLED rather than reopened.
 *
 * NO_JOIN / PLATFORM / UNFAIR are applied immediately (no publish window) and stored as
 *   a locked outcome row with no result plus the required interview-team note.
 *
 * Locking: booking → journey → outcome (same order as the attendance check and the
 *   publisher). Every check reads rows in statements issued AFTER the booking lock, so
 *   they see whatever a concurrent submit / job committed while we waited.
 */
export async function submitOutcome(
  input: SubmitOutcomeInput
): Promise<{ publishAtIso: string | null; whatHappened: WhatHappened; held?: boolean; secondReview?: boolean }> {
  const rules = (await sql<{ publish_delay_minutes: number; join_grace_minutes: number; noshow_cooldown_days: number }[]>`
    SELECT publish_delay_minutes, join_grace_minutes, noshow_cooldown_days FROM season_rules LIMIT 1`)[0];
  const completed = input.whatHappened === "COMPLETED";

  if (completed) {
    if (typeof input.faceMatched !== "boolean") {
      throw new ApiError(422, "FACE_CHECK_REQUIRED", "Say whether the student's face matches their registered photo and college ID.");
    }
    if (!input.result) throw new ApiError(422, "BAD_RESULT", "Choose Pass, Retake later or Fail.");
    if (input.result === "FAIL" || input.result === "RETAKE_LATER") {
      const fb = (input.feedback ?? "").trim();
      if (fb.length < 80 || fb.length > 600) throw new ApiError(422, "FEEDBACK_REQUIRED", "Feedback (80–600 chars) is required for Fail and Retake later.");
      if (!input.focusAreas?.length) throw new ApiError(422, "FOCUS_REQUIRED", "Pick 1–3 focus areas.");
    }
  } else if ((input.internalNotes ?? "").trim().length < NOT_COMPLETED_NOTE_MIN) {
    throw new ApiError(422, "NOTE_REQUIRED", `Say what happened in at least ${NOT_COMPLETED_NOTE_MIN} characters.`);
  }

  return sql.begin(async (tx) => {
    // 1. Lock the booking. Everything below is read afresh after this lock.
    const bk = (
      await tx<
        { journey_id: string; slot_id: string; start_at: Date; status: string; student_joined: boolean; code_verified: boolean; started: boolean; no_join_open: boolean }[]
      >`
        SELECT journey_id, slot_id, start_at, status, (code_verified_at IS NOT NULL) AS code_verified,
               (student_joined_at IS NOT NULL) AS student_joined,
               (app_now() >= start_at) AS started,
               (app_now() >= start_at + make_interval(mins => ${rules.join_grace_minutes})) AS no_join_open
        FROM bookings
        WHERE id = ${input.bookingId} AND interviewer_id = ${input.interviewerId}
        FOR UPDATE`
    )[0];
    if (!bk) throw new ApiError(404, "NOT_FOUND", "Booking not found");

    // 2. Lock the journey, 3. then the outcome (if any).
    const j = (await tx<{ state: string; badge_id: string; drop_used: boolean; consecutive_retake_later: number }[]>`
      SELECT state, badge_id, drop_used, consecutive_retake_later FROM interview_journeys WHERE id = ${bk.journey_id} FOR UPDATE`)[0];
    const o = (
      await tx<{ locked_at: Date | null; review_status: string; what_happened: string; editable: boolean }[]>`
        SELECT locked_at, review_status, what_happened, (publish_at > app_now()) AS editable
        FROM interview_outcomes WHERE booking_id = ${input.bookingId} FOR UPDATE`
    )[0];

    if (o?.locked_at) {
      if (o.what_happened !== "COMPLETED") {
        if (input.whatHappened === "NO_JOIN" && o.what_happened === "NO_JOIN") {
          throw new ApiError(409, "ALREADY_NO_SHOW", ALREADY_NO_SHOW);
        }
        const label = WHAT_HAPPENED_LABEL[o.what_happened as WhatHappened] ?? o.what_happened;
        throw new ApiError(
          409,
          "ALREADY_RECORDED",
          `Already recorded as "${label}" and applied straight away, so it can't be changed. Contact the interview team if this was a mistake.`
        );
      }
      throw new ApiError(409, "LOCKED", "This outcome is already published.");
    }
    if (o && o.review_status !== "NONE") {
      throw new ApiError(409, "UNDER_REVIEW", "This outcome is with the interview team for review and can't be edited.");
    }
    if (o && !o.editable) throw new ApiError(409, "EDIT_WINDOW_CLOSED", "The edit window has closed. The result is being published.");
    if (!bk.started) throw new ApiError(409, "NOT_STARTED", "The interview hasn't started yet.");
    // Recording an outcome means the interviewer was there (T+15 attendance check).
    await tx`UPDATE bookings SET interviewer_joined_at = COALESCE(interviewer_joined_at, app_now()) WHERE id = ${input.bookingId}`;
    if (bk.status === "NO_SHOW") {
      if (input.whatHappened === "NO_JOIN") throw new ApiError(409, "ALREADY_NO_SHOW", ALREADY_NO_SHOW);
      throw new ApiError(409, "NOT_RECORDABLE", "The attendance check marked this student as not joined, so no outcome can be recorded.");
    }
    if (j.state === "ON_HOLD") {
      throw new ApiError(409, "ON_HOLD", "This student's badge is on hold with the interview team, so an outcome can't be recorded right now.");
    }
    const liveBooking = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(bk.status);

    if (completed) {
      const required = await rubricSkills(tx, j.badge_id);
      const scored = new Map(input.rubric.map((r) => [r.skill, r.score]));
      if (required.some((s) => { const v = scored.get(s); return !(typeof v === "number" && v >= 1 && v <= 4); })) {
        throw new ApiError(422, "RUBRIC_INCOMPLETE", "Score every skill from 1 to 4.");
      }
      // The server's own suggestion (the client's value is ignored).
      const suggested = suggestResult(required, Object.fromEntries(input.rubric.map((r) => [r.skill, r.score])));
      const overrideReason = (input.overrideReason ?? "").trim();
      if (suggested && input.result !== suggested && overrideReason.length < OVERRIDE_REASON_MIN) {
        throw new ApiError(
          422,
          "OVERRIDE_REASON_REQUIRED",
          `Your result differs from the suggested ${RESULT_LABEL[suggested]}. Say why for the interview team (at least ${OVERRIDE_REASON_MIN} characters).`
        );
      }
      const category = input.integrityFlag ? input.integrityCategory ?? null : null;
      if (input.integrityFlag && !(category && Object.hasOwn(INTEGRITY_CATEGORIES, category))) {
        throw new ApiError(422, "CATEGORY_REQUIRED", "Choose what kind of integrity concern it is.");
      }
      if (!bk.code_verified && !input.codeMatched) {
        throw new ApiError(422, "CODE_CHECK_REQUIRED", "The booking code wasn't checked at join. Confirm the code the student read out matches.");
      }
      // A face that doesn't match, or a concern the interviewer raises, holds the result
      // and opens an integrity case. The student sees "Result pending" until it's decided.
      const reasons = [
        input.faceMatched === false ? "Face didn't match the registered photo and college ID" : null,
        input.integrityFlag ? "Interviewer raised an integrity concern" : null,
      ].filter(Boolean) as string[];
      const held = reasons.length > 0;
      // A Pass against the suggestion goes to a second reviewer before it publishes (spec section 5, I3).
      const secondReview = !held && input.result === "PASS" && suggested !== null && suggested !== "PASS";
      if (j.state === "BOOKED" && liveBooking) {
        // Attendance check (T+15) hasn't run yet: apply its "joined" branch now.
        await tx`UPDATE bookings SET status = 'COMPLETED', student_joined_at = COALESCE(student_joined_at, app_now()), updated_at = app_now() WHERE id = ${input.bookingId}`;
        await transitionJourney(tx, { journeyId: bk.journey_id, action: "attend", reason: "Result pending", actorUserId: input.userId, lock: false });
      } else if (j.state !== "AWAITING_RESULT" || !liveBooking) {
        throw new ApiError(409, "NOT_RECORDABLE", "This interview isn't ready for an outcome.");
      }

      const publishAt = await tx<{ p: Date }[]>`SELECT app_now() + make_interval(mins => ${rules.publish_delay_minutes}) p`;
      const saved = await tx<{ id: string; publish_at: Date; review_status: string }[]>`
        INSERT INTO interview_outcomes
          (booking_id, what_happened, result, suggested_result, rubric, feedback_to_student, focus_areas,
           internal_notes_encrypted, integrity_flag, face_matched, integrity_reason, recorded_by, submitted_at, publish_at, review_status,
           override_reason, integrity_category)
        VALUES
          (${input.bookingId}, 'COMPLETED', ${input.result}, ${suggested},
           ${tx.json(input.rubric)}, ${input.feedback ?? null}, ${tx.json(input.focusAreas ?? [])},
           ${input.internalNotes ?? null}, ${held}, ${input.faceMatched ?? null}, ${held ? reasons.join(". ") : null}, ${input.userId},
           app_now(), ${publishAt[0].p}, ${held ? "WITHHELD" : secondReview ? "PENDING_SECOND_REVIEW" : "NONE"},
           ${overrideReason || null}, ${category})
        ON CONFLICT (booking_id) DO UPDATE SET
           what_happened = EXCLUDED.what_happened, result = EXCLUDED.result, suggested_result = EXCLUDED.suggested_result,
           rubric = EXCLUDED.rubric, feedback_to_student = EXCLUDED.feedback_to_student, focus_areas = EXCLUDED.focus_areas,
           internal_notes_encrypted = EXCLUDED.internal_notes_encrypted, integrity_flag = EXCLUDED.integrity_flag,
           face_matched = EXCLUDED.face_matched, integrity_reason = EXCLUDED.integrity_reason,
           override_reason = EXCLUDED.override_reason, integrity_category = EXCLUDED.integrity_category,
           recorded_by = EXCLUDED.recorded_by,
           -- Edits inside the window keep the original submit/publish times, so
           -- "you can edit until <time>" stays true and the student isn't delayed.
           submitted_at = interview_outcomes.submitted_at, publish_at = interview_outcomes.publish_at,
           -- The interviewer can raise a concern (NONE -> WITHHELD) but never lower one.
           review_status = CASE WHEN interview_outcomes.review_status = 'NONE' THEN EXCLUDED.review_status
                                ELSE interview_outcomes.review_status END
        -- Guards the race with the publisher job: never overwrite a locked or due outcome.
        WHERE interview_outcomes.locked_at IS NULL
          AND interview_outcomes.publish_at > app_now()
          AND interview_outcomes.review_status = 'NONE'
        RETURNING id, publish_at, review_status`;
      if (!saved[0]) throw new ApiError(409, "EDIT_WINDOW_CLOSED", "The edit window has closed. The result is being published.");
      if (held) {
        await openIntegrityCase(tx, { bookingId: input.bookingId, openedBy: input.userId, reason: reasons.join(". "), category });
        return { publishAtIso: null, whatHappened: "COMPLETED" as const, held: true };
      }
      if (saved[0].review_status === "PENDING_SECOND_REVIEW") {
        const dup = await tx`SELECT 1 FROM approvals WHERE action = 'SECOND_REVIEW' AND status = 'PENDING' AND payload->>'outcomeId' = ${saved[0].id}`;
        if (!dup.length) {
          await tx`
            INSERT INTO approvals (action, requested_by, interviewer_id, journey_id, payload, reason, created_at)
            VALUES ('SECOND_REVIEW', ${input.userId}, ${input.interviewerId}, ${bk.journey_id},
                    ${tx.json({ outcomeId: saved[0].id })},
                    ${`Pass against the suggested ${suggested ? RESULT_LABEL[suggested] : "result"}: ${overrideReason}`}, app_now())`;
        }
        return { publishAtIso: null, whatHappened: "COMPLETED" as const, held: false, secondReview: true };
      }
      return { publishAtIso: saved[0].publish_at.toISOString(), whatHappened: "COMPLETED" as const, held: false };
    }

    if (input.whatHappened === "DROPPED") {
      // Spec section 2: the first dropped call per journey is a free Retake later; later
      // ones count only if at least 15 minutes were assessed (then record a result).
      if (!bk.student_joined) throw new ApiError(409, "STUDENT_NOT_JOINED", "The student never joined, so the call can't have dropped.");
      if (j.drop_used && input.assessed15) {
        throw new ApiError(
          422,
          "RECORD_A_RESULT",
          "This student already had a free retake for a dropped call, and you assessed 15 minutes or more. Choose \"Interview completed\" and record a result."
        );
      }
      if (j.state === "BOOKED" && liveBooking) {
        await tx`UPDATE bookings SET status = 'COMPLETED', updated_at = app_now() WHERE id = ${input.bookingId}`;
        await transitionJourney(tx, { journeyId: bk.journey_id, action: "attend", reason: "Call dropped", actorUserId: input.userId, lock: false });
      } else if (j.state !== "AWAITING_RESULT" || !liveBooking) {
        throw new ApiError(409, "NOT_RECORDABLE", "This interview isn't ready for an outcome.");
      }
      const cd = (await tx<{ retake_cooldown_days: number }[]>`SELECT retake_cooldown_days FROM season_rules LIMIT 1`)[0];
      // Same "3rd Retake later in a row" gate as published retakes, so repeated drops can't loop forever.
      const streak = j.consecutive_retake_later + 1;
      const needsApproval = streak >= THIRD_RETAKE_STREAK;
      await transitionJourney(tx, {
        journeyId: bk.journey_id,
        action: "publish_retake",
        reason: "Call dropped: Retake later, no attempt used",
        actorUserId: input.userId,
        lock: false,
        patch: {
          cooldown_until: new Date(bk.start_at.getTime() + cd.retake_cooldown_days * 86_400_000),
          drop_used: true,
          consecutive_retake_later: streak,
          retake_approval_pending: needsApproval,
        },
        payload: { whatHappened: "DROPPED", assessed15: !!input.assessed15 },
      });
      // Not the student's doing: keep them bookable if this was in the last days before the deadline.
      await protectIfLastDays(tx, bk.journey_id, bk.start_at);
      const saved = await tx<{ id: string }[]>`
        INSERT INTO interview_outcomes
          (booking_id, what_happened, result, suggested_result, rubric, feedback_to_student, focus_areas,
           internal_notes_encrypted, integrity_flag, recorded_by, submitted_at, publish_at, locked_at, review_status, assessed_15)
        VALUES
          (${input.bookingId}, 'DROPPED', 'RETAKE_LATER', NULL, '[]'::jsonb, ${DROPPED_FEEDBACK}, '[]'::jsonb,
           ${(input.internalNotes ?? "").trim()}, false, ${input.userId}, app_now(), app_now(), app_now(), 'RELEASED', ${!!input.assessed15})
        ON CONFLICT (booking_id) DO UPDATE SET
           what_happened = 'DROPPED', result = 'RETAKE_LATER', suggested_result = NULL, rubric = '[]'::jsonb,
           feedback_to_student = EXCLUDED.feedback_to_student, focus_areas = '[]'::jsonb,
           internal_notes_encrypted = EXCLUDED.internal_notes_encrypted, integrity_flag = false,
           recorded_by = EXCLUDED.recorded_by, publish_at = app_now(), locked_at = app_now(),
           review_status = 'RELEASED', assessed_15 = EXCLUDED.assessed_15
        WHERE interview_outcomes.locked_at IS NULL
          AND interview_outcomes.publish_at > app_now()
          AND interview_outcomes.review_status = 'NONE'
        RETURNING id`;
      if (!saved[0]) throw new ApiError(409, "EDIT_WINDOW_CLOSED", "The edit window has closed. The result is being published.");
      if (needsApproval) {
        await tx`
          INSERT INTO approvals (action, journey_id, payload, reason, created_at)
          VALUES ('THIRD_RETAKE', ${bk.journey_id}, ${tx.json({ outcomeId: saved[0].id })},
                  ${`Retake later ${streak} times in a row (latest: a dropped call)`}, app_now())`;
      }
      return { publishAtIso: null, whatHappened: "DROPPED" as const };
    }

    if (input.whatHappened === "NO_JOIN") {
      if (bk.student_joined) {
        throw new ApiError(409, "STUDENT_JOINED", "The student joined this interview, so choose another option.");
      }
      if (j.state !== "BOOKED" || !liveBooking) throw new ApiError(409, "NOT_RECORDABLE", "This interview isn't ready for an outcome.");
      if (!bk.no_join_open) {
        const from = new Date(bk.start_at.getTime() + rules.join_grace_minutes * 60_000);
        throw new ApiError(409, "TOO_EARLY", `The student can still join until ${timeOnly(from)}. Mark "didn't join" after that.`);
      }
      await recordNoShow(tx, {
        bookingId: input.bookingId,
        journeyId: bk.journey_id,
        startAt: bk.start_at,
        noshowCooldownDays: rules.noshow_cooldown_days,
        actorUserId: input.userId,
        reason: "Missed interview (reported by interviewer)",
      });
    } else {
      // PLATFORM / UNFAIR: void the attempt.
      if (!liveBooking || (j.state !== "BOOKED" && j.state !== "AWAITING_RESULT")) {
        throw new ApiError(409, "NOT_RECORDABLE", "This interview isn't ready for an outcome.");
      }
      await tx`UPDATE bookings SET status = 'VOID', void_reason = ${input.whatHappened}, updated_at = app_now() WHERE id = ${input.bookingId}`;
      // The slot time has passed (we only get here after start), so it isn't reopened.
      await tx`UPDATE interview_slots SET status = 'CANCELLED', version = version + 1 WHERE id = ${bk.slot_id} AND start_at <= app_now()`;
      await transitionJourney(tx, {
        journeyId: bk.journey_id,
        action: "interviewer_fault",
        reason: input.whatHappened === "PLATFORM" ? "Interview couldn't happen (interviewer or platform)" : "Interview couldn't finish fairly",
        actorUserId: input.userId,
        lock: false,
        patch: { priority_rebook: true, cooldown_until: null },
        payload: { whatHappened: input.whatHappened },
      });
      await protectIfLastDays(tx, bk.journey_id, bk.start_at);
    }

    // Record what happened: locked straight away, no result, nothing for the student to see.
    const saved = await tx<{ id: string }[]>`
      INSERT INTO interview_outcomes
        (booking_id, what_happened, result, suggested_result, rubric, feedback_to_student, focus_areas,
         internal_notes_encrypted, integrity_flag, recorded_by, submitted_at, publish_at, locked_at, review_status)
      VALUES
        (${input.bookingId}, ${input.whatHappened}, NULL, NULL, '[]'::jsonb, NULL, '[]'::jsonb,
         ${(input.internalNotes ?? "").trim()}, false, ${input.userId}, app_now(), app_now(), app_now(), 'NONE')
      ON CONFLICT (booking_id) DO UPDATE SET
         what_happened = EXCLUDED.what_happened, result = NULL, suggested_result = NULL, rubric = '[]'::jsonb,
         feedback_to_student = NULL, focus_areas = '[]'::jsonb,
         internal_notes_encrypted = EXCLUDED.internal_notes_encrypted, integrity_flag = false,
         recorded_by = EXCLUDED.recorded_by, publish_at = app_now(), locked_at = app_now()
      WHERE interview_outcomes.locked_at IS NULL
        AND interview_outcomes.publish_at > app_now()
        AND interview_outcomes.review_status = 'NONE'
      RETURNING id`;
    if (!saved[0]) throw new ApiError(409, "EDIT_WINDOW_CLOSED", "The edit window has closed. The result is being published.");
    return { publishAtIso: null, whatHappened: input.whatHappened };
  });
}

export interface AvailabilityView {
  weekly: { weekday: number; startLocal: string; endLocal: string }[];
  overrides: { date: string; kind: "ADD" | "REMOVE"; startLocal: string | null; endLocal: string | null }[];
  tracks: { name: string; maxLevel: number }[];
  maxPerDay: number;
  /** season_rules.horizon_days: how far ahead slots exist. */
  horizonDays: number;
  /** OPEN + BOOKED slots starting within the horizon. */
  slotsInHorizon: number;
  bookedInHorizon: number;
  /** Future slots a save keeps (BOOKED / BLOCKED), as IST date + minutes after midnight,
   *  so the editor's preview can skip their times like materializeSlots does. */
  keptSlots: { date: string; startMin: number }[];
}

export async function getAvailability(interviewerId: string): Promise<AvailabilityView> {
  const weekly = await sql<{ weekday: number; start_local: string; end_local: string }[]>`
    SELECT weekday, start_local, end_local FROM availability_rules
    WHERE interviewer_id = ${interviewerId} AND active ORDER BY weekday, start_local, end_local`;
  const overrides = await sql<{ date: string; kind: "ADD" | "REMOVE"; start_local: string | null; end_local: string | null }[]>`
    SELECT to_char(date, 'YYYY-MM-DD') date, kind, start_local, end_local FROM availability_overrides
    WHERE interviewer_id = ${interviewerId} AND date >= (app_now() AT TIME ZONE 'Asia/Kolkata')::date
    ORDER BY date`;
  const tracks = await sql<{ name: string; max_badge_level: number }[]>`
    SELECT t.name, it.max_badge_level FROM interviewer_tracks it JOIN tracks t ON t.id = it.track_id
    WHERE it.interviewer_id = ${interviewerId} ORDER BY t.sort`;
  const iv = (await sql<{ max_per_day: number }[]>`SELECT max_per_day FROM interviewers WHERE id = ${interviewerId}`)[0];
  const stats = (await sql<{ horizon: number; total: number; booked: number }[]>`
    SELECT r.horizon_days horizon,
           count(s.id) FILTER (WHERE s.status IN ('OPEN','BOOKED'))::int total,
           count(s.id) FILTER (WHERE s.status = 'BOOKED')::int booked
    FROM (SELECT COALESCE((SELECT horizon_days FROM season_rules LIMIT 1), 14) horizon_days) r
    LEFT JOIN interview_slots s
      ON s.interviewer_id = ${interviewerId} AND s.start_at >= app_now()
     AND s.start_at < app_now() + make_interval(days => r.horizon_days)
    GROUP BY r.horizon_days`)[0];
  const kept = await sql<{ date: string; m: number }[]>`
    SELECT to_char(start_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') date,
           (extract(hour FROM start_at AT TIME ZONE 'Asia/Kolkata') * 60
            + extract(minute FROM start_at AT TIME ZONE 'Asia/Kolkata'))::int m
    FROM interview_slots
    WHERE interviewer_id = ${interviewerId} AND status IN ('BOOKED','BLOCKED') AND start_at > app_now()
    ORDER BY start_at`;
  return {
    weekly: weekly.map((w) => ({ weekday: w.weekday, startLocal: w.start_local, endLocal: w.end_local })),
    overrides: overrides.map((o) => ({
      date: o.date,
      kind: o.kind,
      startLocal: o.start_local ? o.start_local.slice(0, 5) : null,
      endLocal: o.end_local ? o.end_local.slice(0, 5) : null,
    })),
    tracks: tracks.map((t) => ({ name: t.name, maxLevel: t.max_badge_level })),
    maxPerDay: iv?.max_per_day ?? 8,
    horizonDays: stats.horizon,
    slotsInHorizon: stats.total,
    bookedInHorizon: stats.booked,
    keptSlots: kept.map((k) => ({ date: k.date, startMin: k.m })),
  };
}
