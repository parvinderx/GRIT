/**
 * Demo story engine (dev tools only). Every action drives Ravi Teja's AI Product
 * Mastery Novice journey through the real services (booking, join, outcome,
 * publisher, integrity decisions), so every screen shows real state. The only
 * hand-written state change is the reset, done in one transaction.
 *
 * Each action has two modes:
 *   do    perform it, then show the result as the right person
 *   show  set up the moment (clock, persona) and open the page so you can do it yourself
 */
import { randomUUID } from "crypto";
import { sql } from "@/db";
import { ApiError } from "@/lib/errors";
import { serverNow, setClockAbsolute, setClockReal } from "@/lib/clock";
import { toIST } from "@/lib/time";
import { bookInterview, cancelBooking, rescheduleBooking } from "./booking";
import { studentJoin } from "./join";
import { submitOutcome, getOutcomeForm } from "./interviewerView";
import { runTick } from "./jobs";
import { materializeSlots } from "./slots";
import { confirmCase, dismissCase } from "./integrity";
import { reportEmergency, reportInterviewerAbsent } from "./bookingReports";
import type { StoryAction, StoryFacts } from "@/lib/demoStorySteps";

const STUDENT = "Ravi Teja";
const ADMIN = "Kavya Reddy";

/** Ravi's journeys go back to exactly what the seed creates. */
const SEED_STATES: Record<string, { state: string; reason: string }> = {
  "ai-product:1": { state: "ELIGIBLE", reason: "Ready to book" },
  "ai-systems:1": { state: "ELIGIBLE", reason: "Ready to book" },
  "ai-product:2": { state: "LOCKED", reason: "Earn Novice first" },
  "ai-models:1": { state: "LOCKED", reason: "3 skills to go" },
};

const FEEDBACK = {
  FAIL: "You found a working approach to the task, but found it hard to explain the time complexity and how state changes re-render the UI. Revisit recursion basics and component state, then talk through your reasoning out loud.",
  RETAKE_LATER:
    "This was close. Your design reasoning was clear, but the connection dropped twice and we lost the last ten minutes. Book again after the short wait and walk me through the caching question from the start.",
} as const;

const when = (d: Date | string) => `${toIST(d).toFormat("ccc d LLL, h:mm a")} IST`;
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

// ── who's who ────────────────────────────────────────────────────────────────

interface Cast {
  studentId: string;
  studentUserId: string;
  gritId: string;
  journeyId: string;
  adminUserId: string;
}

async function cast(): Promise<Cast> {
  const r = (
    await sql<{ student_id: string; user_id: string; grit_id: string; journey_id: string }[]>`
      SELECT s.id student_id, u.id user_id, s.grit_id, j.id journey_id
      FROM students s
      JOIN users u ON u.id = s.user_id
      JOIN interview_journeys j ON j.student_id = s.id
      JOIN badges b ON b.id = j.badge_id
      JOIN tracks t ON t.id = b.track_id
      WHERE u.display_name = ${STUDENT} AND t.code = 'ai-product' AND b.level = 1
      LIMIT 1`
  )[0];
  if (!r) throw new ApiError(404, "NO_CAST", "Ravi Teja isn't in the database. Run npm run db:seed.");
  const admin = (await sql<{ id: string }[]>`SELECT id FROM users WHERE display_name = ${ADMIN} LIMIT 1`)[0];
  if (!admin) throw new ApiError(404, "NO_CAST", "Kavya Reddy isn't in the database. Run npm run db:seed.");
  return { studentId: r.student_id, studentUserId: r.user_id, gritId: r.grit_id, journeyId: r.journey_id, adminUserId: admin.id };
}

interface Booking {
  id: string;
  start: Date;
  code: string;
  joined: boolean;
  ivId: string;
  ivUserId: string;
  ivName: string;
  publishAt: Date | null;
  result: string | null;
  reviewStatus: string | null;
}

