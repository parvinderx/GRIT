/** What approving does, in plain words, for the approvals page. */
export const APPROVAL_EFFECT: Record<string, string> = {
  EMERGENCY_WAIVER:
    "Voids the interview with no attempt used. If it was already marked missed, the missed interview is removed and the student can book again.",
  COOLDOWN_OVERRIDE: "Ends the student's wait now so they can book straight away.",
  REOPEN: "Gives the student one more attempt and reopens booking if it was closed.",
  RESULT_AMENDMENT: "Changes the published result. A change to Pass awards the badge and its Miles.",
  SECOND_REVIEW: "Publishes the interviewer's Pass. Declining publishes the suggested result instead.",
  THIRD_RETAKE: "Allows a 3rd Retake later in a row. Declining turns it into a Fail (1 attempt, 14-day wait).",
  SEASON_RULE: "Records the sign-off. Capacity changes are made separately.",
};
