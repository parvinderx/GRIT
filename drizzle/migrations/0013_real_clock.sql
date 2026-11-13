-- Run on the real date and time by default. Demo tools (DEV_TOOLS_ENABLED) can still
-- switch to simulated time (mode SIM) and back.
UPDATE sim_clock SET mode = 'REAL', real_offset_seconds = 0, updated_at = now() WHERE id = true;
