-- GRIT Interview Scheduling — schema (Section 3 of the design doc)
-- Times stored in UTC (timestamptz), shown in IST. The DB is the final judge.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('STUDENT','INTERVIEWER','INTERVIEW_ADMIN','PROGRAM_ADMIN');
CREATE TYPE programme_status AS ENUM ('ACTIVE','AT_RISK','DISQUALIFIED');
CREATE TYPE journey_state AS ENUM (
  'LOCKED','ELIGIBLE','BOOKED','AWAITING_RESULT','PASSED','FAILED',
  'RETAKE_LATER','NO_SHOW','ON_HOLD','NULLIFIED','CLOSED'
);
CREATE TYPE slot_status AS ENUM ('OPEN','BOOKED','BLOCKED','CANCELLED');
CREATE TYPE slot_audience AS ENUM ('ANY','DEADLINE','PRIORITY');
CREATE TYPE booking_status AS ENUM (
  'CONFIRMED','IN_PROGRESS','COMPLETED','NO_SHOW','CANCELLED','CANCELLED_LATE','VOID'
);
CREATE TYPE outcome_result AS ENUM ('PASS','FAIL','RETAKE_LATER');
CREATE TYPE outcome_review_status AS ENUM ('NONE','PENDING_SECOND_REVIEW','RELEASED','WITHHELD');
CREATE TYPE badge_status AS ENUM ('ACTIVE','UNDER_REVIEW','NULLIFIED');
CREATE TYPE case_status AS ENUM ('TRIAGE','OPEN','DISMISSED','CONFIRMED');
CREATE TYPE case_subject_type AS ENUM ('STUDENT','INTERVIEWER');
CREATE TYPE approval_action AS ENUM (
  'NULLIFY','DISQUALIFY','RESULT_AMENDMENT','REOPEN','COOLDOWN_OVERRIDE',
  'EMERGENCY_WAIVER','SEASON_RULE','ROLE_GRANT'
);
CREATE TYPE approval_status AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TYPE notification_channel AS ENUM ('EMAIL','WHATSAPP','SMS','PUSH','IN_APP');
CREATE TYPE clock_mode AS ENUM ('REAL','SIM');
CREATE TYPE override_kind AS ENUM ('ADD','REMOVE');

