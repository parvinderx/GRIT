/**
 * The interview journey state machine (Section 1 of the design doc).
 * - JourneyState: the 11 stored states.
 * - ENGINE_TRANSITIONS: legal (action -> to) edges the command handler applies;
 *   the DB trigger enforces the same set as a backstop.
 * - ViewState + deriveViewState: the UI sub-variants the copy table distinguishes.
 * - computeStudentActions: which student actions are allowed right now (role +
 *   state + time windows). The server returns these as allowed_actions.
 */
import { FREE_CHANGES } from "./rules";

export type JourneyState =
  | "LOCKED"
  | "ELIGIBLE"
  | "BOOKED"
  | "AWAITING_RESULT"
  | "PASSED"
  | "FAILED"
  | "RETAKE_LATER"
  | "NO_SHOW"
  | "ON_HOLD"
  | "NULLIFIED"
  | "CLOSED";

export type EngineAction =
  | "book"
  | "reschedule" // stays BOOKED
  | "cancel" // >=12h -> ELIGIBLE
  | "interviewer_fault" // BOOKED/AWAITING_RESULT -> ELIGIBLE + priority, attempt voided
  | "emergency_void" // -> ELIGIBLE (no attempt)
  | "attend" // both joined -> AWAITING_RESULT
  | "no_show" // -> NO_SHOW
  | "publish_pass"
  | "publish_fail"
  | "publish_retake"
  | "cooldown_expire" // FAILED/RETAKE/NO_SHOW -> ELIGIBLE
  | "skill_revoked" // ELIGIBLE -> LOCKED
  | "deadline_close" // -> CLOSED
  | "attempt_close" // -> CLOSED
  | "hold" // any -> ON_HOLD
  | "dismiss_hold" // ON_HOLD -> prev
  | "confirm_nullify" // ON_HOLD -> NULLIFIED
  | "confirm_close" // ON_HOLD -> CLOSED
  | "reopen" // NULLIFIED -> LOCKED / CLOSED -> ELIGIBLE
  | "unlock" // LOCKED -> ELIGIBLE
  | "waive_no_show" // approved emergency after a missed interview: NO_SHOW -> ELIGIBLE, attempt refunded
  | "amend_pass" // approved result change to Pass
  | "amend_fail" // approved result change Retake -> Fail (or declined 3rd Retake)
  | "amend_retake" // approved result change Fail -> Retake later
  | "season_close"; // season end (14 Feb) closes what's left

export interface TransitionDef {
  action: EngineAction;
  to: JourneyState;
}

