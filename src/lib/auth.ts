import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { students, interviewers } from "@/db/schema";
import { SESSION_COOKIE, verifyToken, type Role, type SessionPayload } from "./session";
import { homePathForRoles } from "./roleHome";
import { ApiError } from "./api";

export interface Ctx {
  userId: string;
  name: string;
  roles: Role[];
  studentId: string | null;
  interviewerId: string | null;
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** Full context, resolving the student/interviewer row for ownership checks. */
export async function getCtx(): Promise<Ctx | null> {
  const session = await getSession();
  if (!session) return null;

  let studentId: string | null = null;
  let interviewerId: string | null = null;

  if (session.roles.includes("STUDENT")) {
    const s = await db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.userId, session.userId))
      .limit(1);
    studentId = s[0]?.id ?? null;
  }
  if (session.roles.includes("INTERVIEWER")) {
    const i = await db
      .select({ id: interviewers.id })
      .from(interviewers)
      .where(eq(interviewers.userId, session.userId))
      .limit(1);
    interviewerId = i[0]?.id ?? null;
  }

  return { userId: session.userId, name: session.name, roles: session.roles, studentId, interviewerId };
}

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return ctx;
}

export function requireRole(ctx: Ctx, ...roles: Role[]): void {
  if (!roles.some((r) => ctx.roles.includes(r))) {
    throw new ApiError(403, "FORBIDDEN", "You don't have access to this.");
  }
}

export function isStaff(ctx: Ctx): boolean {
  return (
    ctx.roles.includes("INTERVIEW_ADMIN") ||
    ctx.roles.includes("PROGRAM_ADMIN") ||
    ctx.roles.includes("INTERVIEWER")
  );
}

export function isAdmin(ctx: Pick<Ctx, "roles">): boolean {
  return ctx.roles.includes("INTERVIEW_ADMIN") || ctx.roles.includes("PROGRAM_ADMIN");
}

/**
 * For every (admin) page server component — defense in depth behind the
 * middleware and the layout. Signed out → /start; signed in without an admin
 * role → that user's own home.
 */
export async function requireAdminPage(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/start");
  if (!isAdmin(ctx)) redirect(homePathForRoles(ctx.roles));
  return ctx;
}
