import { NextRequest } from "next/server";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { SCENARIOS, type StoryAction } from "@/lib/demoStorySteps";
import { runStoryAction, storyFacts } from "@/services/demoStory";

function guard() {
  if (!env.devTools) throw new ApiError(404, "NOT_FOUND", "Not found");
}

const ACTIONS = new Set<string>(SCENARIOS.flatMap((s) => s.steps.map((st) => st.action)));

/** Where the demo is now (clock, Ravi's state, the current interviewer). */
export async function GET() {
  try {
    guard();
    return apiOk({ facts: await storyFacts() });
  } catch (e) {
    return apiError(e);
  }
}

/** Body: { action, mode: "do" | "show" }. Runs one story step through the real services
 *  and says who to view as and where to go next. */
export async function POST(req: NextRequest) {
  try {
    guard();
    const body = (await req.json().catch(() => ({}))) as { action?: string; mode?: string };
    if (!body.action || !ACTIONS.has(body.action)) throw new ApiError(400, "BAD_STEP", "Unknown story step");
    const result = await runStoryAction(body.action as StoryAction, body.mode === "show" ? "show" : "do");
    return apiOk({ ...result, facts: await storyFacts() });
  } catch (e) {
    return apiError(e);
  }
}