/** Legal state-changing edges per state. Self-transitions (reschedule) excluded. */
export const ENGINE_TRANSITIONS: Record<JourneyState, TransitionDef[]> = {
  LOCKED: [
    { action: "unlock", to: "ELIGIBLE" },
    { action: "hold", to: "ON_HOLD" },
    { action: "season_close", to: "CLOSED" },
  ],
  ELIGIBLE: [
    { action: "book", to: "BOOKED" },
    { action: "skill_revoked", to: "LOCKED" },
    { action: "deadline_close", to: "CLOSED" },
    { action: "season_close", to: "CLOSED" },
    { action: "hold", to: "ON_HOLD" },
    // an approved result change can land after the cooldown already expired
    { action: "amend_pass", to: "PASSED" },
  ],
  BOOKED: [
    { action: "attend", to: "AWAITING_RESULT" },
    { action: "no_show", to: "NO_SHOW" },
    { action: "cancel", to: "ELIGIBLE" },
    { action: "interviewer_fault", to: "ELIGIBLE" },
    { action: "emergency_void", to: "ELIGIBLE" },
  ],
  AWAITING_RESULT: [
    // Interviewer records "Couldn't happen: my side or the platform" / "Couldn't finish
    // fairly" after the attendance check already moved the journey on: the attempt is
    // voided and the student gets a priority rebook (migration 0004 mirrors this edge).
    { action: "interviewer_fault", to: "ELIGIBLE" },
    { action: "publish_pass", to: "PASSED" },
    { action: "publish_fail", to: "FAILED" },
    { action: "publish_retake", to: "RETAKE_LATER" },
  ],
  PASSED: [{ action: "hold", to: "ON_HOLD" }],
  FAILED: [
    { action: "cooldown_expire", to: "ELIGIBLE" },
    { action: "attempt_close", to: "CLOSED" },
    { action: "deadline_close", to: "CLOSED" },
    { action: "season_close", to: "CLOSED" },
    { action: "hold", to: "ON_HOLD" },
    { action: "amend_pass", to: "PASSED" },
    { action: "amend_retake", to: "RETAKE_LATER" },
  ],
  RETAKE_LATER: [
    { action: "cooldown_expire", to: "ELIGIBLE" },
    { action: "deadline_close", to: "CLOSED" },
    { action: "season_close", to: "CLOSED" },
    { action: "hold", to: "ON_HOLD" },
    { action: "amend_pass", to: "PASSED" },
    { action: "amend_fail", to: "FAILED" },
  ],
  NO_SHOW: [
    { action: "cooldown_expire", to: "ELIGIBLE" },
    { action: "waive_no_show", to: "ELIGIBLE" },
    { action: "attempt_close", to: "CLOSED" },
    { action: "deadline_close", to: "CLOSED" },
    { action: "season_close", to: "CLOSED" },
    { action: "hold", to: "ON_HOLD" },
  ],
  // Dismissing a hold restores the state the journey was in (hold_prev_state);
  // transitionJourney picks the edge with opts.to.
  ON_HOLD: [
    { action: "dismiss_hold", to: "ELIGIBLE" },
    { action: "dismiss_hold", to: "LOCKED" },
    { action: "dismiss_hold", to: "PASSED" },
    { action: "dismiss_hold", to: "FAILED" },
    { action: "dismiss_hold", to: "RETAKE_LATER" },
    { action: "dismiss_hold", to: "NO_SHOW" },
    { action: "dismiss_hold", to: "AWAITING_RESULT" },
    { action: "dismiss_hold", to: "BOOKED" },
    { action: "confirm_nullify", to: "NULLIFIED" },
    { action: "confirm_close", to: "CLOSED" },
  ],
  NULLIFIED: [{ action: "reopen", to: "LOCKED" }],
  CLOSED: [
    { action: "reopen", to: "ELIGIBLE" },
    // approved result change on a journey the attempt limit had closed
    { action: "amend_pass", to: "PASSED" },
    { action: "amend_retake", to: "RETAKE_LATER" },
  ],
};

// ── View states (UI sub-variants) ───────────────────────────────────────────
export type ViewState =
  | "LOCKED"
  | "ELIGIBLE_READY"
  | "ELIGIBLE_OTHER_BOOKED"
  | "ELIGIBLE_AFTER_CANCEL"
  | "BOOKED_SCHEDULED"
  | "BOOKED_UNDER_12H"
  | "BOOKED_LIVE_NOW"
  | "AWAITING_RESULT"
  | "PASSED"
  | "FAILED"
  | "RETAKE_LATER"
  | "NO_SHOW"
  | "ON_HOLD"
  | "CLOSED_ATTEMPT_LIMIT"
  | "CLOSED_DEADLINE"
  | "CLOSED_REVIEW"
  | "NULLIFIED";

/** state_reason written by the deadline sweep (services/jobs.ts). */
export const DEADLINE_CLOSE_REASON_PREFIX = "Booking closed — deadline";
/** state_reason written by closeIfAttemptLimit (services/jobs.ts). */
export const ATTEMPT_LIMIT_REASON = "Attempt limit reached";

export interface DeriveCtx {
  nowMs: number;
  bookingStartMs?: number | null;
  changeCutoffHours: number;
  joinOpenMinutes: number;
  joinGraceMinutes: number;
  hasOtherUpcoming?: boolean;
}

