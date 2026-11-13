-- ---------------------------------------------------------------------------
-- 1. Record what an integrity decision actually was.
--    Before this, "Confirm · disqualify" and "Confirm · nullify" both just set
--    status = 'CONFIRMED', so a disqualification wasn't stored anywhere. The
--    confirm / dismiss routes now write decision + decision_note; the case page
--    reads them back. Older decided cases keep NULL (shown as "not recorded").
-- ---------------------------------------------------------------------------
ALTER TABLE integrity_cases
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS decision_note text;

ALTER TABLE integrity_cases
  ADD CONSTRAINT integrity_cases_decision_check
  CHECK (decision IS NULL OR decision IN ('dismiss','nullify','disqualify'));

-- ---------------------------------------------------------------------------
-- 2. Indexes for the admin overview / tracker / capacity queries.
--    Existing: uq_bookings_journey_live (journey_id) is partial (live statuses
--    only), idx_bookings_slot (slot_id), idx_bookings_interviewer_start;
--    uq_student_badge_active (student_id, badge_id) is partial (ACTIVE /
--    UNDER_REVIEW only); integrity_cases had no index on the subject.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bookings_journey_status_start ON bookings (journey_id, status, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_student_status ON bookings (student_id, status);
CREATE INDEX IF NOT EXISTS idx_integrity_cases_subject_status ON integrity_cases (subject_student_id, status);
CREATE INDEX IF NOT EXISTS idx_student_badges_student_badge ON student_badges (student_id, badge_id);
CREATE INDEX IF NOT EXISTS idx_journey_events_journey_to_state ON journey_events (journey_id, to_state, created_at);
