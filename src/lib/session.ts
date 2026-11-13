/**
 * Session token helpers — jose only (no DB, no next/headers) so this module is
 * safe to import from Edge middleware.
 */
import { SignJWT, jwtVerify } from "jose";
import { sessionSecret } from "./env";

export type Role = "STUDENT" | "INTERVIEWER" | "INTERVIEW_ADMIN" | "PROGRAM_ADMIN";

export interface SessionPayload {
  userId: string;
  roles: Role[];
  name: string;
}

export const SESSION_COOKIE = "grit_session";

let cachedKey: Uint8Array | null = null;
function secret(): Uint8Array {
  cachedKey ??= new TextEncoder().encode(sessionSecret());
  return cachedKey;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ roles: payload.roles, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: String(payload.sub),
      roles: (payload.roles as Role[]) ?? [],
      name: (payload.name as string) ?? "",
    };
  } catch {
    return null;
  }
}

export { homePathForRoles } from "./roleHome";