/** The latest live-or-finished booking on Ravi's journey (cancelled and called-off ones are skipped). */
async function latestBooking(journeyId: string): Promise<Booking | null> {
  const b = (
    await sql<
      {
        id: string;
        start_at: Date;
        booking_code: string;
        student_joined_at: Date | null;
        iv_id: string;
        iv_user: string;
        iv_name: string;
        publish_at: Date | null;
        result: string | null;
        review_status: string | null;
      }[]
    >`
      SELECT bk.id, bk.start_at, bk.booking_code, bk.student_joined_at, iv.id iv_id, iv.user_id iv_user, ivu.display_name iv_name,
             o.publish_at, o.result, o.review_status
      FROM bookings bk
      JOIN interviewers iv ON iv.id = bk.interviewer_id
      JOIN users ivu ON ivu.id = iv.user_id
      LEFT JOIN interview_outcomes o ON o.booking_id = bk.id
      WHERE bk.journey_id = ${journeyId} AND bk.status NOT IN ('CANCELLED','CANCELLED_LATE','VOID')
      ORDER BY bk.created_at DESC LIMIT 1`
  )[0];
  if (!b) return null;
  return {
    id: b.id,
    start: b.start_at,
    code: b.booking_code,
    joined: !!b.student_joined_at,
    ivId: b.iv_id,
    ivUserId: b.iv_user,
    ivName: b.iv_name,
    publishAt: b.publish_at,
    result: b.result,
    reviewStatus: b.review_status,
  };
}

async function journey(journeyId: string) {
  return (await sql<{ state: string; cooldown_until: Date | null }[]>`
    SELECT state, cooldown_until FROM interview_journeys WHERE id = ${journeyId}`)[0];
}

export async function storyFacts(): Promise<StoryFacts> {
  const c = await cast();
  const [now, j, b] = await Promise.all([serverNow(), journey(c.journeyId), latestBooking(c.journeyId)]);
  return { clockIso: now.toISOString(), journeyState: j.state, interviewerName: b?.ivName ?? null, bookingId: b?.id ?? null };
}

// ── time ─────────────────────────────────────────────────────────────────────

/** Move the simulated clock forward to `target` (never backwards), then run the scheduled jobs. */
async function moveTo(target: Date): Promise<Date> {
  const now = await serverNow();
  const to = target.getTime() > now.getTime() ? target : now;
  await setClockAbsolute(to.toISOString());
  await runTick();
  return to;
}

/** The interviewer opens the room (the T+15 attendance check needs them present). */
async function ivJoins(bookingId: string) {
  await sql`UPDATE bookings SET interviewer_joined_at = COALESCE(interviewer_joined_at, LEAST(app_now(), start_at))
            WHERE id = ${bookingId} AND status IN ('CONFIRMED','IN_PROGRESS')`;
}

async function rules() {
  return (
    await sql<{ slot_duration_minutes: number; attendance_check_minutes: number; interviewer_absent_minutes: number }[]>`
      SELECT slot_duration_minutes, attendance_check_minutes, interviewer_absent_minutes FROM season_rules LIMIT 1`
  )[0];
}

// ── reset ────────────────────────────────────────────────────────────────────

async function reset(c: Cast) {
  await sql.begin(async (tx) => {
    // ALTER TABLE is transactional in Postgres: if anything below fails, the triggers come back on.
    await tx`ALTER TABLE interview_journeys DISABLE TRIGGER trg_enforce_journey_transition`;
    await tx`ALTER TABLE journey_events DISABLE TRIGGER trg_journey_events_append_only`;

    // Badges point at outcomes, so they go before the bookings (whose outcomes cascade).
    await tx`DELETE FROM student_badges WHERE student_id = ${c.studentId}`;
    // Story-made integrity cases and approvals about Ravi.
    await tx`DELETE FROM integrity_cases WHERE subject_student_id = ${c.studentId}`;
    await tx`DELETE FROM approvals WHERE journey_id IN (SELECT id FROM interview_journeys WHERE student_id = ${c.studentId})`;
    const bookings = await tx<{ id: string; slot_id: string }[]>`SELECT id, slot_id FROM bookings WHERE student_id = ${c.studentId}`;
    const slotIds = bookings.map((b) => b.slot_id);
    if (bookings.length) {
      await tx`DELETE FROM bookings WHERE student_id = ${c.studentId}`;
      // Only slots no other booking still points at (another student may have taken one since).
      await tx`
        DELETE FROM interview_slots s
        WHERE s.id = ANY(${slotIds}) AND s.status = 'CANCELLED'
          AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.slot_id = s.id)`;
      await tx`
        UPDATE interview_slots s SET status = 'OPEN'
        WHERE s.id = ANY(${slotIds}) AND s.status = 'BOOKED'
          AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.slot_id = s.id)`;
    }
    await tx`DELETE FROM journey_events WHERE journey_id IN (SELECT id FROM interview_journeys WHERE student_id = ${c.studentId})`;
    await tx`DELETE FROM notifications WHERE student_id = ${c.studentId}`;
    await tx`DELETE FROM idempotency_keys WHERE user_id = ${c.studentUserId}`;

    const js = await tx<{ id: string; key: string }[]>`
      SELECT j.id, t.code || ':' || b.level AS key
      FROM interview_journeys j JOIN badges b ON b.id = j.badge_id JOIN tracks t ON t.id = b.track_id
      WHERE j.student_id = ${c.studentId}`;
    for (const j of js) {
      const seed = SEED_STATES[j.key] ?? { state: "LOCKED", reason: "Locked" };
      await tx`
        UPDATE interview_journeys
        SET state = ${seed.state}::journey_state, state_reason = ${seed.reason}, attempt_count = 0, changes_count = 0,
            cooldown_until = NULL, priority_rebook = false, hold_prev_state = NULL, version = version + 1
        WHERE id = ${j.id}`;
    }

    await tx`ALTER TABLE journey_events ENABLE TRIGGER trg_journey_events_append_only`;
    await tx`ALTER TABLE interview_journeys ENABLE TRIGGER trg_enforce_journey_transition`;
  });
  // Stories start from the real present; later steps jump forward and the clock keeps running.
  await setClockReal();
  await materializeSlots();
}

