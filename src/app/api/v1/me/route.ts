import { getCtx } from "@/lib/auth";
import { apiOk, apiError } from "@/lib/api";

/** whoami — current persona, or null if not signed in. */
export async function GET() {
  try {
    const ctx = await getCtx();
    return apiOk({ user: ctx });
  } catch (e) {
    return apiError(e);
  }
}
