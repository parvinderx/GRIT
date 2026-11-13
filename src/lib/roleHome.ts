/**
 * Default landing path for a set of roles — no imports, so it's safe in client
 * components, Edge middleware and server code alike.
 */

/** /start?reason=… value used when a signed-in user has no role we recognise. */
export const NO_ROLE_REASON = "no-role";

/** Most privileged persona wins. A user with no recognised role goes to /start
 *  with a message (sending them to /home would bounce forever: /home needs STUDENT). */
export function homePathForRoles(roles: readonly string[]): string {
  if (roles.includes("INTERVIEW_ADMIN") || roles.includes("PROGRAM_ADMIN")) return "/overview";
  if (roles.includes("INTERVIEWER")) return "/schedule";
  if (roles.includes("STUDENT")) return "/home";
  return `/start?reason=${NO_ROLE_REASON}`;
}
