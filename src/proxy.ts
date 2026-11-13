import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifyToken, homePathForRoles, type Role } from "@/lib/session";

const STUDENT_PATHS = ["/home", "/badge", "/book", "/booked", "/interview", "/result", "/profile"];
const INTERVIEWER_PATHS = ["/availability", "/schedule", "/outcome"];
const ADMIN_PATHS = ["/overview", "/tracker", "/capacity", "/cases", "/approvals"];

function requiredRoles(pathname: string): Role[] | null {
  if (STUDENT_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return ["STUDENT"];
  if (INTERVIEWER_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return ["INTERVIEWER"];
  if (ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")))
    return ["INTERVIEW_ADMIN", "PROGRAM_ADMIN"];
  return null;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Server-to-server endpoints authenticated by a bearer secret, not a browser cookie. */
const BEARER_PATHS = ["/api/v1/jobs/", "/api/v1/integrations/"];

/**
 * Cross-site request check for cookie-authenticated API writes. Browsers always send
 * Origin on a cross-origin POST/PUT/DELETE (and Sec-Fetch-Site on modern ones), so a
 * mismatch means another site is driving the user's session. Requests with neither
 * header are non-browser clients (curl, scripts) and carry no ambient cookie risk.
 */
function crossSite(req: NextRequest): boolean {
  // Behind a chain of proxies x-forwarded-host can be "public, internal": the first is the public host.
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host).split(",")[0].trim();
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  return site === "cross-site" || site === "same-site";
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (MUTATING.has(req.method) && !BEARER_PATHS.some((p) => pathname.startsWith(p)) && crossSite(req)) {
      return NextResponse.json(
        { error: "BAD_ORIGIN", message: "This request came from another site and was blocked." },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  const needed = requiredRoles(pathname);
  if (!needed) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifyToken(token) : null;

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/start";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!needed.some((r) => session.roles.includes(r))) {
    // homePathForRoles may carry a query (/start?reason=no-role); /start is outside
    // the matcher, so a user with no recognised role can't loop here.
    const dest = new URL(homePathForRoles(session.roles), req.nextUrl.origin);
    if (dest.pathname === pathname) {
      const url = new URL("/start", req.nextUrl.origin);
      url.searchParams.set("reason", "no-access");
      return NextResponse.redirect(url);
    }
    return NextResponse.redirect(dest);
  }

  return NextResponse.next();
}

export const config = {
  // Pages (role redirects) and /api (cross-site write check). /start stays open.
  matcher: ["/api/:path*", "/((?!api|_next/static|_next/image|favicon.ico|start|.*\\.).*)"],
};