-- ---------------------------------------------------------------------------
-- Simulated clock (single row). Business logic reads app_now(), never now().
-- ---------------------------------------------------------------------------
CREATE TABLE sim_clock (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode                clock_mode NOT NULL DEFAULT 'SIM',
  sim_now             timestamptz NOT NULL,
  real_offset_seconds bigint NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Anchor so the doc's sample copy lines up (23 Nov 2026, 12:00 IST).
INSERT INTO sim_clock (id, mode, sim_now) VALUES (true, 'SIM', '2026-11-23 12:00:00+05:30');

-- ---------------------------------------------------------------------------
-- Seasons + season rules (the single source of truth for every number)
-- ---------------------------------------------------------------------------
CREATE TABLE seasons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text UNIQUE NOT NULL,
  deadline_at        timestamptz NOT NULL,   -- 31 Dec 2026 23:59 IST
  last_interview_at  timestamptz NOT NULL,   -- 14 Feb 2027
  season_end_at      timestamptz NOT NULL,   -- 28 Feb 2027
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE season_rules (
  season_id                 uuid PRIMARY KEY REFERENCES seasons(id) ON DELETE CASCADE,
  fail_cooldown_days        int NOT NULL DEFAULT 14,
  noshow_cooldown_days      int NOT NULL DEFAULT 7,
  retake_cooldown_days      int NOT NULL DEFAULT 3,
  max_attempts              int NOT NULL DEFAULT 3,
  change_cutoff_hours       int NOT NULL DEFAULT 12,   -- free changes close
  booking_cutoff_hours      int NOT NULL DEFAULT 3,    -- booking closes
  priority_booking_cutoff_hours int NOT NULL DEFAULT 2,
  emergency_cutoff_hours    int NOT NULL DEFAULT 12,
  join_open_minutes         int NOT NULL DEFAULT 10,   -- Join opens at T-10
  join_grace_minutes        int NOT NULL DEFAULT 10,   -- no-show at T+10
  interviewer_absent_minutes int NOT NULL DEFAULT 5,   -- "interviewer hasn't joined" from T+5
  attendance_check_minutes  int NOT NULL DEFAULT 15,   -- attendance sweep at T+15
  publish_delay_minutes     int NOT NULL DEFAULT 15,   -- publish_at = submit + 15
  slot_grid_minutes         int NOT NULL DEFAULT 40,
  slot_duration_minutes     int NOT NULL DEFAULT 30,
  day_release_hour_ist      int NOT NULL DEFAULT 20,    -- next day's slots at 8 PM IST
  pool_release_hours        int NOT NULL DEFAULT 24,    -- reserved seats open at T-24h
  grid_start_local          time NOT NULL DEFAULT '09:00',
  grid_end_local            time NOT NULL DEFAULT '21:00',
  horizon_days              int NOT NULL DEFAULT 14,
  dec_deadline_reserve      numeric NOT NULL DEFAULT 0.70,
  dec_priority_reserve      numeric NOT NULL DEFAULT 0.20,
  rate_bookings_per_min     int NOT NULL DEFAULT 5,
  rate_bookings_per_day     int NOT NULL DEFAULT 20
);

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sso_subject  text UNIQUE NOT NULL,
  email        text,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    user_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE students (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grit_id          text UNIQUE NOT NULL,
  batch            text,
  section          text,
  campus           text,
  programme_status programme_status NOT NULL DEFAULT 'ACTIVE',
  photo_key        text,
  base_miles       int NOT NULL DEFAULT 0,  -- Miles before any badge; total = base + active badge miles
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Tracks, badges, skills
-- ---------------------------------------------------------------------------
CREATE TABLE skills (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL
);

CREATE TABLE tracks (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE badges (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id             uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  level                int NOT NULL,         -- 1=Novice, 2=Specialist ...
  name                 text NOT NULL,
  miles                int NOT NULL,
  prerequisite_badge_id uuid REFERENCES badges(id),
  requires_project     boolean NOT NULL DEFAULT false,
  UNIQUE (track_id, level)
);

CREATE TABLE badge_skill_requirements (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id  uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  skill_id  uuid NOT NULL REFERENCES skills(id),
  min_level int NOT NULL,
  version   int NOT NULL DEFAULT 1,
  UNIQUE (badge_id, skill_id, version)
);

CREATE TABLE student_skill_levels (
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  skill_id   uuid NOT NULL REFERENCES skills(id),
  level      int NOT NULL DEFAULT 0,
  source_seq bigint NOT NULL DEFAULT 0,  -- monotonic guard for contest events
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- Interviewers + availability
-- ---------------------------------------------------------------------------
CREATE TABLE interviewers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name     text NOT NULL,
  max_per_day      int NOT NULL DEFAULT 8,
  last_assigned_at timestamptz,
  active           boolean NOT NULL DEFAULT true,
  calibrated       boolean NOT NULL DEFAULT true,
  photo_key        text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE interviewer_tracks (
  interviewer_id  uuid NOT NULL REFERENCES interviewers(id) ON DELETE CASCADE,
  track_id        uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  max_badge_level int NOT NULL DEFAULT 2,
  PRIMARY KEY (interviewer_id, track_id)
);

CREATE TABLE interviewer_conflicts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interviewer_id uuid NOT NULL REFERENCES interviewers(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  reason         text,
  UNIQUE (interviewer_id, student_id)
);

CREATE TABLE availability_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interviewer_id uuid NOT NULL REFERENCES interviewers(id) ON DELETE CASCADE,
  weekday        int NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sunday
  start_local    time NOT NULL,
  end_local      time NOT NULL,
  tz             text NOT NULL DEFAULT 'Asia/Kolkata',
  active         boolean NOT NULL DEFAULT true
);

CREATE TABLE availability_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interviewer_id uuid NOT NULL REFERENCES interviewers(id) ON DELETE CASCADE,
  date           date NOT NULL,
  kind           override_kind NOT NULL,
  start_local    time,
  end_local      time
);

-- ---------------------------------------------------------------------------
-- Slots — EXCLUDE constraint prevents overlapping slots per interviewer
-- ---------------------------------------------------------------------------
CREATE TABLE interview_slots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interviewer_id uuid NOT NULL REFERENCES interviewers(id) ON DELETE CASCADE,
  start_at       timestamptz NOT NULL,
  buffer_end_at  timestamptz NOT NULL,
  status         slot_status NOT NULL DEFAULT 'OPEN',
  audience       slot_audience NOT NULL DEFAULT 'ANY',
  bookable_from  timestamptz NOT NULL,
  version        int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_interviewer_overlap
    EXCLUDE USING gist (
      interviewer_id WITH =,
      tstzrange(start_at, buffer_end_at, '[)') WITH &&
    ) WHERE (status <> 'CANCELLED')
);
CREATE INDEX idx_slots_start_status ON interview_slots (start_at, status);
CREATE INDEX idx_slots_interviewer ON interview_slots (interviewer_id);

-- ---------------------------------------------------------------------------
-- Journeys — the 11-state machine lives here (trigger added in 0002)
-- ---------------------------------------------------------------------------
CREATE TABLE interview_journeys (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id               uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  badge_id                 uuid NOT NULL REFERENCES badges(id),
  season_id                uuid NOT NULL REFERENCES seasons(id),
  state                    journey_state NOT NULL DEFAULT 'LOCKED',
  state_reason             text,
  attempt_count            int NOT NULL DEFAULT 0,
  max_attempts             int NOT NULL DEFAULT 3,
  consecutive_retake_later int NOT NULL DEFAULT 0,
  changes_count            int NOT NULL DEFAULT 0,
  cooldown_until           timestamptz,
  priority_rebook          boolean NOT NULL DEFAULT false,
  hold_prev_state          journey_state,
  deadline_protected_until timestamptz,
  version                  int NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, badge_id, season_id)
);
CREATE INDEX idx_journeys_student ON interview_journeys (student_id);
CREATE INDEX idx_journeys_state ON interview_journeys (state);