// ── building blocks ──────────────────────────────────────────────────────────

/** Tries open times from `from` onwards until the real booking (or reschedule) rules accept one. */
async function firstAccepted<T>(from: Date, attempt: (startIso: string) => Promise<T>): Promise<T> {
  const candidates = await sql<{ start_at: Date }[]>`
    SELECT DISTINCT s.start_at FROM interview_slots s
    JOIN interviewer_tracks it ON it.interviewer_id = s.interviewer_id
    JOIN tracks t ON t.id = it.track_id AND t.code = 'ai-product'
    WHERE s.status = 'OPEN' AND s.start_at >= ${from}
    ORDER BY s.start_at LIMIT 12`;
  if (!candidates.length) throw new ApiError(409, "STORY_ORDER", "There are no open times left. Start the story over, or reseed the database.");
  let lastError: unknown = null;
  for (const cand of candidates) {
    try {
      return await attempt(cand.start_at.toISOString());
    } catch (e) {
      lastError = e;
      if (!(e instanceof ApiError) || e.status >= 500) throw e;
    }
  }
  throw lastError;
}

async function book(c: Cast) {
  return firstAccepted(minutes(await serverNow(), 24 * 60), (startAtIso) =>
    bookInterview({ userId: c.studentUserId, studentId: c.studentId, journeyId: c.journeyId, startAtIso, idempotencyKey: randomUUID() })
  );
}

type Recorded = "PASS" | "FAIL" | "RETAKE_LATER" | "FACE_MISMATCH" | "PLATFORM" | "UNFAIR";

async function record(b: Booking, what: Recorded) {
  if (what === "PLATFORM" || what === "UNFAIR") {
    return submitOutcome({
      interviewerId: b.ivId,
      userId: b.ivUserId,
      bookingId: b.id,
      whatHappened: what,
      result: null,
      rubric: [],
      internalNotes:
        what === "PLATFORM"
          ? "I couldn't join: my connection failed and the call never started."
          : "The video kept freezing halfway through, so the second half couldn't be assessed fairly.",
    });
  }
  const form = await getOutcomeForm(b.id, b.ivId);
  const result = what === "FACE_MISMATCH" ? "PASS" : what;
  const pass = result === "PASS";
  return submitOutcome({
    interviewerId: b.ivId,
    userId: b.ivUserId,
    bookingId: b.id,
    whatHappened: "COMPLETED",
    result,
    rubric: form.skills.map((skill) => ({ skill, score: pass ? 3 : 2 })),
    feedback: pass ? "Clear reasoning throughout. You explained trade-offs before writing code." : FEEDBACK[result],
    focusAreas: pass ? [] : form.skills.slice(0, 2),
    internalNotes: what === "FACE_MISMATCH" ? "The face on camera didn't look like the registered photo or the college ID he showed." : undefined,
    faceMatched: what !== "FACE_MISMATCH",
    codeMatched: true,
  });
}

