-- When a case put the student on hold (for the "hold crossed the deadline" protection).
ALTER TABLE integrity_cases ADD COLUMN IF NOT EXISTS held_at timestamptz;
