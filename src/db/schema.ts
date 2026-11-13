/**
 * Drizzle schema for TYPED QUERIES. The authoritative DDL lives in
 * drizzle/migrations/*.sql (it needs EXCLUDE constraints, partial indexes and
 * PL/pgSQL that the ORM can't express). Keep this file in sync with that SQL.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  time,
  date,
  bigserial,
  numeric,
  primaryKey,
} from "drizzle-orm/pg-core";

// ── enums ──────────────────────────────────────────────────────────────────
export const userRole = pgEnum("user_role", [
  "STUDENT",
  "INTERVIEWER",
  "INTERVIEW_ADMIN",
  "PROGRAM_ADMIN",
]);
export const programmeStatus = pgEnum("programme_status", ["ACTIVE", "AT_RISK", "DISQUALIFIED"]);
export const journeyState = pgEnum("journey_state", [
  "LOCKED",
  "ELIGIBLE",
  "BOOKED",
  "AWAITING_RESULT",
  "PASSED",
  "FAILED",
  "RETAKE_LATER",
  "NO_SHOW",
  "ON_HOLD",
  "NULLIFIED",
  "CLOSED",
]);
export const slotStatus = pgEnum("slot_status", ["OPEN", "BOOKED", "BLOCKED", "CANCELLED"]);
export const slotAudience = pgEnum("slot_audience", ["ANY", "DEADLINE", "PRIORITY"]);
export const bookingStatus = pgEnum("booking_status", [
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
  "CANCELLED_LATE",
  "VOID",
]);
export const outcomeResult = pgEnum("outcome_result", ["PASS", "FAIL", "RETAKE_LATER"]);
export const outcomeReviewStatus = pgEnum("outcome_review_status", [
  "NONE",
  "PENDING_SECOND_REVIEW",
  "RELEASED",
  "WITHHELD",
]);
export const badgeStatus = pgEnum("badge_status", ["ACTIVE", "UNDER_REVIEW", "NULLIFIED"]);
export const caseStatus = pgEnum("case_status", ["TRIAGE", "OPEN", "DISMISSED", "CONFIRMED"]);
export const caseSubjectType = pgEnum("case_subject_type", ["STUDENT", "INTERVIEWER"]);
export const approvalAction = pgEnum("approval_action", [
  "NULLIFY",
  "DISQUALIFY",
  "RESULT_AMENDMENT",
  "REOPEN",
  "COOLDOWN_OVERRIDE",
  "EMERGENCY_WAIVER",
  "SEASON_RULE",
  "ROLE_GRANT",
  "SECOND_REVIEW",
  "THIRD_RETAKE",
]);
export const approvalStatus = pgEnum("approval_status", ["PENDING", "APPROVED", "REJECTED"]);
export const notificationChannel = pgEnum("notification_channel", [
  "EMAIL",
  "WHATSAPP",
  "SMS",
  "PUSH",
  "IN_APP",
]);
export const clockMode = pgEnum("clock_mode", ["REAL", "SIM"]);
export const overrideKind = pgEnum("override_kind", ["ADD", "REMOVE"]);

const tz = { withTimezone: true } as const;

// ── tables ─────────────────────────────────────────────────────────────────
export const simClock = pgTable("sim_clock", {
  id: boolean("id").primaryKey().default(true),
  mode: clockMode("mode").notNull().default("SIM"),
  simNow: timestamp("sim_now", tz).notNull(),
  realOffsetSeconds: integer("real_offset_seconds").notNull().default(0),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  deadlineAt: timestamp("deadline_at", tz).notNull(),
  lastInterviewAt: timestamp("last_interview_at", tz).notNull(),
  seasonEndAt: timestamp("season_end_at", tz).notNull(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const seasonRules = pgTable("season_rules", {
  seasonId: uuid("season_id").primaryKey().references(() => seasons.id, { onDelete: "cascade" }),
  failCooldownDays: integer("fail_cooldown_days").notNull().default(14),
  noshowCooldownDays: integer("noshow_cooldown_days").notNull().default(7),
  retakeCooldownDays: integer("retake_cooldown_days").notNull().default(3),
  maxAttempts: integer("max_attempts").notNull().default(3),
  changeCutoffHours: integer("change_cutoff_hours").notNull().default(12),
  bookingCutoffHours: integer("booking_cutoff_hours").notNull().default(3),
  priorityBookingCutoffHours: integer("priority_booking_cutoff_hours").notNull().default(2),
  emergencyCutoffHours: integer("emergency_cutoff_hours").notNull().default(12),
  joinOpenMinutes: integer("join_open_minutes").notNull().default(10),
  joinGraceMinutes: integer("join_grace_minutes").notNull().default(10),
  interviewerAbsentMinutes: integer("interviewer_absent_minutes").notNull().default(5),
  attendanceCheckMinutes: integer("attendance_check_minutes").notNull().default(15),
  publishDelayMinutes: integer("publish_delay_minutes").notNull().default(15),
  slotGridMinutes: integer("slot_grid_minutes").notNull().default(40),
  slotDurationMinutes: integer("slot_duration_minutes").notNull().default(30),
  dayReleaseHourIst: integer("day_release_hour_ist").notNull().default(20),
  poolReleaseHours: integer("pool_release_hours").notNull().default(24),
  gridStartLocal: time("grid_start_local").notNull().default("09:00"),
  gridEndLocal: time("grid_end_local").notNull().default("21:00"),
  horizonDays: integer("horizon_days").notNull().default(14),
  decDeadlineReserve: numeric("dec_deadline_reserve").notNull().default("0.70"),
  decPriorityReserve: numeric("dec_priority_reserve").notNull().default("0.20"),
  rateBookingsPerMin: integer("rate_bookings_per_min").notNull().default(5),
  rateBookingsPerDay: integer("rate_bookings_per_day").notNull().default(20),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  ssoSubject: text("sso_subject").notNull().unique(),
  email: text("email"),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: userRole("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })]
);

export const students = pgTable("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  gritId: text("grit_id").notNull().unique(),
  batch: text("batch"),
  section: text("section"),
  campus: text("campus"),
  programmeStatus: programmeStatus("programme_status").notNull().default("ACTIVE"),
  photoKey: text("photo_key"),
  baseMiles: integer("base_miles").notNull().default(0),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

export const tracks = pgTable("tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const badges = pgTable("badges", {
  id: uuid("id").primaryKey().defaultRandom(),
  trackId: uuid("track_id").notNull().references(() => tracks.id, { onDelete: "cascade" }),
  level: integer("level").notNull(),
  name: text("name").notNull(),
  miles: integer("miles").notNull(),
  prerequisiteBadgeId: uuid("prerequisite_badge_id"),
  requiresProject: boolean("requires_project").notNull().default(false),
});

export const badgeSkillRequirements = pgTable("badge_skill_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  badgeId: uuid("badge_id").notNull().references(() => badges.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  minLevel: integer("min_level").notNull(),
  version: integer("version").notNull().default(1),
});

export const studentSkillLevels = pgTable(
  "student_skill_levels",
  {
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id").notNull().references(() => skills.id),
    level: integer("level").notNull().default(0),
    sourceSeq: integer("source_seq").notNull().default(0),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.skillId] })]
);

export const interviewers = pgTable("interviewers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  maxPerDay: integer("max_per_day").notNull().default(8),
  lastAssignedAt: timestamp("last_assigned_at", tz),
  active: boolean("active").notNull().default(true),
  calibrated: boolean("calibrated").notNull().default(true),
  photoKey: text("photo_key"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const interviewerTracks = pgTable(
  "interviewer_tracks",
  {
    interviewerId: uuid("interviewer_id").notNull().references(() => interviewers.id, { onDelete: "cascade" }),
    trackId: uuid("track_id").notNull().references(() => tracks.id, { onDelete: "cascade" }),
    maxBadgeLevel: integer("max_badge_level").notNull().default(2),
  },
  (t) => [primaryKey({ columns: [t.interviewerId, t.trackId] })]
);

export const interviewerConflicts = pgTable("interviewer_conflicts", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewerId: uuid("interviewer_id").notNull().references(() => interviewers.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  reason: text("reason"),
});

export const availabilityRules = pgTable("availability_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewerId: uuid("interviewer_id").notNull().references(() => interviewers.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startLocal: time("start_local").notNull(),
  endLocal: time("end_local").notNull(),
  tz: text("tz").notNull().default("Asia/Kolkata"),
  active: boolean("active").notNull().default(true),
});

export const availabilityOverrides = pgTable("availability_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewerId: uuid("interviewer_id").notNull().references(() => interviewers.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  kind: overrideKind("kind").notNull(),
  startLocal: time("start_local"),
  endLocal: time("end_local"),
});

export const interviewSlots = pgTable("interview_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewerId: uuid("interviewer_id").notNull().references(() => interviewers.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at", tz).notNull(),
  bufferEndAt: timestamp("buffer_end_at", tz).notNull(),
  status: slotStatus("status").notNull().default("OPEN"),
  audience: slotAudience("audience").notNull().default("ANY"),
  bookableFrom: timestamp("bookable_from", tz).notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const interviewJourneys = pgTable("interview_journeys", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  badgeId: uuid("badge_id").notNull().references(() => badges.id),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  state: journeyState("state").notNull().default("LOCKED"),
  stateReason: text("state_reason"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  consecutiveRetakeLater: integer("consecutive_retake_later").notNull().default(0),
  changesCount: integer("changes_count").notNull().default(0),
  cooldownUntil: timestamp("cooldown_until", tz),
  priorityRebook: boolean("priority_rebook").notNull().default(false),
  holdPrevState: journeyState("hold_prev_state"),
  /** The integrity case that put this journey on hold (migration 0012). */
  holdCaseId: uuid("hold_case_id"),
  deadlineProtectedUntil: timestamp("deadline_protected_until", tz),
  /** The one free "dropped call" Retake per journey has been used (migration 0009). */
  dropUsed: boolean("drop_used").notNull().default(false),
  /** A 3rd Retake in a row is waiting for admin approval (migration 0009). */
  retakeApprovalPending: boolean("retake_approval_pending").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  journeyId: uuid("journey_id").notNull().references(() => interviewJourneys.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  slotId: uuid("slot_id").notNull().references(() => interviewSlots.id),
  interviewerId: uuid("interviewer_id").notNull().references(() => interviewers.id),
  startAt: timestamp("start_at", tz).notNull(),
  status: bookingStatus("status").notNull().default("CONFIRMED"),
  voidReason: text("void_reason"),
  bookingCode: text("booking_code").notNull(),
  studentJoinedAt: timestamp("student_joined_at", tz),
  /** Verified at join: the account that owns the booking joined (migration 0007; no typing since 2026-11-13). */
  codeVerifiedAt: timestamp("code_verified_at", tz),
  codeAttempts: integer("code_attempts").notNull().default(0),
  interviewerJoinedAt: timestamp("interviewer_joined_at", tz),
  /** Student reported the interviewer hadn't joined (migration 0009). */
  absentReportedAt: timestamp("absent_reported_at", tz),
  reviewRequired: boolean("review_required").notNull().default(false),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

export const interviewOutcomes = pgTable("interview_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().unique().references(() => bookings.id, { onDelete: "cascade" }),
  whatHappened: text("what_happened").notNull().default("COMPLETED"),
  result: outcomeResult("result"),
  suggestedResult: outcomeResult("suggested_result"),
  rubric: jsonb("rubric").notNull().default([]),
  feedbackToStudent: text("feedback_to_student"),
  focusAreas: jsonb("focus_areas").notNull().default([]),
  internalNotesEncrypted: text("internal_notes_encrypted"),
  integrityFlag: boolean("integrity_flag").notNull().default(false),
  recordedBy: uuid("recorded_by").references(() => users.id),
  submittedAt: timestamp("submitted_at", tz),
  publishAt: timestamp("publish_at", tz),
  lockedAt: timestamp("locked_at", tz),
  reviewStatus: outcomeReviewStatus("review_status").notNull().default("NONE"),
  /** Interviewer's face check (migration 0007). false holds the result for review. */
  faceMatched: boolean("face_matched"),
  integrityReason: text("integrity_reason"),
  /** Why the chosen result differs from the suggestion (migration 0009). */
  overrideReason: text("override_reason"),
  integrityCategory: text("integrity_category"),
  /** DROPPED call: at least 15 minutes were assessed (migration 0009). */
  assessed15: boolean("assessed_15"),
  amendedFrom: uuid("amended_from"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const studentBadges = pgTable("student_badges", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  badgeId: uuid("badge_id").notNull().references(() => badges.id),
  outcomeId: uuid("outcome_id").references(() => interviewOutcomes.id),
  awardedAt: timestamp("awarded_at", tz).notNull(),
  status: badgeStatus("status").notNull().default("ACTIVE"),
  miles: integer("miles").notNull(),
  caseId: uuid("case_id"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const idempotencyKeys = pgTable("idempotency_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  idemKey: text("idem_key").notNull(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  status: text("status").notNull().default("in_progress"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

/** Booking/reschedule attempts for rate limiting (migration 0008). */
export const bookingAttempts = pgTable("booking_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("book"),
  at: timestamp("at", tz).notNull(),
});

export const journeyEvents = pgTable("journey_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  journeyId: uuid("journey_id").notNull().references(() => interviewJourneys.id, { onDelete: "cascade" }),
  fromState: journeyState("from_state"),
  toState: journeyState("to_state"),
  action: text("action").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  reason: text("reason"),
  payload: jsonb("payload").notNull().default({}),
  prevHash: text("prev_hash"),
  hash: text("hash"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const integrityCases = pgTable("integrity_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  subjectType: caseSubjectType("subject_type").notNull(),
  subjectStudentId: uuid("subject_student_id").references(() => students.id),
  subjectInterviewerId: uuid("subject_interviewer_id").references(() => interviewers.id),
  status: caseStatus("status").notNull().default("TRIAGE"),
  openedBy: uuid("opened_by").references(() => users.id),
  decidedBy: uuid("decided_by").references(() => users.id),
  cosignedBy: uuid("cosigned_by").references(() => users.id),
  reason: text("reason"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", tz),
  /** 'dismiss' | 'nullify' | 'disqualify' (migration 0006). */
  decision: text("decision"),
  decisionNote: text("decision_note"),
  /** The interview whose result is held for this case (migration 0007). */
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  category: text("category"),
  /** When the case put the student on hold (migration 0011). */
  heldAt: timestamp("held_at", tz),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: approvalAction("action").notNull(),
  status: approvalStatus("status").notNull().default("PENDING"),
  requestedBy: uuid("requested_by").references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  interviewerId: uuid("interviewer_id").references(() => interviewers.id),
  journeyId: uuid("journey_id").references(() => interviewJourneys.id),
  payload: jsonb("payload").notNull().default({}),
  reason: text("reason"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", tz),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  studentId: uuid("student_id").references(() => students.id),
  channel: notificationChannel("channel").notNull(),
  template: text("template").notNull(),
  payload: jsonb("payload").notNull().default({}),
  neutralText: text("neutral_text"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});
