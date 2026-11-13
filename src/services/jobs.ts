/**
 * Background jobs, run on demand against the simulated clock (no real cron).
 * runTick() executes every due job in order, idempotently, using app_now().
 */
import { sql } from "@/db";
import { ApiError } from "@/lib/errors";
import { transitionJourney } from "./journeys";
import { materializeSlots } from "./slots";
import { voidBooking } from "./reassign";
import { unlockIfReady } from "./skillSync";

export interface JobResult {
  job: string;
  affected: number;
}

/**
 * Runs one row's work; a failure is logged and the sweep moves on to the next row
 * (the row is retried on the next tick). Returns the work's result, or false on error.
 */
async function perRow(job: string, id: string, work: () => Promise<boolean>): Promise<boolean> {
  try {
    return await work();
  } catch (e) {
    console.error(`${job}: row ${id} failed, skipping`, e);
    return false;
  }
}

async function rules() {
  return (await sql<
    {
      fail_cooldown_days: number;
      noshow_cooldown_days: number;
      retake_cooldown_days: number;
      pool_release_hours: number;
      deadline_at: Date;
    }[]
  >`SELECT sr.fail_cooldown_days, sr.noshow_cooldown_days, sr.retake_cooldown_days, sr.pool_release_hours, s.deadline_at
     FROM season_rules sr JOIN seasons s ON s.id = sr.season_id LIMIT 1`)[0];
}

/**
 * December seat pools (spec §2, §9): from 1 Dec to the deadline, 70% of each day's
 * seats are held for students with no badge yet (DEADLINE), 20% for priority
 * rebooks (PRIORITY), and the rest stay open to all. Applied to seats more than
 * pool_release_hours away; poolRelease opens unclaimed ones to everyone at T-24 h,
 * and they're never re-reserved (they're inside the release window by then).
 * Idempotent: per day it only tops the pools up to their share, never shrinks them.
 * Seat choice is stable (ordered by a hash of the slot id) so ticks don't churn.
 * `range` overrides the December window (tests).
 */
export async function decemberPools(range?: { from: Date; to: Date }): Promise<JobResult> {
  const res = await sql`
    WITH params AS (
      SELECT sr.dec_deadline_reserve::numeric dshare, sr.dec_priority_reserve::numeric pshare, sr.pool_release_hours h,
             COALESCE(${range?.from ?? null}::timestamptz,
                      (date_trunc('month', s.deadline_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')) from_at,
             COALESCE(${range?.to ?? null}::timestamptz, s.deadline_at) to_at
      FROM season_rules sr JOIN seasons s ON s.id = sr.season_id LIMIT 1
    ),
    day_slots AS (
      SELECT sl.id, sl.audience, sl.status, (sl.start_at AT TIME ZONE 'Asia/Kolkata')::date d, md5(sl.id::text) k
      FROM interview_slots sl, params p
      WHERE sl.start_at >= p.from_at AND sl.start_at <= p.to_at
        AND sl.start_at > app_now() + make_interval(hours => p.h)
        AND sl.status <> 'CANCELLED'
    ),
    totals AS (
      SELECT d, count(*) n,
             count(*) FILTER (WHERE audience = 'DEADLINE') nd,
             count(*) FILTER (WHERE audience = 'PRIORITY') np
      FROM day_slots GROUP BY d
    ),
    need AS (
      SELECT t.d,
             GREATEST(0, floor(t.n * p.dshare)::int - t.nd) need_d,
             GREATEST(0, floor(t.n * p.pshare)::int - t.np) need_p
      FROM totals t CROSS JOIN params p
    ),
    candidates AS (
      SELECT ds.id, ds.d, row_number() OVER (PARTITION BY ds.d ORDER BY ds.k) rn
      FROM day_slots ds WHERE ds.audience = 'ANY' AND ds.status = 'OPEN'
    )
    UPDATE interview_slots s
    SET audience = CASE WHEN c.rn <= n.need_d THEN 'DEADLINE'::slot_audience ELSE 'PRIORITY'::slot_audience END,
        version = s.version + 1
    FROM candidates c JOIN need n ON n.d = c.d
    WHERE s.id = c.id AND c.rn <= n.need_d + n.need_p
      -- re-checked at update time: a seat booked since the snapshot keeps its label
      AND s.status = 'OPEN' AND s.audience = 'ANY'`;
  return { job: "decemberPools", affected: res.count };
}

