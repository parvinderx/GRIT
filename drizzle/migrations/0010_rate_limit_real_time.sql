-- Rate limits count real-world requests, not simulated time.
ALTER TABLE booking_attempts ALTER COLUMN at SET DEFAULT now();
