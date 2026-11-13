-- Which integrity case put a journey on hold, so deciding one case never touches another's holds.
ALTER TABLE interview_journeys ADD COLUMN IF NOT EXISTS hold_case_id uuid REFERENCES integrity_cases(id) ON DELETE SET NULL;