/** Open reserved DEADLINE/PRIORITY seats to everyone at T-24h. */
async function poolRelease(): Promise<JobResult> {
  const r = await rules();
  const res = await sql`
    UPDATE interview_slots SET audience = 'ANY'
    WHERE audience IN ('DEADLINE','PRIORITY') AND status = 'OPEN'
      AND start_at <= app_now() + make_interval(hours => ${r.pool_release_hours})`;
  return { job: "poolRelease", affected: res.count };
}

/**
 * Attendance check at T+15: joined → AWAITING_RESULT; absent → NO_SHOW (+attempt).
 * Each row runs in its own transaction that locks booking → journey (the same order
 * as submitOutcome / cancel / reschedule) and re-reads both, so an interviewer's
 * outcome or a late join that landed after the scan is respected.
 */
async function attendanceCheck(): Promise<JobResult> {
  const r = await rules();
  const due = await sql<{ booking_id: string }[]>`
    SELECT bk.id booking_id
    FROM bookings bk
    JOIN interview_journeys j ON j.id = bk.journey_id
    JOIN season_rules sr ON true
    WHERE bk.status = 'CONFIRMED' AND j.state = 'BOOKED'
      AND app_now() >= bk.start_at + make_interval(mins => sr.attendance_check_minutes)`;
  let affected = 0;
  for (const d of due) {
    const done = await perRow("attendanceCheck", d.booking_id, () =>
      sql.begin(async (tx) => {
        const bk = (
          await tx<{ id: string; journey_id: string; start_at: Date; joined: boolean; iv_joined: boolean; reported: boolean }[]>`
            SELECT id, journey_id, start_at, (student_joined_at IS NOT NULL) joined,
                   (interviewer_joined_at IS NOT NULL) iv_joined, (absent_reported_at IS NOT NULL) reported
            FROM bookings WHERE id = ${d.booking_id} AND status = 'CONFIRMED' FOR UPDATE`
        )[0];
        if (!bk) return false; // already completed / no-show / cancelled since the scan
        const j = (await tx<{ state: string }[]>`SELECT state FROM interview_journeys WHERE id = ${bk.journey_id} FOR UPDATE`)[0];
        if (j?.state !== "BOOKED") return false;
        if (!bk.iv_joined) {
          // Interviewer absent at T+15 (spec §2, §6): any swap was tried when it was
          // reported; now call it off with a priority rebook. The student isn't charged.
          await voidBooking(tx, bk.id, {
            fault: "INTERVIEWER",
            reason: bk.reported ? "Interviewer hadn't joined (reported by the student)" : "Interviewer hadn't joined by 15 minutes past the start",
            actorUserId: null,
          });
        } else if (bk.joined) {
          await tx`UPDATE bookings SET status = 'COMPLETED', updated_at = app_now() WHERE id = ${bk.id}`;
          await transitionJourney(tx, { journeyId: bk.journey_id, action: "attend", reason: "Result pending", lock: false });
        } else {
          await recordNoShow(tx, { bookingId: bk.id, journeyId: bk.journey_id, startAt: bk.start_at, noshowCooldownDays: r.noshow_cooldown_days });
        }
        return true;
      })
    );
    if (done) affected++;
  }
  return { job: "attendanceCheck", affected };
}

