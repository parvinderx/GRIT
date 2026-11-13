-- GRIT — simulated clock function, state-transition backstop, append-only audit.

-- ---------------------------------------------------------------------------
-- app_now(): the one clock business logic reads. STABLE (not IMMUTABLE), so it
-- can be used in query WHERE clauses but never in index predicates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_now() RETURNS timestamptz AS $$
  SELECT CASE
    WHEN mode = 'SIM' THEN sim_now
    ELSE now() + make_interval(secs => real_offset_seconds)
  END
  FROM sim_clock WHERE id = true;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Allowed transitions (Section 1). The app command handler enforces these
-- first; this table + trigger are the database backstop.
-- ---------------------------------------------------------------------------
CREATE TABLE allowed_transitions (
  from_state journey_state NOT NULL,
  to_state   journey_state NOT NULL,
  PRIMARY KEY (from_state, to_state)
);

INSERT INTO allowed_transitions (from_state, to_state) VALUES
  ('LOCKED','ELIGIBLE'),
  ('ELIGIBLE','BOOKED'),
  ('ELIGIBLE','LOCKED'),
  ('ELIGIBLE','CLOSED'),
  ('BOOKED','AWAITING_RESULT'),
  ('BOOKED','NO_SHOW'),
  ('BOOKED','ELIGIBLE'),
  ('AWAITING_RESULT','PASSED'),
  ('AWAITING_RESULT','FAILED'),
  ('AWAITING_RESULT','RETAKE_LATER'),
  ('PASSED','ON_HOLD'),
  ('FAILED','ELIGIBLE'),
  ('FAILED','CLOSED'),
  ('RETAKE_LATER','ELIGIBLE'),
  ('NO_SHOW','ELIGIBLE'),
  ('NO_SHOW','CLOSED'),
  -- integrity hold can dismiss back to any prior state
  ('ON_HOLD','LOCKED'),
  ('ON_HOLD','ELIGIBLE'),
  ('ON_HOLD','BOOKED'),
  ('ON_HOLD','AWAITING_RESULT'),
  ('ON_HOLD','PASSED'),
  ('ON_HOLD','FAILED'),
  ('ON_HOLD','RETAKE_LATER'),
  ('ON_HOLD','NO_SHOW'),
  ('ON_HOLD','NULLIFIED'),
  ('ON_HOLD','CLOSED'),
  ('NULLIFIED','LOCKED'),
  ('CLOSED','ELIGIBLE'),
  -- a confirmed integrity flag can move ANY state to ON_HOLD
  ('LOCKED','ON_HOLD'),
  ('ELIGIBLE','ON_HOLD'),
  ('BOOKED','ON_HOLD'),
  ('AWAITING_RESULT','ON_HOLD'),
  ('FAILED','ON_HOLD'),
  ('RETAKE_LATER','ON_HOLD'),
  ('NO_SHOW','ON_HOLD'),
  ('CLOSED','ON_HOLD'),
  ('NULLIFIED','ON_HOLD');

-- ---------------------------------------------------------------------------
-- Enforce: every journey UPDATE must bump version by exactly 1, and any state
-- change must be a listed transition. Errors use ERRCODE so the app maps them
-- to the right HTTP status (409).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_journey_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: journey % expected version % got %',
      OLD.id, OLD.version + 1, NEW.version
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT EXISTS (
      SELECT 1 FROM allowed_transitions
      WHERE from_state = OLD.state AND to_state = NEW.state
    ) THEN
      RAISE EXCEPTION 'ILLEGAL_TRANSITION: % -> %', OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.updated_at := app_now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_journey_transition
  BEFORE UPDATE ON interview_journeys
  FOR EACH ROW EXECUTE FUNCTION enforce_journey_transition();

-- ---------------------------------------------------------------------------
-- Append-only audit: block UPDATE/DELETE on journey_events (fires even for the
-- app role, standing in for the production REVOKE + WORM anchoring).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % not allowed on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journey_events_append_only
  BEFORE UPDATE OR DELETE ON journey_events
  FOR EACH ROW EXECUTE FUNCTION block_mutation();
