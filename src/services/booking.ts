import { customAlphabet } from "nanoid";
import { createHash } from "node:crypto";
import { sql } from "@/db";
import { ApiError, mapPgError } from "@/lib/errors";
import { FREE_CHANGES } from "@/lib/rules";
import { transitionJourney, bumpJourney } from "./journeys";
import { claimSlot } from "./reassign";
import { toIST } from "@/lib/time";

const bookingCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

export interface BookResult {
  bookingId: string;
  journeyId: string;
  startAt: string;
  bookingCode: string;
  interviewerId: string;
}

/**
 * The crown jewel. One transaction:
 *  1. lock the student's journey + recompute eligibility (client sends only ids)
 *  2. atomically claim ONE open, qualified slot (FOR UPDATE SKIP LOCKED)
 *  3. insert the booking (3 partial unique indexes are the DB backstop)
 *  4. transition ELIGIBLE -> BOOKED, assign interviewer, enqueue M2
 * Idempotency-Key makes retries/double-taps return the original booking.
 */
export async function bookInterview(params: {
  userId: string;
  studentId: string;
  journeyId: string;
  startAtIso: string;
  idempotencyKey: string;
  /** Staff booking on the student's behalf: recorded with the reason. */
  onBehalfReason?: string;
}): Promise<BookResult> {
  const { userId, studentId, journeyId, startAtIso, idempotencyKey, onBehalfReason } = params;
  const startAt = new Date(startAtIso);
  if (isNaN(startAt.getTime())) throw new ApiError(422, "BAD_TIME", "Invalid start time");

  const requestHash = createHash("sha256").update(`${journeyId}|${startAtIso}`).digest("hex");

  // ── idempotency pre-check ──────────────────────────────────────────────────
  const inserted = await sql`
    INSERT INTO idempotency_keys (user_id, idem_key, request_hash, status)
    VALUES (${userId}, ${idempotencyKey}, ${requestHash}, 'in_progress')
    ON CONFLICT (user_id, idem_key) DO NOTHING
    RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`
      SELECT status, response_body FROM idempotency_keys
      WHERE user_id = ${userId} AND idem_key = ${idempotencyKey}`;
    if (existing[0]?.status === "completed" && existing[0].response_body) {
      return existing[0].response_body as BookResult;
    }
    throw new ApiError(409, "RETRY_IN_FLIGHT", "A booking with this key is already in progress.");
  }

  try {
    const result = await sql.begin(async (tx) => {
      // 1. lock journey + badge info
      const jrows = await tx<
        {
          id: string;
          state: string;
          cooldown_until: Date | null;
          priority_rebook: boolean;
          track_id: string;
          badge_level: number;
          version: number;
          attempt_count: number;
          max_attempts: number;
        }[]
      >`
        SELECT j.id, j.state, j.cooldown_until, j.priority_rebook, j.version, j.attempt_count, j.max_attempts,
               b.track_id, b.level AS badge_level
        FROM interview_journeys j
        JOIN badges b ON b.id = j.badge_id
        WHERE j.id = ${journeyId} AND j.student_id = ${studentId}
        FOR UPDATE OF j`;
      const j = jrows[0];
      if (!j) throw new ApiError(404, "NOT_FOUND", "Journey not found");
      if (j.state === "ON_HOLD") throw new ApiError(423, "ON_HOLD", "Booking is paused under review.");
      // One upcoming interview at a time (uq_bookings_student_upcoming is the backstop): say which one.
      const upcoming = (await tx<{ id: string; start_at: Date }[]>`
        SELECT id, start_at FROM bookings WHERE student_id = ${studentId} AND status IN ('CONFIRMED','IN_PROGRESS') LIMIT 1`)[0];
      if (upcoming) {
        throw new ApiError(
          409,
          "ALREADY_BOOKED",
          `You already have an interview on ${toIST(upcoming.start_at).toFormat("ccc d LLL 'at' h:mm a")} IST. Finish or change that one first.`,
          { bookingId: upcoming.id }
        );
      }
      if (j.state !== "ELIGIBLE") throw new ApiError(409, "NOT_ELIGIBLE", "This journey can't be booked right now.");
      if (j.attempt_count >= j.max_attempts) {
        throw new ApiError(422, "ATTEMPT_LIMIT", "You've used all your attempts for this badge.");
      }

      // cooldown
      const cd = await tx<{ ok: boolean }[]>`
        SELECT (${j.cooldown_until}::timestamptz IS NULL OR ${j.cooldown_until}::timestamptz <= app_now()) AS ok`;
      if (!cd[0].ok) throw new ApiError(422, "COOLDOWN", "You can't book until your cooldown ends.");

      // 2. recompute eligibility server-side (defence against spoofing)
      const missing = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM badge_skill_requirements r
        LEFT JOIN student_skill_levels sl
          ON sl.student_id = ${studentId} AND sl.skill_id = r.skill_id
        WHERE r.badge_id = (SELECT badge_id FROM interview_journeys WHERE id = ${journeyId})
          AND (sl.level IS NULL OR sl.level < r.min_level)`;
      if (missing[0].n > 0) throw new ApiError(422, "NOT_ELIGIBLE", "Not all skills are cleared.");

      // booking window: must be before the booking cut-off
      const rules = (await tx<{ booking_cutoff_hours: number; priority_booking_cutoff_hours: number }[]>`
        SELECT booking_cutoff_hours, priority_booking_cutoff_hours FROM season_rules LIMIT 1`)[0];
      const cutoffH = j.priority_rebook ? rules.priority_booking_cutoff_hours : rules.booking_cutoff_hours;
      const winOk = await tx<{ ok: boolean }[]>`
        SELECT ${startAt}::timestamptz >= app_now() + make_interval(hours => ${cutoffH}) AS ok`;
      if (!winOk[0].ok) throw new ApiError(422, "OUTSIDE_WINDOW", "That time is too close to now to book.");

      // student has any active badge? (for DEADLINE pool eligibility)
      const hasBadge = await tx<{ has: boolean }[]>`
        SELECT EXISTS(
          SELECT 1 FROM student_badges WHERE student_id = ${studentId} AND status = 'ACTIVE'
        ) AS has`;
      const noBadge = !hasBadge[0].has;

      // 3. atomic claim — one open, qualified, conflict-free slot at this time
      const one = await claimSlot(tx, {
        startAt,
        trackId: j.track_id,
        badgeLevel: j.badge_level,
        studentId,
        noBadge,
        priority: j.priority_rebook,
      });
      const claimed = one ? [one] : [];

      if (claimed.length === 0) {
        const near = await tx<{ start_at: Date }[]>`
          SELECT start_at FROM (
            SELECT DISTINCT start_at FROM interview_slots
            WHERE status = 'OPEN' AND bookable_from <= app_now() AND start_at > app_now()
          ) t
          ORDER BY abs(extract(epoch FROM (start_at - ${startAt}::timestamptz)))
          LIMIT 3`;
        throw new ApiError(409, "SLOT_TAKEN", "That time was just taken.", {
          nearest: near.map((n) => n.start_at.toISOString()),
        });
      }
      const slot = claimed[0];

      // 4. insert booking (partial unique indexes backstop double-booking)
      const code = bookingCode();
      const bk = await tx<{ id: string }[]>`
        INSERT INTO bookings (journey_id, student_id, slot_id, interviewer_id, start_at, status, booking_code, idempotency_key)
        VALUES (${journeyId}, ${studentId}, ${slot.id}, ${slot.interviewer_id}, ${startAt}, 'CONFIRMED', ${code}, ${idempotencyKey})
        RETURNING id`;

      // transition ELIGIBLE -> BOOKED (trigger re-validates, bumps version)
      await transitionJourney(tx, {
        journeyId,
        action: "book",
        reason: onBehalfReason ? `Interview scheduled by staff: ${onBehalfReason}` : "Interview scheduled",
        actorUserId: userId,
        // Each new booking gets its own free changes (cancel + reschedule share them).
        patch: { priority_rebook: false, changes_count: 0 },
        payload: { bookingId: bk[0].id, startAt: startAtIso, ...(onBehalfReason ? { onBehalf: true } : {}) },
      });

      // enqueue M2 confirmation
      await tx`
        INSERT INTO notifications (student_id, channel, template, payload)
        VALUES (${studentId}, 'IN_APP', 'M2_CONFIRMED', ${tx.json({ bookingId: bk[0].id })})`;

      return {
        bookingId: bk[0].id,
        journeyId,
        startAt: startAtIso,
        bookingCode: code,
        interviewerId: slot.interviewer_id,
      } satisfies BookResult;
    });

    await sql`
      UPDATE idempotency_keys SET status = 'completed', response_status = 200, response_body = ${sql.json(result)}
      WHERE user_id = ${userId} AND idem_key = ${idempotencyKey}`;
    return result;
  } catch (e) {
    // release the key so a corrected retry can proceed
    await sql`DELETE FROM idempotency_keys WHERE user_id = ${userId} AND idem_key = ${idempotencyKey} AND status = 'in_progress'`.catch(
      () => {}
    );
    const mapped = e instanceof ApiError ? e : mapPgError(e);
    throw mapped ?? e;
  }
}

