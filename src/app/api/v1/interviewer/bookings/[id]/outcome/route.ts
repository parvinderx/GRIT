import { NextRequest } from "next/server";
import { requireCtx } from "@/lib/auth";
import { apiOk, apiError, ApiError } from "@/lib/api";
import { submitOutcome } from "@/services/interviewerView";
import { OUTCOME_RESULTS, WHAT_HAPPENED, type OutcomeResult, type WhatHappened } from "@/lib/outcome";

/**
 * Record an outcome. Shape checks only; the rules (not before start, face + code checks,
 * rubric complete, NO_JOIN / PLATFORM / UNFAIR effects) live in submitOutcome.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireCtx();
    if (!ctx.interviewerId) throw new ApiError(403, "FORBIDDEN", "Interviewers only.");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const isResult = (v: unknown): v is OutcomeResult => OUTCOME_RESULTS.includes(v as OutcomeResult);

    const whatHappened = (body.whatHappened ?? "COMPLETED") as WhatHappened;
    if (!WHAT_HAPPENED.includes(whatHappened)) throw new ApiError(422, "BAD_INPUT", "Choose what happened.");
    const completed = whatHappened === "COMPLETED";

    // A result is only part of a completed interview; the other options carry none.
    if (completed && !isResult(body.result)) throw new ApiError(422, "BAD_RESULT", "Choose Pass, Retake later or Fail.");
    const suggestedResult = isResult(body.suggestedResult) ? body.suggestedResult : null;
    const rubricOk =
      body.rubric === undefined ||
      (Array.isArray(body.rubric) &&
        body.rubric.every((r) => r && typeof r.skill === "string" && Number.isInteger(r.score) && r.score >= 1 && r.score <= 4));
    if (completed && !rubricOk) throw new ApiError(422, "BAD_RUBRIC", "Score every skill from 1 to 4.");
    if (body.feedback != null && typeof body.feedback !== "string") throw new ApiError(422, "BAD_INPUT", "Feedback must be text.");
    if (body.focusAreas != null && (!Array.isArray(body.focusAreas) || body.focusAreas.length > 3 || !body.focusAreas.every((f) => typeof f === "string"))) {
      throw new ApiError(422, "FOCUS_REQUIRED", "Pick 1–3 focus areas.");
    }
    if (body.internalNotes != null && typeof body.internalNotes !== "string") throw new ApiError(422, "BAD_INPUT", "Notes must be text.");

    const result = await submitOutcome({
      interviewerId: ctx.interviewerId,
      userId: ctx.userId,
      bookingId: id,
      whatHappened,
      result: completed ? (body.result as OutcomeResult) : null,
      suggestedResult: completed ? suggestedResult : null,
      rubric: completed ? ((body.rubric as { skill: string; score: number }[]) ?? []) : [],
      feedback: completed ? (body.feedback as string | undefined) : undefined,
      focusAreas: completed ? ((body.focusAreas as string[]) ?? []) : [],
      internalNotes: body.internalNotes as string | undefined,
      integrityFlag: completed && !!body.integrityFlag,
      faceMatched: typeof body.faceMatched === "boolean" ? body.faceMatched : null,
      codeMatched: body.codeMatched === true,
      overrideReason: typeof body.overrideReason === "string" ? body.overrideReason : undefined,
      integrityCategory: typeof body.integrityCategory === "string" ? body.integrityCategory : null,
      assessed15: body.assessed15 === true,
    });
    return apiOk(result);
  } catch (e) {
    return apiError(e);
  }
}