/**
 * Student absent. Shared by the T+15 attendance check and the interviewer's
 * "Student didn't join" outcome (services/interviewerView.submitOutcome), so both
 * have the same effect: booking NO_SHOW, slot retired (CANCELLED: its time has
 * passed, same as a voided interview), journey BOOKED -> NO_SHOW, 1 attempt counted,
 * no-show cooldown from the interview date, and the journey closes if that was the
 * last attempt. Caller runs inside a transaction and has already locked the booking
 * row (lock order: booking → journey).
 */
/** Retake later results in a row that need an approval (spec section 1). */
export const THIRD_RETAKE_STREAK = 3;

export async function recordNoShow(
  tx: Parameters<typeof transitionJourney>[0],
  opts: { bookingId: string; journeyId: string; startAt: Date; noshowCooldownDays: number; actorUserId?: string | null; reason?: string }
): Promise<void> {
  const jr = (await tx<{ attempt_count: number; max_attempts: number }[]>`SELECT attempt_count, max_attempts FROM interview_journeys WHERE id = ${opts.journeyId} FOR UPDATE`)[0];
  const marked = await tx<{ slot_id: string }[]>`
    UPDATE bookings SET status = 'NO_SHOW', updated_at = app_now()
    WHERE id = ${opts.bookingId} AND status IN ('CONFIRMED','IN_PROGRESS')
    RETURNING slot_id`;
  if (marked.length !== 1) throw new ApiError(409, "VERSION_CONFLICT", "The booking changed, please retry.");
  await tx`UPDATE interview_slots SET status = 'CANCELLED', version = version + 1 WHERE id = ${marked[0].slot_id}`;
  const cooldown = new Date(opts.startAt.getTime() + opts.noshowCooldownDays * 86_400_000);
  await transitionJourney(tx, {
    journeyId: opts.journeyId,
    action: "no_show",
    reason: opts.reason ?? "Missed interview",
    actorUserId: opts.actorUserId ?? null,
    patch: { attempt_count: jr.attempt_count + 1, cooldown_until: cooldown, consecutive_retake_later: 0 },
  });
  await closeIfAttemptLimit(tx, opts.journeyId, jr.attempt_count + 1, jr.max_attempts);
}

/**
 * Publish outcomes whose publish_at has passed; award badge + Miles on PASS.
 * Per row: lock booking → journey, then claim the outcome with a guarded UPDATE
 * (still unlocked, not under review, has a result) and act on the values it returns,
 * so an edit or an integrity flag that landed after the scan is respected.
 */