async function latestCaseId(c: Cast): Promise<string | null> {
  return (
    (await sql<{ id: string }[]>`
      SELECT id FROM integrity_cases WHERE subject_student_id = ${c.studentId} ORDER BY created_at DESC LIMIT 1`)[0]?.id ?? null
  );
}

async function interviewerName(interviewerId: string) {
  return (await sql<{ n: string }[]>`SELECT u.display_name n FROM interviewers i JOIN users u ON u.id = i.user_id WHERE i.id = ${interviewerId}`)[0]?.n;
}

// ── actions ──────────────────────────────────────────────────────────────────

export interface StoryResult {
  message: string;
  userId: string;
  redirect: string;
}

const need = (cond: unknown, msg: string): void => {
  if (!cond) throw new ApiError(409, "STORY_ORDER", msg);
};

export async function runStoryAction(action: StoryAction, mode: "do" | "show"): Promise<StoryResult> {
  const c = await cast();
  const show = mode === "show";
  const student = (message: string, redirect: string): StoryResult => ({ message, userId: c.studentUserId, redirect });
  const admin = (message: string, redirect: string): StoryResult => ({ message, userId: c.adminUserId, redirect });

  if (action === "reset") {
    await reset(c);
    return student(`Story reset. Ravi can book, and the clock is set to now (${when(await serverNow())}). "Back to real time" in Free play returns to the live clock.`, "/home");
  }

  const r = await rules();
  const j = await journey(c.journeyId);
  const b = await latestBooking(c.journeyId);
  const booked = j.state === "BOOKED" && !!b;
  const needBooking = () => need(booked, "Ravi needs a booked interview first. Do the booking step.");
  const iv = (message: string, redirect: string): StoryResult => ({ message, userId: b!.ivUserId, redirect });

  switch (action) {
    case "book": {
      need(j.state === "ELIGIBLE", "Ravi can't book right now. Start the story over.");
      if (show) return student("You're Ravi. Pick a day and time, tick the box and confirm.", `/book/${c.journeyId}`);
      const res = await book(c);
      return student(
        `Ravi booked ${when(res.startAt)} with ${(await interviewerName(res.interviewerId)) ?? "an interviewer"}. His booking code is ${res.bookingCode}.`,
        `/booked/${res.bookingId}`
      );
    }

    case "wait": {
      needBooking();
      const to = await moveTo(minutes(b!.start, -120));
      return student(`Clock moved to ${when(to)}. The interview is two hours away; the home page counts down.`, "/home");
    }

    case "joinRight": {
      needBooking();
      const to = await moveTo(minutes(b!.start, -5));
      if (show) {
        return student(`Clock moved to ${when(to)}. You're Ravi: tick the four checks and join.`, `/interview/${b!.id}`);
      }
      await studentJoin(b!.id, c.studentId);
      return student(`Clock moved to ${when(to)}. Ravi joined; his booking code ${b!.code} is on screen to read out.`, `/interview/${b!.id}`);
    }

    case "interviewer": {
      need(b, "There's no booked interview yet.");
      return iv(`You're now ${b!.ivName}. Today shows the live interview with Ravi; open the room from there.`, "/schedule");
    }

    case "recordPass":
    case "recordFail":
    case "recordRetake":
    case "recordFaceMismatch":
    case "recordPlatform":
    case "recordUnfair": {
      need(b, "There's no interview to record.");
      need(!b!.result && !b!.publishAt, "An outcome is already recorded for this interview.");
      const platform = action === "recordPlatform" || action === "recordUnfair";
      if (!platform) need(b!.joined, "Ravi hasn't joined yet. Do the join step first.");
      await ivJoins(b!.id);
      const to = await moveTo(minutes(b!.start, platform ? r.interviewer_absent_minutes + 3 : r.slot_duration_minutes + 5));
      if (show) return iv(`Clock moved to ${when(to)}. You're ${b!.ivName}: fill in the outcome form.`, `/outcome/${b!.id}`);
      const what: Recorded =
        action === "recordPass"
          ? "PASS"
          : action === "recordFail"
            ? "FAIL"
            : action === "recordRetake"
              ? "RETAKE_LATER"
              : action === "recordFaceMismatch"
                ? "FACE_MISMATCH"
                : action === "recordPlatform"
                  ? "PLATFORM"
                  : "UNFAIR";
      const res = await record(b!, what);
      const msg =
        what === "FACE_MISMATCH"
          ? `${b!.ivName} recorded a Pass with "Face doesn't match". The result is held and a case opened for the interview team.`
          : platform
            ? `${b!.ivName} recorded "${what === "PLATFORM" ? "Couldn't happen" : "Couldn't finish fairly"}". No attempt used; Ravi gets priority rebooking.`
            : `${b!.ivName} recorded "${what === "PASS" ? "Pass" : what === "FAIL" ? "Fail" : "Retake later"}". It publishes at ${
                res.publishAtIso ? when(res.publishAtIso) : "the end of the edit window"
              }.`;
      return iv(msg, `/schedule?done=${b!.id}`);
    }

    case "editToPass": {
      const now = await serverNow();
      need(b?.result && b.reviewStatus === "NONE" && b.publishAt && b.publishAt > now, "There's no outcome inside its edit window to change.");
      if (show) return iv(`You're ${b!.ivName}: change the result to Pass and save, before ${when(b!.publishAt!)}.`, `/outcome/${b!.id}`);
      await record(b!, "PASS");
      return iv(`${b!.ivName} changed the result to Pass. It still publishes at ${when(b!.publishAt!)}.`, `/schedule?done=${b!.id}`);
    }

    case "publish": {
      need(b?.publishAt, "No outcome is waiting to publish. Record the outcome first.");
      need(b!.reviewStatus !== "WITHHELD", "This result is held for review, so it won't publish until the case is decided.");
      const to = await moveTo(minutes(b!.publishAt!, 1));
      return student(`Clock moved to ${when(to)}. The result published.`, `/result/${c.journeyId}`);
    }

    case "checkHeld": {
      need(b?.publishAt, "Record the outcome first.");
      const to = await moveTo(minutes(b!.publishAt!, 1));
      return student(`Clock moved to ${when(to)}, past the usual publish time. The result is still held, so Ravi sees "Result pending".`, "/home");
    }

    case "seeResult": {
      const final = ["PASSED", "FAILED", "RETAKE_LATER", "NO_SHOW", "CLOSED"].includes(j.state);
      return student("You're Ravi.", final ? `/result/${c.journeyId}` : "/home");
    }

    case "cooldown": {
      need(j.cooldown_until, "Ravi isn't waiting to retry. This step comes after a result that didn't clear, or a missed interview.");
      const to = await moveTo(minutes(j.cooldown_until!, 1));
      return student(`Clock moved to ${when(to)}. The wait is over and Ravi can book again.`, "/home");
    }

    case "noshow": {
      needBooking();
      need(!b!.joined, "Ravi already joined. Start over to try this.");
      await ivJoins(b!.id); // the interviewer was there and waited
      const to = await moveTo(minutes(b!.start, r.attendance_check_minutes + 1));
      return student(`Clock moved to ${when(to)}. Ravi never joined, so the attendance check counted it as missed.`, "/home");
    }

    case "reportAbsent": {
      needBooking();
      need(b!.joined, "Ravi has to join first.");
      const to = await moveTo(minutes(b!.start, r.interviewer_absent_minutes + 1));
      if (show) return student(`Clock moved to ${when(to)}. You're Ravi: press "My interviewer hasn't joined".`, `/interview/${b!.id}`);
      const rep = await reportInterviewerAbsent({ bookingId: b!.id, studentId: c.studentId });
      return student(
        rep.swapped
          ? `Clock moved to ${when(to)}. Ravi reported that the interviewer hadn't joined, and someone free at the same time was swapped in.`
          : `Clock moved to ${when(to)}. Ravi reported that the interviewer hasn't joined. Nobody else is free, so at 15 minutes past the start it's called off with a priority rebook.`,
        `/interview/${b!.id}`
      );
    }

    case "absentTimeout": {
      needBooking();
      const to = await moveTo(minutes(b!.start, r.attendance_check_minutes + 1));
      return student(
        `Clock moved to ${when(to)}. No interviewer joined by 15 minutes past the start, so the interview was called off. No attempt used; Ravi gets priority rebooking.`,
        "/home"
      );
    }

    case "reschedule": {
      needBooking();
      if (show) return student("You're Ravi: press 'Change the time' and pick a new one.", `/interview/${b!.id}`);
      const res = await firstAccepted(minutes(b!.start, 24 * 60), (newStartIso) =>
        rescheduleBooking({ userId: c.studentUserId, studentId: c.studentId, bookingId: b!.id, newStartIso })
      );
      return student(`Ravi moved his interview to ${when(res.startAt)}. One free change used, one left.`, `/booked/${res.bookingId}`);
    }

    case "cancel": {
      needBooking();
      if (show) return student("You're Ravi: press 'Cancel booking' and confirm.", `/interview/${b!.id}`);
      await cancelBooking({ userId: c.studentUserId, studentId: c.studentId, bookingId: b!.id });
      return student("Ravi cancelled. It doesn't count as an attempt, and he can book again.", "/home");
    }

    case "toUnder12h": {
      needBooking();
      const to = await moveTo(minutes(b!.start, -6 * 60));
      return student(`Clock moved to ${when(to)}. Six hours to go: changes are closed.`, `/interview/${b!.id}`);
    }

    case "reportEmergency": {
      needBooking();
      const to = await moveTo(minutes(b!.start, -6 * 60));
      if (show) return student(`Clock moved to ${when(to)}. You're Ravi: press "Report an emergency" and say what happened.`, `/interview/${b!.id}`);
      await reportEmergency({
        bookingId: b!.id,
        studentId: c.studentId,
        userId: c.studentUserId,
        reason: "Family emergency: travelling to hospital with my father this afternoon.",
      });
      return student("Ravi reported an emergency. It's waiting for the interview team in Approvals.", `/interview/${b!.id}`);
    }

    case "openApprovals":
      return admin("You're Kavya Reddy (Program Admin). The emergency waiver is in the list.", "/approvals");

    case "openCase": {
      const id = await latestCaseId(c);
      need(id, "No case is open for Ravi. Record the face mismatch first.");
      return admin("You're Kavya Reddy (Program Admin). This case opened automatically when the result was held.", `/cases/${id}`);
    }

    case "adminDismiss":
    case "adminConfirm": {
      const id = await latestCaseId(c);
      need(id, "No case is open for Ravi. Record the face mismatch first.");
      if (show) return admin("You're Kavya Reddy: choose a decision, write a note and send it.", `/cases/${id}`);
      if (action === "adminDismiss") {
        await dismissCase({
          caseId: id!,
          actorUserId: c.adminUserId,
          note: "Checked the college ID photo again with the interviewer: it is the same student. Releasing the result.",
        });
        return admin("Kavya dismissed the case. The held Pass was released and published to Ravi.", `/cases/${id}`);
      }
      await confirmCase({
        caseId: id!,
        actorUserId: c.adminUserId,
        decision: "nullify",
        note: "Compared the recording with the registered photo and college ID: a different person took this interview.",
        confirmId: c.gritId,
      });
      return admin("Kavya confirmed the case. The interview counts as Not cleared: 1 attempt used, 14-day wait.", `/cases/${id}`);
    }

    case "failThreeTimes": {
      need(j.state === "ELIGIBLE", "Start the story over first.");
      const log: string[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await book(c);
        const bk = (await latestBooking(c.journeyId))!;
        await moveTo(minutes(bk.start, -5));
        await studentJoin(bk.id, c.studentId);
        await ivJoins(bk.id);
        await moveTo(minutes(bk.start, r.slot_duration_minutes + 5));
        await record(bk, "FAIL");
        const after = (await latestBooking(c.journeyId))!;
        await moveTo(minutes(after.publishAt!, 1));
        log.push(`attempt ${attempt} on ${toIST(res.startAt).toFormat("d LLL")}`);
        const s = await journey(c.journeyId);
        if (s.state !== "FAILED") break;
        await moveTo(minutes(s.cooldown_until!, 1));
      }
      const end = await journey(c.journeyId);
      return student(
        `Not cleared three times (${log.join(", ")}). ${end.state === "CLOSED" ? "Booking for this badge is now closed." : `The journey is now ${end.state}.`}`,
        "/home"
      );
    }

    case "pastDeadline": {
      const s = (await sql<{ deadline_at: Date }[]>`SELECT deadline_at FROM seasons ORDER BY deadline_at DESC LIMIT 1`)[0];
      const to = await moveTo(minutes(s.deadline_at, 5));
      return student(`Clock moved to ${when(to)}, past the season deadline. Without a badge, booking is closed.`, "/home");
    }
  }
  throw new ApiError(400, "BAD_STEP", "Unknown story step");
}
