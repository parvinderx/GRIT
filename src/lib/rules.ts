/**
 * Student-facing interview rules: the single source of copy for every screen.
 *
 * Numeric constants MIRROR the season_rules defaults in src/db/schema.ts (and the
 * hard-coded free-change limit in services/booking.ts). Server code should keep
 * reading the DB; these exist for client components and static copy. If an admin
 * changes season_rules, update these too.
 */
export const FAIL_COOLDOWN_DAYS = 14;
export const NOSHOW_COOLDOWN_DAYS = 7;
export const RETAKE_COOLDOWN_DAYS = 3;
export const MAX_ATTEMPTS = 3;
export const FREE_CHANGES = 2;
export const CHANGE_CUTOFF_HOURS = 12;
export const BOOKING_CUTOFF_HOURS = 3;
export const EMERGENCY_CUTOFF_HOURS = 12;
export const JOIN_OPEN_MINUTES = 10;
export const JOIN_GRACE_MINUTES = 10;
export const PUBLISH_DELAY_MINUTES = 15;
export const HORIZON_DAYS = 14;

export type RuleId =
  | "interviewer"
  | "bookingCloses"
  | "changes"
  | "emergency"
  | "joinWindow"
  | "missed"
  | "attempts"
  | "resultTiming"
  | "cooldowns";

/** One plain sentence per rule. */
export const RULES: Record<RuleId, string> = {
  interviewer: "Pick any open time in the next 14 days and we assign a qualified GRIT interviewer.",
  bookingCloses: `You can book until ${BOOKING_CUTOFF_HOURS} hours before the start time.`,
  changes: `Each booking comes with ${FREE_CHANGES} free changes (a reschedule or a cancel), up to ${CHANGE_CUTOFF_HOURS} hours before the start.`,
  emergency: `Inside ${EMERGENCY_CUTOFF_HOURS} hours, changes are closed; for a genuine emergency, use "Report an emergency" on your interview page.`,
  joinWindow: `Join opens ${JOIN_OPEN_MINUTES} minutes before the start and stays open for ${JOIN_GRACE_MINUTES} minutes after it.`,
  missed: `If you haven't joined in time, it counts as 1 of your ${MAX_ATTEMPTS} attempts.`,
  attempts: `Each badge allows up to ${MAX_ATTEMPTS} attempts; cancelled interviews don't count. After the last one, booking for that badge closes.`,
  resultTiming: "Results usually arrive within 24 hours of your interview.",
  cooldowns: `Counted from your interview date: wait ${RETAKE_COOLDOWN_DAYS} days after a retake, ${NOSHOW_COOLDOWN_DAYS} days after a missed interview, ${FAIL_COOLDOWN_DAYS} days if you don't clear it.`,
};

export const RULE_GROUPS: { title: string; ids: RuleId[] }[] = [
  { title: "Booking", ids: ["interviewer", "bookingCloses", "changes", "emergency"] },
  { title: "On the day", ids: ["joinWindow", "missed"] },
  { title: "Results & retakes", ids: ["resultTiming", "attempts", "cooldowns"] },
];
