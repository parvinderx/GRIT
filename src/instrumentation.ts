/**
 * Runs the scheduled jobs in-process on an interval, so results publish, reminders go
 * out and cooldowns end on their own while the app runs on real time. On by default
 * outside production; in production a cron calls POST /api/v1/jobs/tick instead,
 * unless JOBS_INTERVAL_SECONDS is set. Every job is idempotent.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const configured = Number(process.env.JOBS_INTERVAL_SECONDS ?? "");
  const seconds = configured > 0 ? configured : process.env.NODE_ENV === "production" ? 0 : 60;
  if (!seconds) return;
  const g = globalThis as unknown as { __gritJobTimer?: ReturnType<typeof setInterval> };
  if (g.__gritJobTimer) return; // dev hot reload: one timer only
  const { runTick } = await import("./services/jobs");
  let running = false;
  g.__gritJobTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runTick();
    } catch (e) {
      console.error("scheduled jobs failed", e);
    } finally {
      running = false;
    }
  }, seconds * 1000);
}