export function deriveViewState(
  journey: {
    state: JourneyState;
    priorityRebook?: boolean;
    attemptCount?: number;
    maxAttempts?: number;
    /** interview_journeys.state_reason — tells the three kinds of CLOSED apart. */
    stateReason?: string | null;
  },
  ctx: DeriveCtx
): ViewState {
  switch (journey.state) {
    case "LOCKED":
      return "LOCKED";
    case "ELIGIBLE":
      if (journey.priorityRebook) return "ELIGIBLE_AFTER_CANCEL";
      if (ctx.hasOtherUpcoming) return "ELIGIBLE_OTHER_BOOKED";
      return "ELIGIBLE_READY";
    case "BOOKED": {
      const start = ctx.bookingStartMs ?? null;
      if (start != null) {
        const openMs = start - ctx.joinOpenMinutes * 60_000;
        const graceMs = start + ctx.joinGraceMinutes * 60_000;
        if (ctx.nowMs >= openMs && ctx.nowMs <= graceMs) return "BOOKED_LIVE_NOW";
        const cutoffMs = start - ctx.changeCutoffHours * 3_600_000;
        if (ctx.nowMs >= cutoffMs) return "BOOKED_UNDER_12H";
      }
      return "BOOKED_SCHEDULED";
    }
    case "AWAITING_RESULT":
      return "AWAITING_RESULT";
    case "PASSED":
      return "PASSED";
    case "FAILED":
      return "FAILED";
    case "RETAKE_LATER":
      return "RETAKE_LATER";
    case "NO_SHOW":
      return "NO_SHOW";
    case "ON_HOLD":
      return "ON_HOLD";
    case "NULLIFIED":
      return "NULLIFIED";
    case "CLOSED": {
      // Closed three ways: attempt cap (jobs.closeIfAttemptLimit), deadline sweep
      // (jobs.deadlineSweep), or an integrity review (confirm_close).
      const reason = journey.stateReason ?? "";
      if (reason === ATTEMPT_LIMIT_REASON) return "CLOSED_ATTEMPT_LIMIT";
      if (reason.startsWith(DEADLINE_CLOSE_REASON_PREFIX)) return "CLOSED_DEADLINE";
      if ((journey.attemptCount ?? 0) >= (journey.maxAttempts ?? 3)) return "CLOSED_ATTEMPT_LIMIT";
      return "CLOSED_REVIEW";
    }
  }
}

// ── Student action keys (allowed_actions) ────────────────────────────────────
export type ActionKey =
  | "book"
  | "view_details"
  | "view_contests"
  | "see_rank"
  | "calendar_reminder"
  | "book_retake"
  | "contact_support"
  | "view_my_interview"
  | "rebook_now"
  | "reschedule"
  | "cancel"
  | "test_setup"
  | "report_emergency"
  | "join"
  | "interviewer_absent"
  | "add_calendar"
  | "report_problem"
  | "read_rules"
  | "practise"
  | "back_dashboard";

/** Which student actions are permitted right now (time-window aware). */
export function computeStudentActions(
  journey: Parameters<typeof deriveViewState>[0] & {
    cooldownUntil?: Date | string | null;
  },
  ctx: DeriveCtx & {
    bookingStatus?: string | null;
    changesCount?: number;
    emergencyCutoffHours?: number;
    joinWindowOpen?: boolean;
  }
): ActionKey[] {
  const view = deriveViewState(journey, ctx);
  const start = ctx.bookingStartMs ?? null;
  const now = ctx.nowMs;
  const actions: ActionKey[] = [];

  switch (view) {
    case "LOCKED":
      actions.push("view_contests");
      break;
    case "ELIGIBLE_READY":
      actions.push("book");
      break;
    case "ELIGIBLE_OTHER_BOOKED":
      actions.push("view_my_interview");
      break;
    case "ELIGIBLE_AFTER_CANCEL":
      actions.push("rebook_now");
      break;
    case "BOOKED_SCHEDULED": {
      actions.push("view_details", "add_calendar");
      if (start != null && (ctx.changesCount ?? 0) < FREE_CHANGES) {
        actions.push("reschedule", "cancel");
      }
      break;
    }
    case "BOOKED_UNDER_12H":
      actions.push("test_setup", "report_emergency", "add_calendar");
      break;
    case "BOOKED_LIVE_NOW":
      if (ctx.joinWindowOpen) actions.push("join");
      if (start != null && now >= start + 5 * 60_000) actions.push("interviewer_absent");
      break;
    case "AWAITING_RESULT":
      actions.push("view_details");
      break;
    case "PASSED":
      actions.push("see_rank");
      break;
    case "FAILED":
      actions.push("calendar_reminder", "practise");
      break;
    case "RETAKE_LATER":
      actions.push("calendar_reminder");
      break;
    case "NO_SHOW":
      actions.push("calendar_reminder", "report_problem");
      break;
    case "ON_HOLD":
      actions.push("read_rules");
      break;
    case "CLOSED_ATTEMPT_LIMIT":
      actions.push("contact_support");
      break;
    case "CLOSED_DEADLINE":
      actions.push("read_rules");
      break;
    case "CLOSED_REVIEW":
      actions.push("contact_support");
      break;
    case "NULLIFIED":
      actions.push("contact_support");
      break;
  }
  return actions;
}
