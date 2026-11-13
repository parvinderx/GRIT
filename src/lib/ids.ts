/** True for a canonical 8-4-4-4-12 hex UUID (any version). Use before querying by id
 *  so a malformed URL segment goes to notFound() instead of a Postgres 22P02. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