async function outcomePublisher(): Promise<JobResult> {
  const r = await rules();
  const due = await sql<{ outcome_id: string; booking_id: string }[]>`
    SELECT o.id outcome_id, bk.id booking_id
    FROM interview_outcomes o
    JOIN bookings bk ON bk.id = o.booking_id
    JOIN interview_journeys j ON j.id = bk.journey_id
    WHERE o.publish_at <= app_now() AND o.locked_at IS NULL
      AND o.review_status = 'NONE' AND o.result IS NOT NULL
      AND j.state = 'AWAITING_RESULT'
      -- Spec copy: an interview booked before a review goes ahead, and its result appears after the review.
      AND NOT EXISTS (SELECT 1 FROM integrity_cases ic WHERE ic.subject_student_id = bk.student_id AND ic.status = 'OPEN')`;
  let affected = 0;
  for (const d of due) {
    const done = await perRow("outcomePublisher", d.outcome_id, () =>
      sql.begin(async (tx) => {
        const bk = (
          await tx<{ journey_id: string; student_id: string; start_at: Date }[]>`
            SELECT journey_id, student_id, start_at FROM bookings WHERE id = ${d.booking_id} FOR UPDATE`
        )[0];
        if (!bk) return false;
        const jr = (
          await tx<{ state: string; badge_id: string; attempt_count: number; max_attempts: number; consecutive_retake_later: number }[]>`
            SELECT state, badge_id, attempt_count, max_attempts, consecutive_retake_later
            FROM interview_journeys WHERE id = ${bk.journey_id} FOR UPDATE`
        )[0];
        if (jr?.state !== "AWAITING_RESULT") return false;
        const claimed = (
          await tx<{ result: "PASS" | "FAIL" | "RETAKE_LATER" }[]>`
            UPDATE interview_outcomes SET locked_at = app_now(), review_status = 'RELEASED'
            WHERE id = ${d.outcome_id} AND locked_at IS NULL AND review_status = 'NONE'
              AND result IS NOT NULL AND publish_at <= app_now()
              AND NOT EXISTS (SELECT 1 FROM integrity_cases ic WHERE ic.subject_student_id = ${bk.student_id} AND ic.status = 'OPEN')
            RETURNING result`
        )[0];
        if (!claimed) return false;
        const journeyId = bk.journey_id;

        if (claimed.result === "PASS") {
          const miles = (await tx<{ miles: number }[]>`SELECT miles FROM badges WHERE id = ${jr.badge_id}`)[0].miles;
          await transitionJourney(tx, { journeyId, action: "publish_pass", reason: "Badge earned", lock: false });
          await tx`
            INSERT INTO student_badges (student_id, badge_id, outcome_id, awarded_at, status, miles)
            VALUES (${bk.student_id}, ${jr.badge_id}, ${d.outcome_id}, ${bk.start_at}, 'ACTIVE', ${miles})`;
          // Spec: a Pass can open the next badge in the track (its prerequisite is now earned).
          const next = await tx<{ id: string }[]>`
            SELECT j.id FROM interview_journeys j JOIN badges b ON b.id = j.badge_id
            WHERE j.student_id = ${bk.student_id} AND j.state = 'LOCKED' AND b.prerequisite_badge_id = ${jr.badge_id}
            ORDER BY j.id FOR UPDATE OF j`;
          for (const n of next) await unlockIfReady(tx, n.id, { unlockedBy: journeyId });
        } else if (claimed.result === "FAIL") {
          const cooldown = new Date(bk.start_at.getTime() + r.fail_cooldown_days * 86_400_000);
          await transitionJourney(tx, {
            journeyId,
            action: "publish_fail",
            reason: "Not cleared",
            lock: false,
            patch: { attempt_count: jr.attempt_count + 1, cooldown_until: cooldown, consecutive_retake_later: 0 },
          });
          await closeIfAttemptLimit(tx, journeyId, jr.attempt_count + 1, jr.max_attempts);
        } else {
          const cooldown = new Date(bk.start_at.getTime() + r.retake_cooldown_days * 86_400_000);
          const streak = jr.consecutive_retake_later + 1;
          // Spec section 1: a 3rd Retake later in a row needs admin approval before booking reopens.
          const needsApproval = streak >= THIRD_RETAKE_STREAK;
          await transitionJourney(tx, {
            journeyId,
            action: "publish_retake",
            reason: needsApproval ? "Retake allowed; the team confirms when you can book again" : "Retake allowed",
            lock: false,
            patch: { cooldown_until: cooldown, consecutive_retake_later: streak, retake_approval_pending: needsApproval },
          });
          if (needsApproval) {
            await tx`
              INSERT INTO approvals (action, journey_id, payload, reason, created_at)
              VALUES ('THIRD_RETAKE', ${journeyId}, ${tx.json({ outcomeId: d.outcome_id })},
                      ${`Retake later ${streak} times in a row`}, app_now())`;
          }
        }
        // Spec: every outcome sends the same neutral notification ("Your result is ready").
        await tx`
          INSERT INTO notifications (student_id, channel, template, payload, created_at)
          VALUES (${bk.student_id}, 'IN_APP', 'RESULT_READY', ${tx.json({ journeyId })}, app_now())`;
        return true;
      })
    );
    if (done) affected++;
  }
  return { job: "outcomePublisher", affected };
}

/**
 * Attempt cap. A counted attempt (fail or no-show) that reaches the journey's
 * max_attempts closes the journey instead of leaving it to cool down and reopen.
 * Retake-later doesn't count as an attempt, so it never closes here. An approved
 * REOPEN raises max_attempts and moves CLOSED back to ELIGIBLE.
 */
