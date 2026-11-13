/**
 * Interviewer outcome vocabulary, shared by the form (client) and the server
 * (services/interviewerView.submitOutcome, the outcome route). No server imports here.
 */
export type WhatHappened = "COMPLETED" | "NO_JOIN" | "PLATFORM" | "UNFAIR" | "DROPPED";
export type OutcomeResult = "PASS" | "FAIL" | "RETAKE_LATER";

export const WHAT_HAPPENED: WhatHappened[] = ["COMPLETED", "DROPPED", "NO_JOIN", "PLATFORM", "UNFAIR"];
export const OUTCOME_RESULTS: OutcomeResult[] = ["PASS", "RETAKE_LATER", "FAIL"];

export const WHAT_HAPPENED_LABEL: Record<WhatHappened, string> = {
  COMPLETED: "Interview completed",
  NO_JOIN: "Student didn't join",
  PLATFORM: "Couldn't happen: my side or the platform",
  UNFAIR: "Started, but couldn't finish fairly",
  DROPPED: "The call dropped and couldn't resume",
};

/** What the student reads for a dropped call that became a free Retake later. */
export const DROPPED_FEEDBACK =
  "Your interview call dropped and couldn't be resumed. This doesn't count as an attempt: you can book again after a short wait.";

const VOIDED_CONSEQUENCE = "Not the student's fault: this attempt doesn't count and the student gets priority to rebook.";
const DROPPED_CONSEQUENCE =
  "Counts as a Retake later with no attempt used (the first dropped call, or one with under 15 minutes assessed). If you assessed 15 minutes or more after an earlier drop, record it as completed with a result instead.";

/**
 * One-line consequence shown when a non-completed option is picked, before it's
 * recorded (matches submitOutcome / jobs.recordNoShow). `attemptsLeft` is the
 * journey's max_attempts - attempt_count BEFORE this interview counts; the journey
 * closes when the no-show uses the last one (jobs.closeIfAttemptLimit).
 */
export function whatHappenedConsequence(
  v: Exclude<WhatHappened, "COMPLETED">,
  o: { attemptsLeft: number; noshowCooldownDays: number }
): string {
  if (v === "DROPPED") return DROPPED_CONSEQUENCE;
  if (v !== "NO_JOIN") return VOIDED_CONSEQUENCE;
  if (o.attemptsLeft <= 1) return "Counts as a missed interview. This was their last attempt, so booking for this badge closes.";
  return `Counts as a missed interview: it uses 1 of their attempts; they can book again after ${o.noshowCooldownDays} day${o.noshowCooldownDays === 1 ? "" : "s"}.`;
}

/** Past-tense consequence for the read-only view of an outcome already applied. */
export const RECORDED_CONSEQUENCE: Record<Exclude<WhatHappened, "COMPLETED">, string> = {
  NO_JOIN: "Counted as a missed interview: it used 1 of the student's attempts.",
  PLATFORM: "Not the student's fault: this attempt didn't count and the student got priority to rebook.",
  UNFAIR: "Not the student's fault: this attempt didn't count and the student got priority to rebook.",
  DROPPED: "Recorded as a free Retake later: no attempt used.",
};

/** Short reason for a voided booking (bookings.void_reason), for the schedule chip. */
export const VOID_REASON_LABEL: Record<string, string> = {
  PLATFORM: "my side or the platform",
  UNFAIR: "couldn't finish fairly",
};

export const RESULT_LABEL: Record<OutcomeResult, string> = { PASS: "Pass", RETAKE_LATER: "Retake later", FAIL: "Fail" };

/** Every rubric has the badge's skills plus this one (design doc I3). */
export const COMMUNICATION_SKILL = "Communication and reasoning";

/** Minimum length of the interview-team note for NO_JOIN / PLATFORM / UNFAIR. */
export const NOT_COMPLETED_NOTE_MIN = 20;

/**
 * Suggested result from the rubric (design doc I3), shared by the form and the server
 * (the server recomputes it and never trusts the client's value):
 * any 1 -> Fail; at least 60% of skills at 3+ -> Pass; otherwise Retake later.
 * Null until every skill is scored.
 */
export function suggestResult(skills: string[], scores: Record<string, number>): OutcomeResult | null {
  const vals = skills.map((s) => scores[s]).filter((v) => typeof v === "number" && v >= 1 && v <= 4);
  if (vals.length < skills.length || skills.length === 0) return null;
  if (vals.some((v) => v === 1)) return "FAIL";
  const meets = vals.filter((v) => v >= 3).length;
  if (meets >= Math.ceil(skills.length * 0.6)) return "PASS";
  return "RETAKE_LATER";
}

/** Internal justification needed when the chosen result differs from the suggestion. */
export const OVERRIDE_REASON_MIN = 20;

/** Integrity concern categories (spec section 5, I3). */
export const INTEGRITY_CATEGORIES = {
  IMPERSONATION: "Someone else took the interview",
  OUTSIDE_HELP: "Outside help during the interview",
  UNPERMITTED_MATERIAL: "Notes, other tabs or AI tools",
  OTHER: "Something else",
} as const;
export type IntegrityCategory = keyof typeof INTEGRITY_CATEGORIES;
