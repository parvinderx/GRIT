/**
 * Seed demo data. Resets the simulated clock to the anchor (23 Nov 2026, 12:00
 * IST) so the design doc's sample copy lines up, loads reference data, personas,
 * availability (-> slots), and journeys covering every one of the 11 states.
 *
 *   npm run db:seed
 */
import { customAlphabet } from "nanoid";
import { DateTime } from "luxon";
import { sql, db } from "./index";
import * as s from "./schema";
import { materializeSlots } from "@/services/slots";
import { eq, and, gte, asc } from "drizzle-orm";

const IST = "Asia/Kolkata";
const code6 = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const ist = (iso: string) => DateTime.fromISO(iso, { zone: IST }).toJSDate();
/**
 * The app runs on the real date and time. Persona dates below are written as if
 * "today" were ANCHOR_DAY (23 Nov 2026) and shifted by whole days to the real today
 * (IST), so a seeded "yesterday" is always yesterday and times stay on the slot grid.
 * Season dates (31 Dec deadline, 14 Feb last interview) are real calendar facts and
 * are NOT shifted.
 */
const ANCHOR_DAY = DateTime.fromISO("2026-11-23", { zone: IST }).startOf("day");
const SHIFT_DAYS = Math.round(DateTime.now().setZone(IST).startOf("day").diff(ANCHOR_DAY, "days").days);
const rel = (iso: string) => DateTime.fromISO(iso, { zone: IST }).plus({ days: SHIFT_DAYS }).toJSDate();
const fromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function wipe() {
  // Truncate everything except the migration ledger; RESTART IDENTITY resets serials.
  await sql`
    TRUNCATE
      notifications, approvals, integrity_cases, journey_events, idempotency_keys,
      student_badges, interview_outcomes, bookings, interview_journeys,
      interview_slots, availability_overrides, availability_rules,
      interviewer_conflicts, interviewer_tracks, interviewers,
      student_skill_levels, badge_skill_requirements, badges, tracks, skills,
      students, user_roles, users, season_rules, seasons
    RESTART IDENTITY CASCADE`;
  // Real date and time (demo tools can switch to simulated time and back).
  await sql`UPDATE sim_clock SET mode='REAL', real_offset_seconds=0, updated_at=now() WHERE id=true`;
}