-- ---------------------------------------------------------------------------
-- Bookings — 3 partial unique indexes are the DB backstop for double-booking
-- ---------------------------------------------------------------------------
CREATE TABLE bookings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id           uuid NOT NULL REFERENCES interview_journeys(id) ON DELETE CASCADE,
  student_id           uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  slot_id              uuid NOT NULL REFERENCES interview_slots(id),
  interviewer_id       uuid NOT NULL REFERENCES interviewers(id),
  start_at             timestamptz NOT NULL,
  status               booking_status NOT NULL DEFAULT 'CONFIRMED',
  void_reason          text,
  booking_code         text NOT NULL,
  student_joined_at    timestamptz,
  interviewer_joined_at timestamptz,
  review_required      boolean NOT NULL DEFAULT false,
  idempotency_key      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- one live booking per slot
CREATE UNIQUE INDEX uq_bookings_slot_live ON bookings (slot_id)
  WHERE status IN ('CONFIRMED','IN_PROGRESS','COMPLETED','NO_SHOW');
-- one upcoming interview per student
CREATE UNIQUE INDEX uq_bookings_student_upcoming ON bookings (student_id)
  WHERE status = 'CONFIRMED';
-- one live booking per badge journey
CREATE UNIQUE INDEX uq_bookings_journey_live ON bookings (journey_id)
  WHERE status IN ('CONFIRMED','IN_PROGRESS');
CREATE INDEX idx_bookings_interviewer_start ON bookings (interviewer_id, start_at);

-- ---------------------------------------------------------------------------
-- Outcomes — one current outcome per booking, locks at publish
-- ---------------------------------------------------------------------------
CREATE TABLE interview_outcomes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  what_happened          text NOT NULL DEFAULT 'COMPLETED',
  result                 outcome_result,
  suggested_result       outcome_result,
  rubric                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  feedback_to_student    text,
  focus_areas            jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_notes_encrypted text,
  integrity_flag         boolean NOT NULL DEFAULT false,
  recorded_by            uuid REFERENCES users(id),
  submitted_at           timestamptz,
  publish_at             timestamptz,
  locked_at              timestamptz,
  review_status          outcome_review_status NOT NULL DEFAULT 'NONE',
  amended_from           uuid,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Badges earned — rows never deleted; nullification is a status change
-- ---------------------------------------------------------------------------
CREATE TABLE student_badges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  badge_id   uuid NOT NULL REFERENCES badges(id),
  outcome_id uuid REFERENCES interview_outcomes(id),
  awarded_at timestamptz NOT NULL,   -- = interview start time
  status     badge_status NOT NULL DEFAULT 'ACTIVE',
  miles      int NOT NULL,
  case_id    uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_student_badge_active ON student_badges (student_id, badge_id)
  WHERE status IN ('ACTIVE','UNDER_REVIEW');

-- ---------------------------------------------------------------------------
-- Idempotency, audit, integrity, approvals, notifications
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idem_key        text NOT NULL,
  request_hash    text NOT NULL,
  response_status int,
  response_body   jsonb,
  status          text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idem_key)
);

CREATE TABLE journey_events (
  id            bigserial PRIMARY KEY,
  journey_id    uuid NOT NULL REFERENCES interview_journeys(id) ON DELETE CASCADE,
  from_state    journey_state,
  to_state      journey_state,
  action        text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  reason        text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     text,
  hash          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_journey_events_journey ON journey_events (journey_id, id);

CREATE TABLE integrity_cases (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text UNIQUE NOT NULL,
  subject_type           case_subject_type NOT NULL,
  subject_student_id     uuid REFERENCES students(id),
  subject_interviewer_id uuid REFERENCES interviewers(id),
  status                 case_status NOT NULL DEFAULT 'TRIAGE',
  opened_by              uuid REFERENCES users(id),
  decided_by             uuid REFERENCES users(id),
  cosigned_by            uuid REFERENCES users(id),
  reason                 text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  decided_at             timestamptz
);

CREATE TABLE approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        approval_action NOT NULL,
  status        approval_status NOT NULL DEFAULT 'PENDING',
  requested_by  uuid REFERENCES users(id),
  approved_by   uuid REFERENCES users(id),
  interviewer_id uuid REFERENCES interviewers(id),
  journey_id    uuid REFERENCES interview_journeys(id),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);

CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id),
  student_id   uuid REFERENCES students(id),
  channel      notification_channel NOT NULL,
  template     text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  neutral_text text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_student ON notifications (student_id, created_at);
