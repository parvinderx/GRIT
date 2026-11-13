# GRIT Interview Scheduling — deploy to Railway

A full-stack Next.js 16 app with its own Node runtime and a PostgreSQL database.

## Railway setup

1. **Create a project** and add the **PostgreSQL** plugin.
2. **Add the app service** from this repo (GitHub or `railway up`). Nixpacks auto-detects Next.js; `railway.json` sets the start command.
3. **Environment variables** on the app service:
   - `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (reference the plugin)
   - `SESSION_SECRET` = a random string of at least 32 characters (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). **Required**: the app refuses to sign sessions in production without it.
   - `APP_TZ = Asia/Kolkata`
   - `DEMO_PASSCODE` = a short word (e.g. `grit-demo`). This turns on the persona switcher at `/start`. The passcode is **printed on `/start`** with a "demo, not a secure system" notice, and every page shows a "Demo deploy" ribbon. Leave it unset and nobody can sign in (there is no SSO yet).
   - `DEV_TOOLS_ENABLED = false` (default in production). `true` adds the clock, story and tick controls; only for a private demo.
   - `CRON_SECRET` = another random string; the job runner below sends it.
   - `NODE_ENV = production`
4. **Deploy.** The start command is `npm run start:prod`, which runs migrations then `next start`:
   - `migrate:prod` applies `drizzle/migrations/*.sql` in order (installs `btree_gist`, the EXCLUDE constraint, partial indexes, the transition trigger, `app_now()`), tracked in a `_migrations` table — safe to run on every boot.
5. **Seed the demo data once** (interviewers, students in every state, slots):
   ```
   railway run npm run seed:prod
   ```
   Re-running wipes and reseeds (it TRUNCATEs app tables; demo students are dated relative to the day you run it).

## Scheduled jobs

Reminders, attendance checks, result publishing, cooldowns, the deadline sweep and the other jobs run when `POST /api/v1/jobs/tick` is called. Add a **Railway cron service** (same repo, or any small image with curl) with schedule `* * * * *` and command:

```
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.up.railway.app/api/v1/jobs/tick
```

Every job is idempotent, so a repeated or overlapping call is safe.

## The clock

The app runs on the **real date and time** (`sim_clock` mode `REAL`; migration 0013 switches existing databases). With `DEV_TOOLS_ENABLED=true`, the Demo controls can jump to a simulated moment (demo stories do this too) and **Back to real time** returns to the live clock. The seed writes its demo students relative to the day you run it, so it always looks current.

## Security notes

- Writes to `/api` from another site are refused (Origin / Sec-Fetch-Site check in `src/proxy.ts`), on top of `SameSite=Lax`, `HttpOnly`, `Secure` session cookies.
- Booking and rescheduling are rate limited per user (5 a minute, 20 a day; see `season_rules`).

## Notes

- **One PostgreSQL 16+ required** for `btree_gist` + `FOR UPDATE SKIP LOCKED`. Railway's managed Postgres works out of the box (superuser lets `CREATE EXTENSION` run).
- The app runs on real time. With `DEV_TOOLS_ENABLED=true`, the Demo controls can switch to simulated time and back (`POST /api/v1/dev/clock` with `{ real: true }` returns to real time).
- No real SSO: with `DEMO_PASSCODE` set, pick a persona at `/start`.
- Local dev: copy `.env.example` → `.env.local`, `npm run db:reset && npm run db:seed`, `npm run dev`.
- Verify double-booking safety anytime: `npm run test:concurrency` (runs 50-way concurrent booking checks against the DB).