/** Cancel ≥12 h before start → journey returns to ELIGIBLE, slot reopens. */
export async function cancelBooking(params: {
  userId: string;
  studentId: string;
  bookingId: string;
}): Promise<{ ok: true }> {
  const { userId, studentId, bookingId } = params;
  try {
    return await sql.begin(async (tx) => {
      const b = (
        await tx<{ id: string; journey_id: string; slot_id: string; start_at: Date; status: string }[]>`
          SELECT id, journey_id, slot_id, start_at, status FROM bookings
          WHERE id = ${bookingId} AND student_id = ${studentId} FOR UPDATE`
      )[0];
      if (!b) throw new ApiError(404, "NOT_FOUND", "Booking not found");
      if (b.status !== "CONFIRMED") throw new ApiError(409, "NOT_CANCELLABLE", "This booking can't be cancelled.");

      const cutoffH = (await tx<{ h: number }[]>`SELECT change_cutoff_hours h FROM season_rules LIMIT 1`)[0].h;
      const ok = (await tx<{ ok: boolean }[]>`
        SELECT ${b.start_at}::timestamptz >= app_now() + make_interval(hours => ${cutoffH}) AS ok`)[0].ok;
      if (!ok) throw new ApiError(422, "CHANGES_CLOSED", "Changes are closed. Report an emergency instead.");

      const j = (await tx<{ changes_count: number }[]>`
        SELECT changes_count FROM interview_journeys WHERE id = ${b.journey_id} FOR UPDATE`)[0];
      if (j.changes_count >= FREE_CHANGES) throw new ApiError(422, "NO_CHANGES_LEFT", "You've used all your free changes. For an emergency, contact Help.");

      await tx`UPDATE interview_slots SET status = 'OPEN' WHERE id = ${b.slot_id}`;
      await tx`UPDATE bookings SET status = 'CANCELLED', updated_at = app_now() WHERE id = ${bookingId}`;
      await transitionJourney(tx, {
        journeyId: b.journey_id,
        action: "cancel",
        reason: "Ready to book",
        actorUserId: userId,
        patch: { changes_count: j.changes_count + 1 },
      });
      return { ok: true as const };
    });
  } catch (e) {
    const mapped = e instanceof ApiError ? e : mapPgError(e);
    throw mapped ?? e;
  }
}