export async function closeIfAttemptLimit(tx: Parameters<typeof transitionJourney>[0], journeyId: string, attemptCount: number, maxAttempts: number) {
  if (attemptCount < maxAttempts) return;
  await transitionJourney(tx, {
    journeyId,
    action: "attempt_close",
    reason: "Attempt limit reached",
    lock: false,
    patch: { cooldown_until: null },
  });
}

/** Move cooled-down journeys back to ELIGIBLE. */
async function cooldownExpiry(): Promise<JobResult> {
  const due = await sql<{ id: string }[]>`
    SELECT id FROM interview_journeys
    WHERE state IN ('FAILED','RETAKE_LATER','NO_SHOW') AND NOT retake_approval_pending
      AND cooldown_until IS NOT NULL AND cooldown_until <= app_now()`;
  let affected = 0;
  for (const d of due) {
    const done = await perRow("cooldownExpiry", d.id, () =>
      sql.begin(async (tx) => {
        // Re-check under the lock: the row may have moved on since the scan.
        const j = (await tx<{ ok: boolean }[]>`
          SELECT (state IN ('FAILED','RETAKE_LATER','NO_SHOW') AND NOT retake_approval_pending AND cooldown_until IS NOT NULL AND cooldown_until <= app_now()) ok
          FROM interview_journeys WHERE id = ${d.id} FOR UPDATE`)[0];
        if (!j?.ok) return false;
        await transitionJourney(tx, { journeyId: d.id, action: "cooldown_expire", reason: "Ready to book", patch: { priority_rebook: false, cooldown_until: null }, lock: false });
        return true;
      })
    );
    if (done) affected++;
  }
  return { job: "cooldownExpiry", affected };
}

/** After 31 Dec: close journeys for students with no counted badge (skip pending/protected). */
async function deadlineSweep(): Promise<JobResult> {
  const r = await rules();
  const now = (await sql<{ now: Date }[]>`SELECT app_now() now`)[0].now;
  if (now.getTime() <= r.deadline_at.getTime()) return { job: "deadlineSweep", affected: 0 };

  const due = await sql<{ id: string }[]>`
    SELECT j.id FROM interview_journeys j
    JOIN students st ON st.id = j.student_id
    WHERE j.state IN ('ELIGIBLE','FAILED','RETAKE_LATER','NO_SHOW')
      AND (j.deadline_protected_until IS NULL OR j.deadline_protected_until <= app_now())
      AND NOT EXISTS (SELECT 1 FROM student_badges sb WHERE sb.student_id = st.id AND sb.status = 'ACTIVE')
      -- spec §6: the sweep skips students with an open integrity case
      AND NOT EXISTS (SELECT 1 FROM integrity_cases ic WHERE ic.subject_student_id = st.id AND ic.status IN ('TRIAGE','OPEN'))`;
  let affected = 0;
  for (const d of due) {
    const done = await perRow("deadlineSweep", d.id, () =>
      sql.begin(async (tx) => {
        const j = (await tx<{ state: string }[]>`SELECT state FROM interview_journeys WHERE id = ${d.id} FOR UPDATE`)[0];
        if (!j || !["ELIGIBLE", "FAILED", "RETAKE_LATER", "NO_SHOW"].includes(j.state)) return false;
        await transitionJourney(tx, { journeyId: d.id, action: "deadline_close", reason: "Booking closed — deadline passed", lock: false });
        return true;
      })
    );
    if (done) affected++;
  }
  return { job: "deadlineSweep", affected };
}

// ── notifications-only jobs (spec section 6 jobs table) ─────────────────────
// Each notice is written once: NOT EXISTS on (template, payload.bookingId / caseId).

const REMINDERS: { template: string; minutes: number }[] = [
  { template: "REMINDER_10M", minutes: 10 },
  { template: "REMINDER_1H", minutes: 60 },
  { template: "REMINDER_24H", minutes: 24 * 60 },
];

