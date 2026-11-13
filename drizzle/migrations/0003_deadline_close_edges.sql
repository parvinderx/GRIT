-- ---------------------------------------------------------------------------
-- Deadline sweep: after the season deadline, journeys still cooling down
-- (FAILED / RETAKE_LATER / NO_SHOW) for students with no badge are closed.
-- ENGINE_TRANSITIONS (src/lib/state-machine.ts) now has deadline_close edges
-- from these states; mirror them in the trigger's allowed_transitions table.
-- FAILED->CLOSED and NO_SHOW->CLOSED already exist (attempt limit); only
-- RETAKE_LATER->CLOSED is new. ON CONFLICT keeps this idempotent.
-- ---------------------------------------------------------------------------
INSERT INTO allowed_transitions (from_state, to_state) VALUES
  ('FAILED','CLOSED'),
  ('RETAKE_LATER','CLOSED'),
  ('NO_SHOW','CLOSED')
ON CONFLICT (from_state, to_state) DO NOTHING;
