-- ---------------------------------------------------------------------------
-- Identity checks that are real and traceable.
--
-- 1. Booking code at join: the student types it; a match is recorded, wrong
--    tries are counted. The interviewer no longer ticks "code matches".
-- 2. Face check is stored on the outcome. "Doesn't match" (or the integrity
--    checkbox) holds the result (review_status WITHHELD) and opens a case that
--    points at the held interview.
-- ---------------------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS code_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS code_attempts int NOT NULL DEFAULT 0;

ALTER TABLE interview_outcomes
  ADD COLUMN IF NOT EXISTS face_matched boolean,
  ADD COLUMN IF NOT EXISTS integrity_reason text;

ALTER TABLE integrity_cases
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_integrity_cases_booking ON integrity_cases (booking_id);
