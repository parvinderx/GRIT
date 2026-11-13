/**
 * Contest-data sync (spec section 1: LOCKED <-> ELIGIBLE follows cleared skills).
 * The contest system pushes a student's skill levels with a sequence number; older
 * or repeated pushes are ignored per skill (source_seq). After the upsert, each of
 * the student's journeys is re-evaluated: LOCKED -> ELIGIBLE when every required
 * skill is cleared, ELIGIBLE -> LOCKED when one no longer is. Other states are
 * left alone (a booked interview still goes ahead).
 */
import { sql } from "@/db";
import { ApiError } from "@/lib/errors";
import { transitionJourney } from "./journeys";

type Tx = Parameters<typeof transitionJourney>[0];

/**
 * LOCKED -> ELIGIBLE when every required skill is cleared and any prerequisite badge
 * is earned. Shared by the skill sync and by a Pass (which may satisfy a higher
 * badge's prerequisite). Caller holds the journey row lock. Returns true if unlocked.
 */
export async function unlockIfReady(tx: Tx, journeyId: string, payload: Record<string, unknown> = {}): Promise<boolean> {
  const r = (await tx<{ state: string; ready: boolean; prereq_ok: boolean }[]>`
    SELECT j.state,
           NOT EXISTS (
             SELECT 1 FROM badge_skill_requirements r
             LEFT JOIN student_skill_levels sl ON sl.student_id = j.student_id AND sl.skill_id = r.skill_id
             WHERE r.badge_id = j.badge_id AND (sl.level IS NULL OR sl.level < r.min_level)
           ) ready,
           (b.prerequisite_badge_id IS NULL OR EXISTS (
             SELECT 1 FROM student_badges sb
             WHERE sb.student_id = j.student_id AND sb.badge_id = b.prerequisite_badge_id AND sb.status = 'ACTIVE'
           )) prereq_ok
    FROM interview_journeys j JOIN badges b ON b.id = j.badge_id
    WHERE j.id = ${journeyId}`)[0];
  if (!r || r.state !== "LOCKED" || !r.ready || !r.prereq_ok) return false;
  await transitionJourney(tx, { journeyId, action: "unlock", reason: "Ready to book", payload });
  return true;
}

export interface SkillLevel {
  skillCode: string;
  level: number;
}

export async function syncSkills(o: { gritId: string; levels: SkillLevel[]; seq: number }): Promise<{ updated: number; unlocked: number; locked: number }> {
  if (!Number.isInteger(o.seq) || o.seq < 0) throw new ApiError(422, "BAD_SEQ", "seq must be a non-negative integer.");
  return sql.begin(async (tx) => {
    const st = (await tx<{ id: string }[]>`SELECT id FROM students WHERE grit_id = ${o.gritId}`)[0];
    if (!st) throw new ApiError(404, "NOT_FOUND", "Unknown student.");
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"skills:" + st.id}))`;

    let updated = 0;
    for (const l of o.levels) {
      if (!Number.isInteger(l.level) || l.level < 0) throw new ApiError(422, "BAD_LEVEL", `Bad level for ${l.skillCode}.`);
      const sk = (await tx<{ id: string }[]>`SELECT id FROM skills WHERE code = ${l.skillCode}`)[0];
      if (!sk) throw new ApiError(422, "UNKNOWN_SKILL", `Unknown skill ${l.skillCode}.`);
      const r = await tx`
        INSERT INTO student_skill_levels (student_id, skill_id, level, source_seq)
        VALUES (${st.id}, ${sk.id}, ${l.level}, ${o.seq})
        ON CONFLICT (student_id, skill_id) DO UPDATE SET level = EXCLUDED.level, source_seq = EXCLUDED.source_seq
        WHERE student_skill_levels.source_seq < EXCLUDED.source_seq`;
      updated += r.count;
    }

    const journeys = await tx<{ id: string; state: string; ready: boolean }[]>`
      SELECT j.id, j.state,
             NOT EXISTS (
               SELECT 1 FROM badge_skill_requirements r
               LEFT JOIN student_skill_levels sl ON sl.student_id = j.student_id AND sl.skill_id = r.skill_id
               WHERE r.badge_id = j.badge_id AND (sl.level IS NULL OR sl.level < r.min_level)
             ) ready
      FROM interview_journeys j
      WHERE j.student_id = ${st.id} AND j.state IN ('LOCKED','ELIGIBLE')
      ORDER BY j.id FOR UPDATE`;
    let unlocked = 0;
    let locked = 0;
    for (const j of journeys) {
      if (j.state === "LOCKED" && j.ready) {
        if (await unlockIfReady(tx, j.id, { seq: o.seq })) unlocked++;
      } else if (j.state === "ELIGIBLE" && !j.ready) {
        await transitionJourney(tx, { journeyId: j.id, action: "skill_revoked", reason: "A required skill is no longer cleared", payload: { seq: o.seq } });
        locked++;
      }
    }
    return { updated, unlocked, locked };
  });
}
