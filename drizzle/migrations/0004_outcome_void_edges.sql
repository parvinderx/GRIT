-- ---------------------------------------------------------------------------
-- Interviewer outcome "Couldn't happen: my side or the platform" (PLATFORM) and
-- "Started, but couldn't finish fairly" (UNFAIR) void the attempt: booking VOID,
-- journey back to ELIGIBLE with priority_rebook, no attempt counted.
-- From BOOKED this uses the existing BOOKED->ELIGIBLE edge (interviewer_fault).
-- Once the T+15 attendance check has moved the journey to AWAITING_RESULT, the
-- same action needs AWAITING_RESULT->ELIGIBLE. ENGINE_TRANSITIONS
-- (src/lib/state-machine.ts) has the matching edge; mirror it here for the
-- trigger backstop. ON CONFLICT keeps this idempotent.
-- ---------------------------------------------------------------------------
INSERT INTO allowed_transitions (from_state, to_state) VALUES
  ('AWAITING_RESULT','ELIGIBLE')
ON CONFLICT (from_state, to_state) DO NOTHING;
