/**
 * Single source of truth for journey copy.
 * STATUS = list chips keyed by stored state. VIEW = hero copy keyed by view-state.
 * ACTION_META = how each action renders. Student hero presentation lives in studentHero.ts.
 */
import {
  AlertTriangle,
  Ban,
  CalendarCheck,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardPen,
  Clock,
  Eye,
  Hourglass,
  KeyRound,
  LifeBuoy,
  PenLine,
  Radio,
  RotateCcw,
  Search,
  ShieldAlert,
  Timer,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type { JourneyState, ViewState, ActionKey } from "@/lib/state-machine";
import type { RowKind } from "@/services/interviewerView";
import type { DeadlineRisk } from "@/services/adminView";
import { JOIN_OPEN_MINUTES } from "@/lib/rules";

/**
 * One status vocabulary — one meaning per tone, used on every screen:
 *   good       saffron (solid)  the student's ONE next step / earned reward only
 *   pending    amber            waiting on someone
 *   action     alert (red)      needs action / overdue
 *   review     purple           under review
 *   live       go (green)       live / positive
 *   scheduled  cobalt outline   scheduled
 *   cobaltSoft cobalt fill      informational / ready
 *   neutral    grey             neutral
 *   muted      grey (quiet)     done / closed
 *   open       grey dashed      empty / unfilled (e.g. an open slot)
 */
export type ChipTone =
  | "neutral"
  | "cobaltSoft"
  | "scheduled"
  | "live"
  | "pending"
  | "good"
  | "review"
  | "muted"
  | "action"
  | "open";

export interface ChipDef {
  chipLabel: string;
  tone: ChipTone;
  icon: string;
}

export const STATUS: Record<JourneyState, ChipDef> = {
  LOCKED: { chipLabel: "Locked", tone: "neutral", icon: "Lock" },
  ELIGIBLE: { chipLabel: "Ready to book", tone: "cobaltSoft", icon: "CalendarPlus" },
  BOOKED: { chipLabel: "Interview scheduled", tone: "scheduled", icon: "CalendarCheck" },
  AWAITING_RESULT: { chipLabel: "Result pending", tone: "pending", icon: "Hourglass" },
  PASSED: { chipLabel: "Badge earned", tone: "good", icon: "Award" },
  FAILED: { chipLabel: "Not cleared", tone: "neutral", icon: "Milestone" },
  RETAKE_LATER: { chipLabel: "Retake later", tone: "pending", icon: "RotateCcw" },
  NO_SHOW: { chipLabel: "Missed interview", tone: "neutral", icon: "CalendarX" },
  ON_HOLD: { chipLabel: "Under review", tone: "review", icon: "ShieldAlert" },
  NULLIFIED: { chipLabel: "Badge nullified", tone: "muted", icon: "Ban" },
  CLOSED: { chipLabel: "Booking closed", tone: "muted", icon: "Lock" },
};

export interface JourneyCtx {
  journeyId: string;
  bookingId?: string | null;
  badgeName: string;
  miles: number;
  skillsRemaining?: number;
  skillsCleared?: number;
  skillsTotal?: number;
  skillList?: string;
  nextUnlockDateHuman?: string;
  interviewDateHuman?: string;
  interviewTimeHuman?: string;
  joinOpenHuman?: string;
  changeCutoffHuman?: string;
  retakeDateHuman?: string;
  missedRebookDateHuman?: string;
  attemptsLeft?: number;
  maxAttempts?: number;
  daysToDeadline?: number;
  daysToInterview?: number;
  changesLeft?: number;
  otherBadgeName?: string;
  otherInterviewDateHuman?: string;
  interviewerFirstName?: string;
  bookingCode?: string;
  hoursToStart?: number;
  minsToStart?: number;
  /** The student's other booked interview (for ELIGIBLE_OTHER_BOOKED). */
  otherBookingId?: string | null;
  /** Latest released outcome on this journey (any attempt). */
  hasPublishedOutcome?: boolean;
  /** The recorded result is held for an integrity review (outcome WITHHELD). */
  resultUnderReview?: boolean;
  /** The last result is "Not cleared" because an integrity case was confirmed. */
  notClearedAfterReview?: boolean;
  lastOutcomeResult?: "PASS" | "FAIL" | "RETAKE_LATER";
  lastFeedback?: string;
  lastFocusAreas?: string[];
  lastInterviewDateHuman?: string;
  /** journeys.cooldown_until is set (a calendar reminder can be offered). */
  hasCooldownDate?: boolean;
  /** No-badge student whose cooldown ends after the season deadline. */
  cooldownPastDeadline?: boolean;
  /** Season deadline from seasons.deadline_at: "31 Dec". */
  deadlineHuman?: string;
  /** Season deadline from seasons.deadline_at: "31 Dec 2026, 11:59 PM IST". */
  deadlineFullHuman?: string;
  /** Priority rebooking: season_rules.priority_booking_cutoff_hours (booking stays open
   *  until this long before a start, instead of booking_cutoff_hours). */
  priorityCutoffHours?: number;
  /** Result pending and already recorded: when it comes out ("7:52 PM today"). */
  resultAtHuman?: string;
  /** The interview date with the year, for badge dates: "28 Nov 2026". */
  interviewDateLongHuman?: string;
  /** The interview date without weekday: "28 Nov". */
  interviewDayHuman?: string;
  /** PASSED and this is the student's only active badge (they just became a Qualiflyer). */
  firstBadge?: boolean;
  /** Earned in the last few days: the hero and medal celebrate it. */
  earnedRecently?: boolean;
  /** Next badge up in the same track, for "What's next". */
  nextBadgeName?: string;
  nextBadgeJourneyId?: string | null;
  /** The last released result on this journey was a Retake later (book again = "Book your retake"). */
  lastWasRetake?: boolean;
}

/** "Your next attempt would open after the 31 Dec deadline" — for cooldowns that outlast the season. */
export function afterDeadlineText(c: JourneyCtx): string {
  return `Your next attempt would open after the ${c.deadlineHuman ?? "season"} deadline`;
}

export interface ViewDef {
  chipState: JourneyState;
  title: (c: JourneyCtx) => string;
  body: (c: JourneyCtx) => string;
  /** The ONE button. Absent (or unavailable) = no button. */
  primary?: HeroActionKey;
  /** At most a couple of quiet text links. */
  secondary: HeroActionKey[];
  showDeadlineStrip: boolean;
}

export const VIEW: Record<ViewState, ViewDef> = {
  LOCKED: {
    chipState: "LOCKED",
    title: (c) => (c.skillsRemaining ? `${c.skillsRemaining} skills to go` : "Clear remaining skills"),
    body: (c) => `Clear ${c.skillList ?? "the remaining skills"} to unlock your ${c.badgeName} interview.`,
    primary: "how_to_clear",
    secondary: [],
    showDeadlineStrip: true,
  },
  ELIGIBLE_READY: {
    chipState: "ELIGIBLE",
    title: () => "Book your Level Clearance Interview",
    body: (c) =>
      `All skills for ${c.badgeName} are cleared. One 30-min live interview stands between you and the badge, plus ${c.miles} Miles.`,
    primary: "book",
    secondary: [],
    showDeadlineStrip: true,
  },
  ELIGIBLE_OTHER_BOOKED: {
    chipState: "ELIGIBLE",
    title: (c) => `${c.badgeName} is ready`,
    body: (c) =>
      `You can hold one interview at a time. Book this one after your ${c.otherBadgeName ?? "other"} interview on ${c.otherInterviewDateHuman ?? "its date"}.`,
    primary: "view_my_interview",
    secondary: [],
    showDeadlineStrip: true,
  },
  ELIGIBLE_AFTER_CANCEL: {
    chipState: "ELIGIBLE",
    title: () => "Your interview was called off. Not your fault.",
    body: (c) =>
      `Your last interview${c.interviewDateHuman ? ` on ${c.interviewDateHuman}` : ""} was called off on our side, so it doesn't count. Book a new time. You get priority` +
      (c.priorityCutoffHours != null ? `: you can book up to ${c.priorityCutoffHours} h before a start time.` : "."),
    primary: "rebook_now",
    secondary: [],
    showDeadlineStrip: true,
  },
  BOOKED_SCHEDULED: {
    chipState: "BOOKED",
    title: (c) => (c.interviewDateHuman ? `${c.interviewDateHuman}, ${c.interviewTimeHuman ?? ""} IST` : "Your interview is booked"),
    body: (c) =>
      `${c.badgeName}. Join opens on your interview page at ${c.joinOpenHuman ? `${c.joinOpenHuman} IST` : `${JOIN_OPEN_MINUTES} min before the start`}. ` +
      ((c.changesLeft ?? 0) > 0 ? `You can change or cancel until ${c.changeCutoffHuman ?? "12 h before"}.` : "You've used your free changes."),
    primary: "add_calendar",
    secondary: ["manage_booking"],
    showDeadlineStrip: false,
  },
  BOOKED_UNDER_12H: {
    chipState: "BOOKED",
    title: (c) =>
      c.interviewDateHuman ? `${c.interviewDateHuman}, ${c.interviewTimeHuman ?? ""} IST` : "Your interview is coming up",
    body: (c) =>
      (c.hoursToStart != null ? `Starts in ${c.hoursToStart} h ${c.minsToStart ?? 0} min. ` : "") +
      `Changes are closed now. Test your camera and mic on your interview page. Join opens there ${c.joinOpenHuman ? `at ${c.joinOpenHuman} IST` : `${JOIN_OPEN_MINUTES} min before the start`}.`,
    primary: "open_interview",
    secondary: ["add_calendar"],
    showDeadlineStrip: false,
  },
  BOOKED_LIVE_NOW: {
    chipState: "BOOKED",
    title: (c) => `Your interview starts at ${c.interviewTimeHuman ?? "now"} IST`,
    body: (c) =>
      `Join now and settle in.${c.interviewerFirstName ? ` Your interviewer is ${c.interviewerFirstName}.` : ""}${c.bookingCode ? ` Your code is ${c.bookingCode}.` : ""} Keep your college ID ready.`,
    primary: "join",
    secondary: [],
    showDeadlineStrip: false,
  },
  AWAITING_RESULT: {
    chipState: "AWAITING_RESULT",
    title: () => "Interview done. Result on the way",
    body: (c) =>
      c.resultUnderReview
        ? "Your result is being reviewed before it's released. This can take a few working days, and it will show up right here."
        : c.resultAtHuman
          ? `Your interviewer has recorded your result. It comes out at ${c.resultAtHuman}. If you clear it, the badge is dated ${c.interviewDayHuman ?? "your interview day"}.`
          : `Your interview${c.interviewDateHuman ? ` on ${c.interviewDateHuman}` : ""} is done. Results usually arrive within 24 hours, right here. If you clear it, the badge is dated ${c.interviewDayHuman ?? "your interview day"}.`,
    secondary: [],
    showDeadlineStrip: true,
  },
  PASSED: {
    chipState: "PASSED",
    title: (c) => `You earned the ${c.badgeName.split("·")[1]?.trim() ?? c.badgeName} badge`,
    body: (c) =>
      c.interviewDateLongHuman
        ? `+${c.miles.toLocaleString("en-IN")} Miles · earned on ${c.interviewDateLongHuman}, your interview day.`
        : `+${c.miles.toLocaleString("en-IN")} Miles added to your total.`,
    primary: "see_rank",
    secondary: [],
    showDeadlineStrip: false,
  },
  FAILED: {
    chipState: "FAILED",
    title: (c) => (c.cooldownPastDeadline ? afterDeadlineText(c) : `Next attempt opens ${c.nextUnlockDateHuman ?? "soon"}`),
    body: (c) =>
      c.notClearedAfterReview
        ? `Your ${c.badgeName} interview didn't count after an identity review. ${c.attemptsLeft ?? 0} of ${c.maxAttempts ?? 0} attempts left.`
        : `Your ${c.badgeName} interview didn't clear the bar this time. Read the feedback, work on the focus areas, and try again. ${c.attemptsLeft ?? 0} of ${c.maxAttempts ?? 0} attempts left.`,
    primary: "see_feedback",
    secondary: ["calendar_reminder", "practise"],
    showDeadlineStrip: true,
  },
  RETAKE_LATER: {
    chipState: "RETAKE_LATER",
    title: (c) => (c.cooldownPastDeadline ? afterDeadlineText(c) : `Retake allowed from ${c.retakeDateHuman ?? "soon"}`),
    body: (c) =>
      `Your interviewer asked for a retake. It doesn't use an attempt, so you still have ${c.attemptsLeft ?? 0} of ${c.maxAttempts ?? 0} left.`,
    primary: "see_feedback",
    secondary: ["calendar_reminder"],
    showDeadlineStrip: true,
  },
  NO_SHOW: {
    chipState: "NO_SHOW",
    title: (c) =>
      c.cooldownPastDeadline ? afterDeadlineText(c) : `You can rebook from ${c.missedRebookDateHuman ?? "the unlock date"}`,
    body: (c) =>
      `You didn't join your interview${c.interviewDateHuman ? ` on ${c.interviewDateHuman}` : ""}${c.interviewTimeHuman ? ` at ${c.interviewTimeHuman} IST` : ""}. This used 1 of your ${c.maxAttempts ?? 0} attempts.`,
    primary: "calendar_reminder",
    secondary: ["see_result", "report_problem"],
    showDeadlineStrip: true,
  },
  ON_HOLD: {
    chipState: "ON_HOLD",
    title: () => "Booking is paused while we review",
    body: () => "The GRIT team is reviewing this journey under the interview rules. You can book again once the review is done.",
    primary: "read_rules",
    secondary: [],
    showDeadlineStrip: false,
  },
  CLOSED_ATTEMPT_LIMIT: {
    chipState: "CLOSED",
    title: () => "Attempt limit reached",
    body: (c) =>
      `You've used all ${c.maxAttempts ?? 0} attempts for ${c.badgeName}, so booking for this badge is closed. Contact Help if you have questions.`,
    primary: "see_last_feedback",
    secondary: ["contact_support"],
    showDeadlineStrip: false,
  },
  CLOSED_DEADLINE: {
    chipState: "CLOSED",
    title: () => "Booking closed",
    body: (c) =>
      `GRIT needed a Track Badge by ${c.deadlineFullHuman ?? "the season deadline"}, so interview booking is closed for this season.`,
    primary: "read_rules",
    secondary: [],
    showDeadlineStrip: false,
  },
  CLOSED_REVIEW: {
    chipState: "CLOSED",
    title: () => "Journey closed after review",
    body: () => "This journey was closed after a review under GRIT rules. Contact Help if you have questions.",
    primary: "contact_support",
    secondary: [],
    showDeadlineStrip: false,
  },
  NULLIFIED: {
    chipState: "NULLIFIED",
    title: () => "Badge nullified",
    body: (c) =>
      `After a review under GRIT T&C 7.4, your ${c.badgeName} badge has been nullified and its ${c.miles} Miles removed.`,
    primary: "contact_support",
    secondary: [],
    showDeadlineStrip: false,
  },
};

// ── non-journey status vocabularies (interviewer + admin screens) ───────────
/** Chip definition with a lucide component icon (rendered aria-hidden). */
export interface StatusDef {
  label: string;
  tone: ChipTone;
  icon: LucideIcon;
}

/** Interviewer schedule rows. */
export const SLOT_STATUS: Record<RowKind, StatusDef> = {
  live: { label: "Live now", tone: "live", icon: Radio },
  outcome_due: { label: "Ended · outcome due", tone: "action", icon: ClipboardPen },
  /** The row CTA carries "Edit until {time} IST" while the edit window is open. */
  submitted: { label: "Recorded", tone: "cobaltSoft", icon: PenLine },
  no_show: { label: "Student didn't join", tone: "muted", icon: UserX },
  booked: { label: "Booked", tone: "scheduled", icon: CalendarCheck },
  open: { label: "Open slot", tone: "open", icon: CircleDashed },
  blocked: { label: "Blocked", tone: "muted", icon: Ban },
  published: { label: "Published", tone: "muted", icon: CircleCheck },
  /** The journey is under an integrity review: no outcome can be recorded meanwhile. */
  on_hold: { label: "On hold", tone: "review", icon: ShieldAlert },
  /** Interviewer recorded "Couldn't happen" / "Couldn't finish fairly". The schedule adds the reason. */
  voided: { label: "Called off", tone: "muted", icon: CircleX },
};

/** Integrity case status (DB enum case_status). */
export type CaseStatus = "TRIAGE" | "OPEN" | "CONFIRMED" | "DISMISSED";
export const CASE_STATUS: Record<CaseStatus, StatusDef> = {
  TRIAGE: { label: "In triage", tone: "pending", icon: Search },
  OPEN: { label: "Under review", tone: "review", icon: ShieldAlert },
  CONFIRMED: { label: "Confirmed", tone: "muted", icon: CircleCheck },
  DISMISSED: { label: "Dismissed", tone: "muted", icon: CircleX },
};

/** Admin tracker: risk of missing the season deadline. */
export const RISK_STATUS: Record<DeadlineRisk, StatusDef> = {
  Critical: { label: "Critical", tone: "action", icon: AlertTriangle },
  High: { label: "High", tone: "pending", icon: Clock },
  Watch: { label: "Watch", tone: "cobaltSoft", icon: Eye },
  OK: { label: "OK", tone: "muted", icon: CircleCheck },
};

/** Approval request types. Every request is waiting on a second admin; the tone marks its domain. */
export type ApprovalGroup = "integrity" | "result" | "attempts" | "access" | "capacity";
export const APPROVAL_TYPE: Record<string, StatusDef & { group: ApprovalGroup }> = {
  NULLIFY: { label: "Co-sign · Nullify badge", tone: "review", icon: ShieldAlert, group: "integrity" },
  DISQUALIFY: { label: "Co-sign · Disqualify", tone: "review", icon: UserX, group: "integrity" },
  RESULT_AMENDMENT: { label: "Result change", tone: "cobaltSoft", icon: PenLine, group: "result" },
  REOPEN: { label: "Extra attempt · +1 (once per journey)", tone: "neutral", icon: RotateCcw, group: "attempts" },
  COOLDOWN_OVERRIDE: { label: "Cooldown override", tone: "neutral", icon: Timer, group: "attempts" },
  EMERGENCY_WAIVER: { label: "Emergency waiver", tone: "neutral", icon: LifeBuoy, group: "attempts" },
  SEASON_RULE: { label: "More interviewer hours", tone: "neutral", icon: CalendarClock, group: "capacity" },
  ROLE_GRANT: { label: "Role grant", tone: "neutral", icon: KeyRound, group: "access" },
  SECOND_REVIEW: { label: "Second review · Pass against suggestion", tone: "cobaltSoft", icon: PenLine, group: "result" },
  THIRD_RETAKE: { label: "3rd Retake later in a row", tone: "neutral", icon: RotateCcw, group: "attempts" },
};

/** Fallback for an unknown enum value: humanise it (RETAKE_LATER → "Retake later"). */
export function humanizeEnum(v: string): string {
  const s = v.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function caseStatusDef(status: string): StatusDef {
  return CASE_STATUS[status as CaseStatus] ?? { label: humanizeEnum(status), tone: "neutral", icon: Hourglass };
}

export function approvalTypeDef(action: string): StatusDef & { group: ApprovalGroup } {
  return APPROVAL_TYPE[action] ?? { label: humanizeEnum(action), tone: "neutral", icon: Hourglass, group: "attempts" };
}

// ── how each hero action renders ─────────────────────────────────────────────
export type ActionVariant = "saffron" | "go" | "goOutline" | "cobalt" | "link";

/**
 * Hero actions. These are presentation keys, not engine actions: each one is
 * gated on the server's allowed_actions (`requires`, any-of) and only renders
 * when a real target can be built (`href` returns null otherwise — never "#").
 */
export type HeroActionKey =
  | "book"
  | "rebook_now"
  | "view_my_interview"
  | "add_calendar"
  | "manage_booking"
  | "open_interview"
  | "join"
  | "see_rank"
  | "calendar_reminder"
  | "see_feedback"
  | "see_result"
  | "see_last_feedback"
  | "practise"
  | "how_to_clear"
  | "report_problem"
  | "read_rules"
  | "contact_support";

export interface ActionMeta {
  label: (c: JourneyCtx) => string;
  variant: ActionVariant;
  /** null = no honest target → don't render. */
  href?: (c: JourneyCtx) => string | null;
  /** Render as a plain file download (<a href download>) instead of a page link. */
  download?: boolean;
  /** Server allowed_actions that permit this (any-of). Omitted = gated by data only. */
  requires?: ActionKey[];
}

const interviewHref = (c: JourneyCtx) => (c.bookingId ? `/interview/${c.bookingId}` : null);
const resultHref = (c: JourneyCtx) => `/result/${c.journeyId}`;

export const ACTION_META: Record<HeroActionKey, ActionMeta> = {
  book: {
    label: (c) => (c.lastWasRetake ? "Book your retake" : "Book a time"),
    variant: "saffron",
    href: (c) => `/book/${c.journeyId}`,
    requires: ["book"],
  },
  rebook_now: { label: () => "Rebook now", variant: "saffron", href: (c) => `/book/${c.journeyId}`, requires: ["rebook_now"] },
  view_my_interview: {
    label: (c) => (c.otherBadgeName ? "View your booked interview" : "View my interview"),
    variant: "cobalt",
    href: (c) => (c.otherBookingId ? `/interview/${c.otherBookingId}` : null),
    requires: ["view_my_interview"],
  },
  add_calendar: {
    label: () => "Add to calendar",
    variant: "saffron",
    href: (c) => (c.bookingId ? `/api/v1/bookings/${c.bookingId}/calendar` : null),
    download: true,
    requires: ["add_calendar"],
  },
  manage_booking: { label: () => "Manage booking", variant: "link", href: interviewHref, requires: ["view_details", "reschedule", "cancel"] },
  open_interview: { label: () => "Open interview page", variant: "cobalt", href: interviewHref, requires: ["test_setup", "report_emergency"] },
  join: { label: () => "Go to your interview", variant: "go", href: interviewHref, requires: ["join"] },
  see_rank: { label: () => "See your rank", variant: "saffron", href: () => "/leaderboard", requires: ["see_rank"] },
  /** A real .ics for the day the next attempt opens (api/v1/journeys/[id]/calendar).
   *  Not offered when the date falls after the season deadline. */
  calendar_reminder: {
    label: (c) => (c.nextUnlockDateHuman ? `Remind me on ${c.nextUnlockDateHuman}` : "Add reminder to calendar"),
    variant: "cobalt",
    href: (c) => (c.hasCooldownDate && !c.cooldownPastDeadline ? `/api/v1/journeys/${c.journeyId}/calendar` : null),
    download: true,
    requires: ["calendar_reminder"],
  },
  see_feedback: { label: () => "Read your feedback", variant: "link", href: resultHref },
  see_result: { label: () => "See what happens next", variant: "link", href: resultHref },
  see_last_feedback: { label: () => "See your last feedback", variant: "cobalt", href: (c) => (c.hasPublishedOutcome ? resultHref(c) : null) },
  practise: { label: () => "Practise", variant: "link", href: () => "/practise", requires: ["practise"] },
  how_to_clear: { label: () => "How to clear skills", variant: "cobalt", href: () => "/contests", requires: ["view_contests"] },
  report_problem: { label: () => "Problem on our side? Report it", variant: "link", href: () => "/help", requires: ["report_problem"] },
  read_rules: { label: () => "Read GRIT rules", variant: "cobalt", href: () => "/rules", requires: ["read_rules"] },
  contact_support: { label: () => "Contact GRIT support", variant: "cobalt", href: () => "/help", requires: ["contact_support"] },
};

export interface ResolvedAction {
  key: HeroActionKey;
  label: string;
  variant: ActionVariant;
  href: string | null;
  download: boolean;
}

/** Resolve one hero action against what the server allows and what data exists. */
export function resolveAction(key: HeroActionKey, c: JourneyCtx, allowed: ActionKey[]): ResolvedAction | null {
  const m = ACTION_META[key];
  if (m.requires && !m.requires.some((a) => allowed.includes(a))) return null;
  const href = m.href ? m.href(c) : null;
  if (m.href && !href) return null;
  return { key, label: m.label(c), variant: m.variant, href, download: !!m.download };
}
