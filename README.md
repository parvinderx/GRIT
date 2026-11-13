# GRIT
Feature NXTWAVE

## GRIT Interview Scheduling

A working prototype for booking and running GRIT Level Clearance Interviews: students book a time, interviewers record outcomes, and the interview team manages capacity, approvals and integrity cases. Next.js 16 + PostgreSQL.

### Run locally

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL` (PostgreSQL 16+).
2. `npm install`
3. `npm run db:reset && npm run db:seed`
4. `npm run dev`, then open http://localhost:3000/start and pick a person.

### Tests

- `npm run test:rules`: the booking, approval, integrity and result rules
- `npm run test:concurrency`: 50-way double-booking checks

Deploying to Railway: see `DEPLOY.md`. Product spec and screens: `Docs/`.