/**
 * Reminders at T-24 h, T-1 h and T-10 min to the student and the interviewer. Only
 * the closest stage that applies is sent: a booking made 2 h before gets the 1 h
 * reminder, not a late "tomorrow" one.
 */
async function reminders(): Promise<JobResult> {
  let affected = 0;
  for (const [i, r] of REMINDERS.entries()) {
    const closer = REMINDERS.slice(0, i).map((x) => x.minutes);
    const lowerBound = closer.length ? Math.max(...closer) : 0;
    const rows = await sql<{ id: string; student_id: string; iv_user: string }[]>`
      SELECT bk.id, bk.student_id, iv.user_id iv_user
      FROM bookings bk JOIN interviewers iv ON iv.id = bk.interviewer_id
      WHERE bk.status = 'CONFIRMED'
        AND bk.start_at > app_now() + make_interval(mins => ${lowerBound})
        AND bk.start_at <= app_now() + make_interval(mins => ${r.minutes})
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.template = ${r.template} AND n.payload->>'bookingId' = bk.id::text)`;
    for (const b of rows) {
      const payload = sql.json({ bookingId: b.id });
      await sql`
        INSERT INTO notifications (student_id, channel, template, payload, created_at)
        VALUES (${b.student_id}, 'IN_APP', ${r.template}, ${payload}, app_now())`;
      await sql`
        INSERT INTO notifications (user_id, channel, template, payload, created_at)
        VALUES (${b.iv_user}, 'IN_APP', ${r.template}, ${payload}, app_now())`;
      affected++;
    }
  }
  return { job: "reminders", affected };
}

/**
 * Outcome SLA: an interview that ended without an outcome nudges the interviewer at
 * +2 h and +12 h after its end, and escalates to the interview team at +24 h.
 */
async function outcomeSla(): Promise<JobResult> {
  const stages = [
    { template: "OUTCOME_NUDGE_2H", hours: 2, toTeam: false },
    { template: "OUTCOME_NUDGE_12H", hours: 12, toTeam: false },
    { template: "OUTCOME_ESCALATED_24H", hours: 24, toTeam: true },
  ];
  let affected = 0;
  for (const st of stages) {
    const rows = await sql<{ id: string; iv_user: string }[]>`
      SELECT bk.id, iv.user_id iv_user
      FROM bookings bk
      JOIN interviewers iv ON iv.id = bk.interviewer_id
      JOIN interview_journeys j ON j.id = bk.journey_id
      CROSS JOIN season_rules sr
      WHERE bk.status = 'COMPLETED' AND j.state = 'AWAITING_RESULT'
        AND NOT EXISTS (SELECT 1 FROM interview_outcomes o WHERE o.booking_id = bk.id)
        AND app_now() >= bk.start_at + make_interval(mins => sr.slot_duration_minutes) + make_interval(hours => ${st.hours})
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.template = ${st.template} AND n.payload->>'bookingId' = bk.id::text)`;
    for (const b of rows) {
      const payload = sql.json({ bookingId: b.id });
      if (st.toTeam) {
        await sql`
          INSERT INTO notifications (user_id, channel, template, payload, created_at)
          SELECT DISTINCT user_id, 'IN_APP'::notification_channel, ${st.template}, ${payload}, app_now()
          FROM user_roles WHERE role IN ('INTERVIEW_ADMIN','PROGRAM_ADMIN')`;
      } else {
        await sql`
          INSERT INTO notifications (user_id, channel, template, payload, created_at)
          VALUES (${b.iv_user}, 'IN_APP', ${st.template}, ${payload}, app_now())`;
      }
      affected++;
    }
  }
  return { job: "outcomeSla", affected };
}

/** Hours after which an untriaged integrity flag escalates, and is released automatically. */
export const TRIAGE_ESCALATE_HOURS = 12;
export const TRIAGE_RELEASE_HOURS = 24;

