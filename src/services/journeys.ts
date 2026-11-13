import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { ENGINE_TRANSITIONS, type EngineAction, type JourneyState } from "@/lib/state-machine";
import { ApiError } from "@/lib/errors";

export interface JourneyRow {
  id: string;
  student_id: string;
  badge_id: string;
  season_id: string;
  state: JourneyState;
  state_reason: string | null;
  attempt_count: number;
  max_attempts: number;
  consecutive_retake_later: number;
  changes_count: number;
  cooldown_until: Date | null;
  priority_rebook: boolean;
  hold_prev_state: JourneyState | null;
  hold_case_id: string | null;
  deadline_protected_until: Date | null;
  drop_used: boolean;
  retake_approval_pending: boolean;
  version: number;
}

type AnySql = Sql | TransactionSql;

/**
 * The ONE way a journey changes. Must run inside a transaction that has already
 * locked the journey row (SELECT ... FOR UPDATE), or pass lock:true to lock here.
 * Validates the edge against ENGINE_TRANSITIONS (the DB trigger re-validates),
 * bumps version, and appends a hash-chained journey_event.
 */
export async function transitionJourney(
  tx: AnySql,
  opts: {
    journeyId: string;
    action: EngineAction;
    reason?: string;
    actorUserId?: string | null;
    patch?: Record<string, unknown>; // extra snake_case journey columns to set
    payload?: Record<string, unknown>;
    lock?: boolean;
    /** Target state, for actions with more than one legal target (dismiss_hold). */
    to?: JourneyState;
  }
): Promise<JourneyRow> {
  const sel = opts.lock
    ? await tx<JourneyRow[]>`SELECT * FROM interview_journeys WHERE id = ${opts.journeyId} FOR UPDATE`
    : await tx<JourneyRow[]>`SELECT * FROM interview_journeys WHERE id = ${opts.journeyId}`;
  const j = sel[0];
  if (!j) throw new ApiError(404, "NOT_FOUND", "Journey not found");

  const def = ENGINE_TRANSITIONS[j.state].find(
    (t) => t.action === opts.action && (opts.to === undefined || t.to === opts.to)
  );
  if (!def) {
    throw new ApiError(409, "ILLEGAL_TRANSITION", `Cannot ${opts.action} from ${j.state}`);
  }

  const updates: Record<string, unknown> = {
    state: def.to,
    version: j.version + 1,
    state_reason: opts.reason ?? null,
    ...(opts.patch ?? {}),
  };

  const updated = await tx<JourneyRow[]>`
    UPDATE interview_journeys SET ${tx(updates)}
    WHERE id = ${opts.journeyId} AND version = ${j.version}
    RETURNING *`;
  if (!updated[0]) throw new ApiError(409, "VERSION_CONFLICT", "The record changed, please retry.");

  const prev = await tx<{ hash: string | null }[]>`
    SELECT hash FROM journey_events WHERE journey_id = ${opts.journeyId} ORDER BY id DESC LIMIT 1`;
  const prevHash = prev[0]?.hash ?? null;
  const hash = createHash("sha256")
    .update(`${prevHash ?? ""}|${j.state}|${def.to}|${opts.action}|${JSON.stringify(opts.payload ?? {})}`)
    .digest("hex");

  await tx`
    INSERT INTO journey_events
      (journey_id, from_state, to_state, action, actor_user_id, reason, payload, prev_hash, hash)
    VALUES (${opts.journeyId}, ${j.state}, ${def.to}, ${opts.action}, ${opts.actorUserId ?? null},
            ${opts.reason ?? null}, ${tx.json((opts.payload ?? {}) as Record<string, string | number | boolean | null>)}, ${prevHash}, ${hash})`;

  return updated[0];
}

/** Update a journey WITHOUT changing state (e.g. changes_count), bumping version
 *  so the trigger's version check passes. Caller should hold the row lock. */
export async function bumpJourney(
  tx: AnySql,
  journeyId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const j = (await tx<{ version: number }[]>`SELECT version FROM interview_journeys WHERE id = ${journeyId}`)[0];
  if (!j) throw new ApiError(404, "NOT_FOUND", "Journey not found");
  const r = await tx`UPDATE interview_journeys SET ${tx({ ...patch, version: j.version + 1 })} WHERE id = ${journeyId} AND version = ${j.version}`;
  if (r.count !== 1) throw new ApiError(409, "VERSION_CONFLICT", "The record changed, please retry.");
}

/**
 * Append an audit event that doesn't change state (interviewer swap, reassign,
 * book-on-behalf notes), keeping the hash chain intact. Caller holds the row lock.
 */
export async function logJourneyEvent(
  tx: AnySql,
  opts: { journeyId: string; action: string; reason?: string; actorUserId?: string | null; payload?: Record<string, unknown> }
): Promise<void> {
  const j = (await tx<{ state: JourneyState }[]>`SELECT state FROM interview_journeys WHERE id = ${opts.journeyId}`)[0];
  if (!j) throw new ApiError(404, "NOT_FOUND", "Journey not found");
  const prev = await tx<{ hash: string | null }[]>`
    SELECT hash FROM journey_events WHERE journey_id = ${opts.journeyId} ORDER BY id DESC LIMIT 1`;
  const prevHash = prev[0]?.hash ?? null;
  const hash = createHash("sha256")
    .update(`${prevHash ?? ""}|${j.state}|${j.state}|${opts.action}|${JSON.stringify(opts.payload ?? {})}`)
    .digest("hex");
  await tx`
    INSERT INTO journey_events
      (journey_id, from_state, to_state, action, actor_user_id, reason, payload, prev_hash, hash)
    VALUES (${opts.journeyId}, ${j.state}, ${j.state}, ${opts.action}, ${opts.actorUserId ?? null},
            ${opts.reason ?? null}, ${tx.json((opts.payload ?? {}) as Record<string, string | number | boolean | null>)}, ${prevHash}, ${hash})`;
}
