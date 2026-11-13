/**
 * Student hero presentation per view-state (copy lives in statusConfig VIEW).
 * One hero slot, same place on every state; only its contents change.
 *   status  the one line above the headline (where you are)
 *   aside   what sits beside the hero text: the journey route, the badge mark, or nothing
 */
import type { ViewState } from "@/lib/state-machine";
import type { JourneyCtx, ActionVariant } from "./statusConfig";
import type { StudentTone } from "@/components/student/ui/StatusLine";
import type { BtnKind } from "@/components/student/ui/Button";

export interface StudentStatus {
  text: string;
  tone: StudentTone;
  icon: string;
  pulse?: boolean;
}

export type HeroAside = "route" | "badge" | "none";

export const STUDENT_STATUS: Record<ViewState, (c: JourneyCtx) => StudentStatus> = {
  LOCKED: () => ({ text: "Interview locked", tone: "quiet", icon: "Lock" }),
  ELIGIBLE_READY: () => ({ text: "Ready to book", tone: "info", icon: "CalendarPlus" }),
  ELIGIBLE_OTHER_BOOKED: () => ({ text: "Ready, after your other interview", tone: "info", icon: "CalendarPlus" }),
  ELIGIBLE_AFTER_CANCEL: () => ({ text: "Priority rebooking", tone: "info", icon: "CalendarPlus" }),
  BOOKED_SCHEDULED: () => ({ text: "Interview booked", tone: "info", icon: "CalendarCheck" }),
  BOOKED_UNDER_12H: () => ({ text: "Interview booked, changes closed", tone: "info", icon: "CalendarCheck" }),
  BOOKED_LIVE_NOW: () => ({ text: "Live now", tone: "live", icon: "Radio", pulse: true }),
  AWAITING_RESULT: (c) => ({
    text: c.resultUnderReview ? "Result pending, under review" : c.resultAtHuman ? `Result at ${c.resultAtHuman}` : "Result pending",
    tone: "waiting",
    icon: "Hourglass",
  }),
  PASSED: () => ({ text: "Badge earned", tone: "done", icon: "Award" }),
  FAILED: (c) => ({
    text: c.nextUnlockDateHuman && !c.cooldownPastDeadline ? `Not cleared · reattempt from ${c.nextUnlockDateHuman}` : "Not cleared this time",
    tone: "quiet",
    icon: "Milestone",
  }),
  RETAKE_LATER: (c) => ({
    text: c.retakeDateHuman && !c.cooldownPastDeadline ? `Retake from ${c.retakeDateHuman} · doesn't use an attempt` : "Retake later",
    tone: "waiting",
    icon: "RotateCcw",
  }),
  NO_SHOW: () => ({ text: "Missed interview", tone: "quiet", icon: "CalendarX" }),
  ON_HOLD: () => ({ text: "Under review", tone: "quiet", icon: "ShieldAlert" }),
  CLOSED_ATTEMPT_LIMIT: () => ({ text: "Booking closed", tone: "quiet", icon: "Lock" }),
  CLOSED_DEADLINE: () => ({ text: "Booking closed", tone: "quiet", icon: "Lock" }),
  CLOSED_REVIEW: () => ({ text: "Closed after review", tone: "quiet", icon: "Lock" }),
  NULLIFIED: () => ({ text: "Badge nullified", tone: "quiet", icon: "Ban" }),
};

export const HERO_ASIDE: Record<ViewState, HeroAside> = {
  LOCKED: "route",
  ELIGIBLE_READY: "route",
  ELIGIBLE_OTHER_BOOKED: "route",
  ELIGIBLE_AFTER_CANCEL: "route",
  BOOKED_SCHEDULED: "route",
  BOOKED_UNDER_12H: "route",
  BOOKED_LIVE_NOW: "route",
  AWAITING_RESULT: "route",
  PASSED: "badge",
  FAILED: "route",
  RETAKE_LATER: "route",
  NO_SHOW: "route",
  ON_HOLD: "none",
  CLOSED_ATTEMPT_LIMIT: "none",
  CLOSED_DEADLINE: "none",
  CLOSED_REVIEW: "none",
  NULLIFIED: "none",
};

/** How a hero action renders. Only saffron (the book/next-step actions) gets the highlighter. */
export function heroKind(variant: ActionVariant): BtnKind {
  if (variant === "saffron") return "next";
  if (variant === "go" || variant === "goOutline") return "live";
  return "outline";
}