async function main() {
  // `--if-empty` (production start): seed a fresh database once, never wipe real data.
  // FORCE_RESEED=true overrides it for one deploy to reset the demo data; remove it right after.
  if (process.argv.includes("--if-empty") && process.env.FORCE_RESEED !== "true") {
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM users`;
    if (n > 0) {
      console.log(`· seed skipped: database already has ${n} users`);
      await sql.end();
      process.exit(0);
    }
  }
  await wipe();

  // ── season + rules ────────────────────────────────────────────────────────
  const [season] = await db
    .insert(s.seasons)
    .values({
      code: "2026-27",
      deadlineAt: ist("2026-12-31T23:59:59"),
      lastInterviewAt: ist("2027-02-14T21:00:00"),
      seasonEndAt: ist("2027-02-28T23:59:59"),
    })
    .returning();
  await db.insert(s.seasonRules).values({ seasonId: season.id });

  // ── skills ────────────────────────────────────────────────────────────────
  const skillDefs = [
    ["computational-thinking", "Computational Thinking"],
    ["cs-fundamentals", "CS Fundamentals"],
    ["applied-genai", "Applied Gen AI Development"],
    ["ui-engineering", "UI Engineering"],
    ["systems-design", "Systems Design"],
    ["ml-foundations", "ML Foundations"],
    ["robotics-control", "Robotics Control"],
  ];
  const skills = await db
    .insert(s.skills)
    .values(skillDefs.map(([code, name]) => ({ code, name })))
    .returning();
  const skill = (code: string) => skills.find((k) => k.code === code)!;

  // ── tracks + badges ───────────────────────────────────────────────────────
  const trackDefs = [
    ["ai-product", "AI Product Mastery", 0],
    ["ai-systems", "AI Systems Mastery", 1],
    ["ai-models", "AI Models Mastery", 2],
    ["ai-robotics", "AI Robotics Mastery", 3],
  ] as const;
  const tracks = await db
    .insert(s.tracks)
    .values(trackDefs.map(([code, name, sort]) => ({ code, name, sort })))
    .returning();
  const track = (code: string) => tracks.find((t) => t.code === code)!;

  // Novice (L1, 150) + Specialist (L2, 250, prereq Novice) per track.
  const badgeByTrackLevel = new Map<string, typeof s.badges.$inferSelect>();
  for (const t of tracks) {
    const [nov] = await db
      .insert(s.badges)
      .values({
        trackId: t.id,
        level: 1,
        name: "Novice",
        miles: 150,
        requiresProject: t.code === "ai-robotics",
      })
      .returning();
    const [spec] = await db
      .insert(s.badges)
      .values({
        trackId: t.id,
        level: 2,
        name: "Specialist",
        miles: 250,
        prerequisiteBadgeId: nov.id,
      })
      .returning();
    badgeByTrackLevel.set(`${t.code}:1`, nov);
    badgeByTrackLevel.set(`${t.code}:2`, spec);
  }
  const badge = (trackCode: string, level: number) => badgeByTrackLevel.get(`${trackCode}:${level}`)!;

  // requirements: AI Product Novice needs 4 skills (UI Engineering at L2)
  const apNovice = badge("ai-product", 1);
  const apReqs: [string, number][] = [
    ["computational-thinking", 1],
    ["cs-fundamentals", 1],
    ["applied-genai", 1],
    ["ui-engineering", 2],
  ];
  await db.insert(s.badgeSkillRequirements).values(
    apReqs.map(([code, lvl]) => ({ badgeId: apNovice.id, skillId: skill(code).id, minLevel: lvl }))
  );
  // AI Product Specialist: same 4 at higher level
  await db.insert(s.badgeSkillRequirements).values(
    apReqs.map(([code, lvl]) => ({ badgeId: badge("ai-product", 2).id, skillId: skill(code).id, minLevel: lvl + 1 }))
  );
  // AI Systems Novice: 3 skills
  await db.insert(s.badgeSkillRequirements).values(
    [["computational-thinking", 1], ["cs-fundamentals", 1], ["systems-design", 1]].map(
      ([code, lvl]) => ({ badgeId: badge("ai-systems", 1).id, skillId: skill(code as string).id, minLevel: lvl as number })
    )
  );

  // ── users helper ──────────────────────────────────────────────────────────
  let subj = 0;
  async function mkUser(name: string, roles: (typeof s.userRoles.$inferInsert)["role"][]) {
    const [u] = await db
      .insert(s.users)
      .values({ ssoSubject: `sso-${++subj}`, displayName: name, email: `${name.split(" ")[0].toLowerCase()}@example.com` })
      .returning();
    await db.insert(s.userRoles).values(roles.map((role) => ({ userId: u.id, role })));
    return u;
  }
  async function mkStudent(name: string, gritId: string, baseMiles = 0) {
    const u = await mkUser(name, ["STUDENT"]);
    const [st] = await db
      .insert(s.students)
      .values({ userId: u.id, gritId, batch: "2024", section: "A", campus: "Hyderabad", baseMiles, photoKey: "demo" })
      .returning();
    return { user: u, student: st };
  }

  // ── interviewers ──────────────────────────────────────────────────────────
  const priyaU = await mkUser("Priya Sharma", ["INTERVIEWER"]);
  const [priya] = await db.insert(s.interviewers).values({ userId: priyaU.id, displayName: "Priya S.", photoKey: "demo" }).returning();
  const rahulU = await mkUser("Rahul Verma", ["INTERVIEWER"]);
  const [rahul] = await db.insert(s.interviewers).values({ userId: rahulU.id, displayName: "Rahul V.", photoKey: "demo" }).returning();
  const snehaU = await mkUser("Sneha Rao", ["INTERVIEWER"]);
  const [sneha] = await db.insert(s.interviewers).values({ userId: snehaU.id, displayName: "Sneha R.", photoKey: "demo" }).returning();

  // interviewer tracks
  await db.insert(s.interviewerTracks).values([
    { interviewerId: priya.id, trackId: track("ai-product").id, maxBadgeLevel: 2 },
    { interviewerId: priya.id, trackId: track("ai-systems").id, maxBadgeLevel: 1 },
    { interviewerId: rahul.id, trackId: track("ai-product").id, maxBadgeLevel: 2 },
    { interviewerId: sneha.id, trackId: track("ai-systems").id, maxBadgeLevel: 2 },
    { interviewerId: sneha.id, trackId: track("ai-product").id, maxBadgeLevel: 1 },
  ]);

  // availability: every day 09:00-21:00 IST for all three interviewers
  const avail: (typeof s.availabilityRules.$inferInsert)[] = [];
  for (const iv of [priya, rahul, sneha]) {
    for (let wd = 0; wd <= 6; wd++) {
      avail.push({ interviewerId: iv.id, weekday: wd, startLocal: "09:00", endLocal: "21:00" });
    }
  }
  await db.insert(s.availabilityRules).values(avail);

  // ── staff ─────────────────────────────────────────────────────────────────
  await mkUser("Arjun Mehta", ["INTERVIEW_ADMIN"]);
  await mkUser("Kavya Reddy", ["PROGRAM_ADMIN"]);
  await mkUser("Naveen Patel", ["PROGRAM_ADMIN"]);

  // ── build slots from availability ─────────────────────────────────────────
  const created = await materializeSlots();
  console.log(`  materialised ${created} slots`);

  // ── Ravi — the primary persona ────────────────────────────────────────────
  const ravi = await mkStudent("Ravi Teja", "GRIT-2024-0042", 1240);
  // Ravi has cleared AI Product Novice skills (eligible) + AI Systems Novice
  await db.insert(s.studentSkillLevels).values([
    { studentId: ravi.student.id, skillId: skill("computational-thinking").id, level: 2, sourceSeq: 1 },
    { studentId: ravi.student.id, skillId: skill("cs-fundamentals").id, level: 2, sourceSeq: 1 },
    { studentId: ravi.student.id, skillId: skill("applied-genai").id, level: 2, sourceSeq: 1 },
    { studentId: ravi.student.id, skillId: skill("ui-engineering").id, level: 2, sourceSeq: 1 },
    { studentId: ravi.student.id, skillId: skill("systems-design").id, level: 1, sourceSeq: 1 },
  ]);
  // Ravi journeys
  await db.insert(s.interviewJourneys).values([
    { studentId: ravi.student.id, badgeId: apNovice.id, seasonId: season.id, state: "ELIGIBLE", stateReason: "Ready to book" },
    { studentId: ravi.student.id, badgeId: badge("ai-systems", 1).id, seasonId: season.id, state: "ELIGIBLE", stateReason: "Ready to book" },
    { studentId: ravi.student.id, badgeId: badge("ai-product", 2).id, seasonId: season.id, state: "LOCKED", stateReason: "Earn Novice first" },
    { studentId: ravi.student.id, badgeId: badge("ai-models", 1).id, seasonId: season.id, state: "LOCKED", stateReason: "3 skills to go" },
  ]);

  // ── state-coverage personas (one journey each) ────────────────────────────

  async function parkJourney(
    name: string,
    gritId: string,
    state: (typeof s.interviewJourneys.$inferInsert)["state"],
    extra: Partial<typeof s.interviewJourneys.$inferInsert> = {},
    baseMiles = 980
  ) {
    const who = await mkStudent(name, gritId, baseMiles);
    // give them the AP Novice skills so the badge detail renders a full checklist
    await db.insert(s.studentSkillLevels).values(
      apReqs.map(([code, lvl]) => ({ studentId: who.student.id, skillId: skill(code).id, level: lvl, sourceSeq: 1 }))
    );
    const [j] = await db
      .insert(s.interviewJourneys)
      .values({ studentId: who.student.id, badgeId: apNovice.id, seasonId: season.id, state, ...extra })
      .returning();
    return { ...who, journey: j };
  }

  await parkJourney("Ishaan Gupta", "GRIT-2024-0101", "LOCKED", { stateReason: "2 skills to go" });
  const booked = await parkJourney("Meera Pillai", "GRIT-2024-0102", "BOOKED", { stateReason: "Interview scheduled" });
  const awaiting = await parkJourney("Karthik Menon", "GRIT-2024-0103", "AWAITING_RESULT", { stateReason: "Result pending" });
  const passed = await parkJourney("Nikhil Bose", "GRIT-2024-0104", "PASSED", { stateReason: "Badge earned" });
  const pooja = await parkJourney("Pooja Nair", "GRIT-2024-0105", "FAILED", {
    stateReason: "Not cleared", attemptCount: 1, cooldownUntil: rel("2026-12-06T18:00:00"),
  });
  await parkJourney("Divya Shah", "GRIT-2024-0106", "RETAKE_LATER", {
    stateReason: "Retake allowed", cooldownUntil: rel("2026-11-26T12:00:00"),
  });
  await parkJourney("Rohit Das", "GRIT-2024-0107", "NO_SHOW", {
    stateReason: "Missed interview", attemptCount: 1, cooldownUntil: rel("2026-11-30T12:00:00"),
  });
  const held = await parkJourney("Anjali Kaur", "GRIT-2024-0108", "ON_HOLD", {
    stateReason: "Under review", holdPrevState: "AWAITING_RESULT",
  });
  const nullified = await parkJourney("Vikram Singh", "GRIT-2024-0109", "NULLIFIED", { stateReason: "Badge nullified" }, 0);
  await parkJourney("Sana Khan", "GRIT-2024-0110", "CLOSED", { stateReason: "Attempt limit reached", attemptCount: 3 });


  // ── a confirmed BOOKED booking for Meera on Priya's first open slot 3+ days ahead ──
  const meeraSlot =
    (
      await db
        .select()
        .from(s.interviewSlots)
        .where(and(eq(s.interviewSlots.interviewerId, priya.id), eq(s.interviewSlots.status, "OPEN"), gte(s.interviewSlots.startAt, fromNow(3 * 24 * 60))))
        .orderBy(asc(s.interviewSlots.startAt))
        .limit(1)
    )[0] ?? null;
  if (meeraSlot) {
    await db.update(s.interviewSlots).set({ status: "BOOKED" }).where(eq(s.interviewSlots.id, meeraSlot.id));
    await db.insert(s.bookings).values({
      journeyId: booked.journey.id,
      studentId: booked.student.id,
      slotId: meeraSlot.id,
      interviewerId: priya.id,
      startAt: meeraSlot.startAt,
      status: "CONFIRMED",
      bookingCode: code6(),
    });
  }

  // ── awaiting-result booking + unpublished outcome (before/after demo) ──────
  // Interview already happened (yesterday); publish_at is just after the anchor
  // so S6 shows "Result pending" and a clock jump / dev-outcome publishes it.
  const [awaitingSlot] = await db
    .insert(s.interviewSlots)
    .values({
      interviewerId: rahul.id,
      startAt: rel("2026-11-22T19:00:00"),
      bufferEndAt: rel("2026-11-22T19:40:00"),
      status: "BOOKED",
      audience: "ANY",
      bookableFrom: rel("2026-11-08T20:00:00"),
    })
    .returning();
  const [ab] = await db
    .insert(s.bookings)
    .values({
      journeyId: awaiting.journey.id,
      studentId: awaiting.student.id,
      slotId: awaitingSlot.id,
      interviewerId: rahul.id,
      startAt: awaitingSlot.startAt,
      status: "COMPLETED",
      bookingCode: code6(),
      studentJoinedAt: awaitingSlot.startAt,
      interviewerJoinedAt: awaitingSlot.startAt,
    })
    .returning();
  await db.insert(s.interviewOutcomes).values({
    bookingId: ab.id,
    whatHappened: "COMPLETED",
    result: "PASS",
    suggestedResult: "PASS",
    rubric: apReqs.map(([code]) => ({ skill: skill(code).name, score: 3 })),
    recordedBy: rahulU.id,
    submittedAt: fromNow(-10),
    publishAt: fromNow(15),
    reviewStatus: "NONE",
  });

  // ── Aditi: interview done yesterday, result not recorded yet (the "before" state) ──
  // No badge yet (Pre-Qualiflyer, deadline strip), and her Specialist skills are already
  // cleared, so a Pass shows every "after" change: Miles, tier, and Specialist unlocking.
  const aditi = await parkJourney("Aditi Rao", "GRIT-2024-0111", "AWAITING_RESULT", { stateReason: "Result pending" }, 860);
  await db
    .update(s.studentSkillLevels)
    .set({ level: 4 })
    .where(eq(s.studentSkillLevels.studentId, aditi.student.id));
  await db.insert(s.interviewJourneys).values({
    studentId: aditi.student.id,
    badgeId: badge("ai-product", 2).id,
    seasonId: season.id,
    state: "LOCKED",
    stateReason: "Earn Novice first",
  });
  const [aditiSlot] = await db
    .insert(s.interviewSlots)
    .values({
      interviewerId: sneha.id,
      startAt: rel("2026-11-22T17:00:00"),
      bufferEndAt: rel("2026-11-22T17:40:00"),
      status: "BOOKED",
      audience: "ANY",
      bookableFrom: rel("2026-11-08T20:00:00"),
    })
    .returning();
  await db.insert(s.bookings).values({
    journeyId: aditi.journey.id,
    studentId: aditi.student.id,
    slotId: aditiSlot.id,
    interviewerId: sneha.id,
    startAt: aditiSlot.startAt,
    status: "COMPLETED",
    bookingCode: code6(),
    studentJoinedAt: aditiSlot.startAt,
    codeVerifiedAt: aditiSlot.startAt,
    interviewerJoinedAt: aditiSlot.startAt,
  });

  // ── passed student: award the badge ───────────────────────────────────────
  await db.insert(s.studentBadges).values({
    studentId: passed.student.id,
    badgeId: apNovice.id,
    awardedAt: rel("2026-11-20T19:00:00"),
    status: "ACTIVE",
    miles: 150,
  });

  // ── nullified student: a confirmed case + nullified badge + approvals ─────
  const [kavya] = await db.select().from(s.users).where(eq(s.users.displayName, "Kavya Reddy")).limit(1);
  const [naveen] = await db.select().from(s.users).where(eq(s.users.displayName, "Naveen Patel")).limit(1);
  const [nullCase] = await db
    .insert(s.integrityCases)
    .values({
      code: "IC-0412",
      subjectType: "STUDENT",
      subjectStudentId: nullified.student.id,
      status: "CONFIRMED",
      openedBy: kavya.id,
      decidedBy: kavya.id,
      cosignedBy: naveen.id,
      reason: "Impersonation confirmed at contest",
      decidedAt: rel("2026-11-21T10:00:00"),
    })
    .returning();
  await db.insert(s.studentBadges).values({
    studentId: nullified.student.id,
    badgeId: apNovice.id,
    awardedAt: rel("2026-11-18T19:00:00"),
    status: "NULLIFIED",
    miles: 150,
    caseId: nullCase.id,
  });

  // ── held student: a triage case ───────────────────────────────────────────
  await db.insert(s.integrityCases).values({
    code: "IC-0418",
    subjectType: "STUDENT",
    subjectStudentId: held.student.id,
    status: "TRIAGE",
    openedBy: kavya.id,
    reason: "Flag raised by contest system",
  });

  // ── a few pending approvals for the queue (A4) ────────────────────────────
  const [arjun] = await db.select().from(s.users).where(eq(s.users.displayName, "Arjun Mehta")).limit(1);
  // Pooja's failed interview (23 Nov, Sneha), published, so a result change has something to change.
  const [poojaSlot] = await db
    .insert(s.interviewSlots)
    .values({
      interviewerId: sneha.id,
      startAt: rel("2026-11-22T18:00:00"),
      bufferEndAt: rel("2026-11-22T18:40:00"),
      status: "BOOKED",
      audience: "ANY",
      bookableFrom: rel("2026-11-09T20:00:00"),
    })
    .returning();
  const [poojaBk] = await db
    .insert(s.bookings)
    .values({
      journeyId: pooja.journey.id,
      studentId: pooja.student.id,
      slotId: poojaSlot.id,
      interviewerId: sneha.id,
      startAt: poojaSlot.startAt,
      status: "COMPLETED",
      bookingCode: code6(),
      studentJoinedAt: poojaSlot.startAt,
      interviewerJoinedAt: poojaSlot.startAt,
    })
    .returning();
  const [poojaOutcome] = await db
    .insert(s.interviewOutcomes)
    .values({
      bookingId: poojaBk.id,
      whatHappened: "COMPLETED",
      result: "FAIL",
      suggestedResult: "FAIL",
      rubric: apReqs.map(([code]) => ({ skill: skill(code).name, score: 2 })),
      feedbackToStudent:
        "You explained your approach clearly, but the edge cases in the second problem were missed. Practise walking through boundary inputs before coding.",
      focusAreas: ["Edge cases", "Testing your own code"],
      recordedBy: snehaU.id,
      submittedAt: rel("2026-11-22T18:50:00"),
      publishAt: rel("2026-11-22T19:05:00"),
      lockedAt: rel("2026-11-22T19:05:00"),
      reviewStatus: "RELEASED",
    })
    .returning();

  // Each request carries what its approval needs to take effect (services/approvals.ts).
  const [rohit] = await db
    .select({ id: s.interviewJourneys.id })
    .from(s.interviewJourneys)
    .innerJoin(s.students, eq(s.students.id, s.interviewJourneys.studentId))
    .where(eq(s.students.gritId, "GRIT-2024-0107"))
    .limit(1);
  const meeraBooking = meeraSlot
    ? (await db.select({ id: s.bookings.id }).from(s.bookings).where(eq(s.bookings.slotId, meeraSlot.id)).limit(1))[0]
    : null;
  await db.insert(s.approvals).values([
    { action: "COOLDOWN_OVERRIDE", requestedBy: arjun.id, journeyId: rohit.id, reason: "Medical emergency, documented", payload: {} },
    {
      action: "RESULT_AMENDMENT",
      requestedBy: arjun.id,
      journeyId: pooja.journey.id,
      interviewerId: sneha.id,
      reason: "Rubric entered against the wrong student; the interviewer's notes support a Retake later",
      payload: { outcomeId: poojaOutcome.id, newResult: "RETAKE_LATER" },
    },
    ...(meeraBooking
      ? [
          {
            action: "EMERGENCY_WAIVER" as const,
            requestedBy: booked.user.id,
            journeyId: booked.journey.id,
            reason: "Family emergency",
            payload: { bookingId: meeraBooking.id },
          },
        ]
      : []),
  ]);

  console.log("✓ seed complete");
  await sql.end();
  // Drizzle's pool (src/db/index.ts) stays open otherwise and the process never exits.
  process.exit(0);
}

main().catch(async (e) => {
  console.error("Seed failed:", e);
  await sql.end();
  process.exit(1);
});