/**
 * Triage SLA (spec section 6): a flag still in triage escalates to the team at 12 h and
 * is released automatically at 24 h (the held result publishes as recorded). A case
 * someone put under review (OPEN) is never auto-released.
 */
async function triageSla(): Promise<JobResult> {
  let affected = 0;
  const escalate = await sql<{ id: string }[]>`
    SELECT ic.id FROM integrity_cases ic
    WHERE ic.status = 'TRIAGE' AND ic.created_at <= app_now() - make_interval(hours => ${TRIAGE_ESCALATE_HOURS})
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.template = 'TRIAGE_ESCALATED' AND n.payload->>'caseId' = ic.id::text)`;
  for (const c of escalate) {
    await sql`
      INSERT INTO notifications (user_id, channel, template, payload, created_at)
      SELECT DISTINCT user_id, 'IN_APP'::notification_channel, 'TRIAGE_ESCALATED', ${sql.json({ caseId: c.id })}, app_now()
      FROM user_roles WHERE role IN ('INTERVIEW_ADMIN','PROGRAM_ADMIN')`;
    affected++;
  }
  const release = await sql<{ id: string }[]>`
    SELECT id FROM integrity_cases
    WHERE status = 'TRIAGE' AND created_at <= app_now() - make_interval(hours => ${TRIAGE_RELEASE_HOURS})`;
  for (const c of release) {
    const done = await perRow("triageSla", c.id, async () => {
      // Imported lazily: integrity.ts imports this module.
      const { dismissCase } = await import("./integrity");
      try {
        await dismissCase({
          caseId: c.id,
          actorUserId: null,
          note: `Released automatically: not triaged within ${TRIAGE_RELEASE_HOURS} hours.`,
          onlyIfTriage: true,
        });
        return true;
      } catch (e) {
        // Decided or put under review since the scan: nothing to do.
        if (e instanceof ApiError && ["ALREADY_DECIDED", "NOT_IN_TRIAGE"].includes(e.code)) return false;
        throw e;
      }
    });
    if (done) affected++;
  }
  return { job: "triageSla", affected };
}

/** Season end (spec section 1: 14 Feb): close everything still open that has nothing in progress. */
async function seasonEnd(): Promise<JobResult> {
  const due = await sql<{ id: string }[]>`
    SELECT j.id FROM interview_journeys j JOIN seasons s ON s.id = j.season_id
    WHERE app_now() > s.last_interview_at
      AND j.state IN ('LOCKED','ELIGIBLE','FAILED','RETAKE_LATER','NO_SHOW')`;
  let affected = 0;
  for (const d of due) {
    const done = await perRow("seasonEnd", d.id, () =>
      sql.begin(async (tx) => {
        const j = (await tx<{ state: string }[]>`SELECT state FROM interview_journeys WHERE id = ${d.id} FOR UPDATE`)[0];
        if (!j || !["LOCKED", "ELIGIBLE", "FAILED", "RETAKE_LATER", "NO_SHOW"].includes(j.state)) return false;
        await transitionJourney(tx, { journeyId: d.id, action: "season_close", reason: "Season ended", lock: false, patch: { cooldown_until: null } });
        return true;
      })
    );
    if (done) affected++;
  }
  return { job: "seasonEnd", affected };
}

export async function runTick(): Promise<JobResult[]> {
  const materialised = await materializeSlots();
  const results: JobResult[] = [{ job: "slotMaterialiser", affected: materialised }];
  results.push(await decemberPools());
  results.push(await poolRelease());
  results.push(await attendanceCheck());
  results.push(await outcomePublisher());
  results.push(await cooldownExpiry());
  results.push(await deadlineSweep());
  results.push(await reminders());
  results.push(await outcomeSla());
  results.push(await triageSla());
  results.push(await seasonEnd());
  return results.filter((r) => r.affected > 0 || ["outcomePublisher", "attendanceCheck"].includes(r.job));
}
