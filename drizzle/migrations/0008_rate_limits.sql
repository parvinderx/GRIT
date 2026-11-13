-- Booking rate limits (season_rules.rate_bookings_per_min / _per_day).
-- One row per booking or reschedule attempt that reached the service (idempotent
-- replays excluded). Stamped with the simulated clock.
CREATE TABLE IF NOT EXISTS booking_attempts (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'book',
  at timestamptz NOT NULL DEFAULT app_now()
);
CREATE INDEX IF NOT EXISTS ix_booking_attempts_user_at ON booking_attempts (user_id, at DESC);
