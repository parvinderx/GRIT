import type { JourneyCtx } from "./statusConfig";
import type { JourneyState } from "@/lib/state-machine";

export type RouteStatus = "done" | "current" | "future" | "past";

export interface RouteStop {
  label: string;
  /** A date, count or short fact for this stop. Omitted when there's nothing true to say. */
  sub?: string;
  status: RouteStatus;
}

interface RouteInput {
  state: JourneyState;
  ctx: JourneyCtx;
  skillsCleared: number;
  skillsTotal: number;
}

/**
 * The journey as a route with "you are here".
 *   Normal: Skills → Book → Interview → Result → Badge
 *   After an interview that didn't clear: Interview → Result → Next attempt → Deadline
 */
export function buildRoute({ state, ctx: c, skillsCleared, skillsTotal }: RouteInput): RouteStop[] {
  const when = [c.interviewDateHuman, c.interviewTimeHuman ? `${c.interviewTimeHuman} IST` : null].filter(Boolean).join(", ");

  if (state === "FAILED" || state === "RETAKE_LATER" || state === "NO_SHOW") {
    const next =
      state === "FAILED" ? c.nextUnlockDateHuman : state === "RETAKE_LATER" ? c.retakeDateHuman : c.missedRebookDateHuman;
    const result = state === "FAILED" ? "Not cleared" : state === "RETAKE_LATER" ? "Retake asked" : "Missed";
    return [
      { label: "Interview", sub: c.interviewDateHuman ?? c.lastInterviewDateHuman, status: "done" },
      { label: "Result", sub: result, status: "past" },
      {
        label: state === "RETAKE_LATER" ? "Retake opens" : state === "NO_SHOW" ? "Rebooking opens" : "Next attempt opens",
        sub: c.cooldownPastDeadline ? `After ${c.deadlineHuman ?? "the deadline"}` : next,
        status: "current",
      },
      { label: "Badge deadline", sub: c.deadlineHuman, status: "future" },
    ];
  }

  const booked = state === "BOOKED" || state === "AWAITING_RESULT" || state === "PASSED";
  const interviewed = state === "AWAITING_RESULT" || state === "PASSED";
  const passed = state === "PASSED";
  const s = (done: boolean, current: boolean): RouteStatus => (done ? "done" : current ? "current" : "future");

  return [
    {
      label: "Skills",
      sub: state === "LOCKED" ? `${skillsCleared} of ${skillsTotal} cleared` : "All cleared",
      status: s(state !== "LOCKED", state === "LOCKED"),
    },
    {
      label: "Book a time",
      sub: booked ? "Booked" : state === "ELIGIBLE" && c.deadlineHuman ? `Before ${c.deadlineHuman}` : undefined,
      status: s(booked, state === "ELIGIBLE"),
    },
    { label: "Interview", sub: booked && when ? when : "30 min, live video", status: s(interviewed, state === "BOOKED") },
    { label: "Result", sub: state === "AWAITING_RESULT" ? "Usually within 24 h" : undefined, status: s(passed, state === "AWAITING_RESULT") },
    { label: "Badge", sub: `+${c.miles} Miles`, status: passed ? "done" : "future" },
  ];
}
