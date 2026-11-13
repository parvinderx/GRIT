-- Gap-close (phases 2-9): approvals that take effect, interviewer no-show handling,
-- outcome controls, integrity follow-through, scheduled jobs, smaller rules.

-- New approval kinds: Pass-against-suggestion second review, 3rd Retake in a row.
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'SECOND_REVIEW';
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'THIRD_RETAKE';

-- Outcome controls
ALTER TABLE interview_outcomes ADD COLUMN IF NOT EXISTS override_reason text;
ALTER TABLE interview_outcomes ADD COLUMN IF NOT EXISTS integrity_category text;
-- Dropped call: did the interviewer assess at least 15 minutes before it dropped?
ALTER TABLE interview_outcomes ADD COLUMN IF NOT EXISTS assessed_15 boolean;

-- Integrity
ALTER TABLE integrity_cases ADD COLUMN IF NOT EXISTS category text;
-- Triage SLA compares against the simulated clock.
ALTER TABLE integrity_cases ALTER COLUMN created_at SET DEFAULT app_now();

-- Smaller rules
ALTER TABLE interview_journeys ADD COLUMN IF NOT EXISTS drop_used boolean NOT NULL DEFAULT false;
ALTER TABLE interview_journeys ADD COLUMN IF NOT EXISTS retake_approval_pending boolean NOT NULL DEFAULT false;

-- Interviewer no-show
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS absent_reported_at timestamptz;

-- Notifications feed time-based jobs; stamp them with the simulated clock by default.
ALTER TABLE notifications ALTER COLUMN created_at SET DEFAULT app_now();

-- New journey edges (mirrors ENGINE_TRANSITIONS in src/lib/state-machine.ts)
INSERT INTO allowed_transitions (from_state, to_state) VALUES
  -- approved result amendments
  ('FAILED','PASSED'),
  ('RETAKE_LATER','PASSED'),
  ('ELIGIBLE','PASSED'),
  ('CLOSED','PASSED'),
  ('FAILED','RETAKE_LATER'),
  ('RETAKE_LATER','FAILED'),
  ('CLOSED','RETAKE_LATER'),
  -- season end (14 Feb) closes locked journeys too
  ('LOCKED','CLOSED')
ON CONFLICT (from_state, to_state) DO NOTHING;
