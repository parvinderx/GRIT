import { NextRequest } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { users, userRoles } from "@/db/schema";
import { signSession, SESSION_COOKIE, type Role } from "@/lib/session";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

function guard() {
  if (!env.personaSwitch) throw new ApiError(404, "NOT_FOUND", "Not found");
}

/** Constant-time passcode check (only enforced in production with DEMO_PASSCODE set). */
function checkPasscode(given: unknown) {
  if (!env.passcodeRequired) return;
  const a = Buffer.from(typeof given === "string" ? given.trim() : "");
  const b = Buffer.from(env.demoPasscode);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(401, "BAD_PASSCODE", "That demo passcode isn't right. It's printed on the start page.");
  }
}

async function rolesFor(userId: string): Promise<Role[]> {
  const rows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.role) as Role[];
}

/** List seeded personas for the switcher / start page. */
export async function GET() {
  try {
    guard();
    const all = await db.select().from(users).orderBy(asc(users.displayName));
    const withRoles = await Promise.all(
      all.map(async (u) => ({ id: u.id, name: u.displayName, roles: await rolesFor(u.id) }))
    );
    return apiOk({ users: withRoles });
  } catch (e) {
    return apiError(e);
  }
}

/** Become a seeded persona (stands in for SSO). */
export async function POST(req: NextRequest) {
  try {
    guard();
    const body = (await req.json().catch(() => ({}))) as { userId?: string; passcode?: string };
    checkPasscode(body.passcode);
    if (!body.userId) throw new ApiError(400, "BAD_REQUEST", "userId required");
    const u = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);
    if (!u[0]) throw new ApiError(404, "NOT_FOUND", "No such user");
    const roles = await rolesFor(body.userId);
    const token = await signSession({ userId: body.userId, roles, name: u[0].displayName });
    const res = await apiOk({ ok: true, user: { id: body.userId, name: u[0].displayName, roles } });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    return apiError(e);
  }
}