/** Reschedule ≥12 h before, <2 changes. Claims the new slot BEFORE releasing the
 *  old one (so the student is never left with no booking); stays BOOKED. */
export async function rescheduleBooking(params: {
  userId: string;
  studentId: string;
  bookingId: string;
  newStartIso: string;
}): Promise<BookResult> {
  const { studentId, bookingId, newStartIso } = params;
  const newStart = new Date(newStartIso);
  if (isNaN(newStart.getTime())) throw new ApiError(422, "BAD_TIME", "Invalid start time");
  try {
    return await sql.begin(async (tx) => {
      const b = (
        await tx<{ id: string; journey_id: string; slot_id: string; start_at: Date; status: string; student_id: string }[]>`
          SELECT id, journey_id, slot_id, start_at, status, student_id FROM bookings
          WHERE id = ${bookingId} AND student_id = ${studentId} FOR UPDATE`
      )[0];
      if (!b) throw new ApiError(404, "NOT_FOUND", "Booking not found");
      if (b.status !== "CONFIRMED") throw new ApiError(409, "NOT_RESCHEDULABLE", "This booking can't be moved.");

      const jrow = (await tx<{ changes_count: number; track_id: string; badge_level: number; priority_rebook: boolean }[]>`
        SELECT j.changes_count, b.track_id, b.level AS badge_level, j.priority_rebook
        FROM interview_journeys j JOIN badges b ON b.id = j.badge_id
        WHERE j.id = ${b.journey_id} FOR UPDATE OF j`)[0];
      if (jrow.changes_count >= FREE_CHANGES) throw new ApiError(422, "NO_CHANGES_LEFT", "You've used all your changes.");

      const cutoffH = (await tx<{ h: number }[]>`SELECT change_cutoff_hours h FROM season_rules LIMIT 1`)[0].h;
      const windowOk = (await tx<{ ok: boolean }[]>`
        SELECT ${b.start_at}::timestamptz >= app_now() + make_interval(hours => ${cutoffH})
           AND ${newStart}::timestamptz >= app_now() + make_interval(hours => ${cutoffH}) AS ok`)[0].ok;
      if (!windowOk) throw new ApiError(422, "CHANGES_CLOSED", "Changes are closed for this time.");

      const noBadge = !(await tx<{ has: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM student_badges WHERE student_id = ${studentId} AND status='ACTIVE') has`)[0].has;

      // claim the NEW slot first
      const one = await claimSlot(tx, {
        startAt: newStart,
        trackId: jrow.track_id,
        badgeLevel: jrow.badge_level,
        studentId,
        noBadge,
        priority: jrow.priority_rebook,
      });
      const claimed = one ? [one] : [];
      if (claimed.length === 0) {
        const near = await tx<{ start_at: Date }[]>`
          SELECT start_at FROM (SELECT DISTINCT start_at FROM interview_slots WHERE status='OPEN' AND bookable_from<=app_now() AND start_at>app_now()) t
          ORDER BY abs(extract(epoch FROM (start_at - ${newStart}::timestamptz))) LIMIT 3`;
        throw new ApiError(409, "SLOT_TAKEN", "That time was just taken.", { nearest: near.map((n) => n.start_at.toISOString()) });
      }
      const slot = claimed[0];

      // release old slot, point the booking at the new one (stays CONFIRMED)
      await tx`UPDATE interview_slots SET status = 'OPEN' WHERE id = ${b.slot_id}`;
      const code = bookingCode();
      await tx`
        UPDATE bookings
        SET slot_id = ${slot.id}, interviewer_id = ${slot.interviewer_id}, start_at = ${newStart},
            booking_code = ${code}, updated_at = app_now()
        WHERE id = ${bookingId}`;
      await bumpJourney(tx, b.journey_id, { changes_count: jrow.changes_count + 1 });
      await tx`INSERT INTO notifications (student_id, channel, template, payload)
               VALUES (${studentId}, 'IN_APP', 'M2_RESCHEDULED', ${tx.json({ bookingId })})`;

      return { bookingId, journeyId: b.journey_id, startAt: newStartIso, bookingCode: code, interviewerId: slot.interviewer_id };
    });
  } catch (e) {
    const mapped = e instanceof ApiError ? e : mapPgError(e);
    throw mapped ?? e;
  }
}
