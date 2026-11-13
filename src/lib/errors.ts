/** Framework-free errors so services stay importable from CLI scripts/tests. */

export class ApiError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message?: string, extra?: Record<string, unknown>) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Postgres error code of a thrown error (e.g. "23P01"), if any. */
export function pgCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : undefined;
}

/** Map Postgres error codes from the state-machine / booking backstops to ApiError. */
export function mapPgError(e: unknown): ApiError | null {
  const err = e as { code?: string; message?: string; constraint_name?: string };
  if (!err?.code && !err?.message) return null;
  const msg = err.message ?? "";
  // invalid_text_representation on a uuid (a malformed id in a URL or body): the
  // record can't exist, so answer "not found" rather than a 500. Other 22P02s
  // (e.g. a bad enum literal) are left unmapped.
  if (err.code === "22P02" && /uuid/i.test(msg)) return new ApiError(404, "NOT_FOUND", "Not found");
  if (err.code === "23P01") return new ApiError(409, "SLOT_TAKEN", "That time was just taken.");
  // foreign_key_violation: a row is still referenced (e.g. a slot an old booking points
  // at). Nothing the caller can fix by retrying the same request blindly.
  if (err.code === "23503")
    return new ApiError(409, "STILL_REFERENCED", "This can't be changed because other records still depend on it. Refresh and try again.");
  if (err.code === "23505") {
    if (err.constraint_name === "uq_bookings_student_upcoming")
      return new ApiError(409, "ALREADY_BOOKED", "You already have an upcoming interview.");
    if (err.constraint_name?.startsWith("uq_bookings_"))
      return new ApiError(409, "SLOT_TAKEN", "That time was just taken.");
  }
  if (msg.includes("ILLEGAL_TRANSITION")) return new ApiError(409, "ILLEGAL_TRANSITION", msg);
  if (msg.includes("VERSION_CONFLICT") || err.code === "40001")
    return new ApiError(409, "VERSION_CONFLICT", "The record changed, please retry.");
  if (msg.includes("APPEND_ONLY")) return new ApiError(409, "APPEND_ONLY", msg);
  return null;
}
