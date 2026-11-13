"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Check, Eye, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { OutcomeFormData } from "@/services/interviewerView";
import { timeOnly } from "@/lib/time";
import Link from "next/link";
import { btnClass } from "@/components/student/ui/Button";
import { ConfirmDialog } from "@/components/primitives/ConfirmDialog";
import { cn } from "@/lib/utils";
import { onRadioGroupKeyDown } from "@/lib/roving";
import { FAIL_COOLDOWN_DAYS, PUBLISH_DELAY_MINUTES, RETAKE_COOLDOWN_DAYS } from "@/lib/rules";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  INTEGRITY_CATEGORIES,
  NOT_COMPLETED_NOTE_MIN,
  OVERRIDE_REASON_MIN,
  OUTCOME_RESULTS,
  suggestResult,
  type IntegrityCategory,
  RESULT_LABEL,
  RECORDED_CONSEQUENCE,
  WHAT_HAPPENED,
  WHAT_HAPPENED_LABEL,
  whatHappenedConsequence,
  type OutcomeResult,
  type WhatHappened,
} from "@/lib/outcome";

const SCORES = [1, 2, 3, 4];
const SCORE_LABEL = ["", "Not yet", "Developing", "Meets bar", "Strong"];
const APPLIED_NOW = "This is applied straight away and can't be edited.";
const HELD_FOR_REVIEW = "It goes to the interview team for review, and you can't edit it after submitting.";
/** How often the form re-checks its time gates (start, end of the join window). */
const CLOCK_TICK_MS = 15_000;

export function OutcomeForm({ data, preselect }: { data: OutcomeFormData; /** Start on this "what happened" option (e.g. from the room: student never joined). */ preselect?: WhatHappened }) {
  const router = useRouter();
  const resultLabelId = useId();
  const feedbackId = useId();
  const feedbackHintId = useId();
  const notesId = useId();
  const noteId = useId();
  const submitHintId = useId();
  const prev = data.existing;

  // Server-time clock: anchored to the server's time at page load and advanced by
  // locally elapsed time, so Submit / "Student didn't join" enable on time without a
  // refresh. `anchor` ties the state to the serverNow it came from (a refresh re-anchors).
  const serverNowMs = Date.parse(data.serverNowIso);
  const [clock, setClock] = useState({ anchor: serverNowMs, now: serverNowMs });
  useEffect(() => {
    const startedLocal = Date.now();
    const id = setInterval(
      () => setClock({ anchor: serverNowMs, now: serverNowMs + (Date.now() - startedLocal) }),
      CLOCK_TICK_MS
    );
    return () => clearInterval(id);
  }, [serverNowMs]);
  const nowMs = clock.anchor === serverNowMs ? clock.now : serverNowMs;
  const started = data.started || nowMs >= Date.parse(data.startIso);
  const noJoinOpen = nowMs >= Date.parse(data.noJoinFromIso);
  const consequence = (v: Exclude<WhatHappened, "COMPLETED">) =>
    whatHappenedConsequence(v, { attemptsLeft: data.attemptsLeft, noshowCooldownDays: data.noshowCooldownDays });

  const [happened, setHappened] = useState<WhatHappened>(
    (WHAT_HAPPENED as string[]).includes(prev?.whatHappened ?? "") ? (prev!.whatHappened as WhatHappened) : (preselect ?? "COMPLETED")
  );
  // Face check: a real yes/no, nothing pre-chosen on a first record. "Doesn't match" still
  // submits, but the result is held and a case opens for the interview team.
  const [face, setFace] = useState<boolean | null>(prev?.faceMatched ?? null);
  // Booking code: verified automatically when the student typed it to join. Only if they
  // never joined through the app does the interviewer confirm it by hand.
  const codeVerified = !!data.codeVerifiedAtIso;
  const [idCode, setIdCode] = useState(!!prev);
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries((prev?.rubric ?? []).filter((r) => r.score > 0).map((r) => [r.skill, r.score]))
  );
  const [result, setResult] = useState<OutcomeResult | null>(prev?.result ?? null);
  const [feedback, setFeedback] = useState(prev?.feedback ?? "");
  const [focus, setFocus] = useState<string[]>(prev?.focusAreas ?? []);
  const [notes, setNotes] = useState(prev?.internalNotes ?? "");
  const [integrity, setIntegrity] = useState(prev?.integrityFlag ?? false);
  const [category, setCategory] = useState<IntegrityCategory | "">((prev?.integrityCategory as IntegrityCategory) ?? "");
  const [overrideReason, setOverrideReason] = useState(prev?.overrideReason ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [assessed15, setAssessed15] = useState(false);
  const overrideId = useId();
  // Once submitted the publish time is fixed; before that it's "now + publish delay".
  const publishTime = timeOnly(
    data.alreadySubmitted
      ? data.publishPreviewIso
      : new Date(Date.parse(data.publishPreviewIso) + (nowMs - serverNowMs)).toISOString()
  );
  const [busy, setBusy] = useState(false);

  const completed = happened === "COMPLETED";

  const suggested = useMemo<OutcomeResult | null>(() => suggestResult(data.skills, scores), [scores, data.skills]);
  // A result that differs from the suggestion needs an internal reason; a Pass against
  // it goes to a second reviewer before the student sees it (spec section 5, I3).
  const overriding = completed && !!suggested && !!result && result !== suggested;
  const passAgainst = overriding && result === "PASS";
  const overrideLen = overrideReason.trim().length;

  // Plain-language list of what's still missing, shown next to a disabled Submit.
  const missing: string[] = [];
  if (!started) missing.push(`wait until the interview starts at ${timeOnly(data.startIso)}`);
  const noteLen = notes.trim().length;
  const feedbackLen = feedback.trim().length;
  const needFeedback = completed && (result === "FAIL" || result === "RETAKE_LATER");
  if (completed) {
    if (face === null) missing.push("answer the face check");
    if (!codeVerified && !idCode) missing.push("confirm the booking code");
    const unscored = data.skills.filter((s) => !scores[s]).length;
    if (unscored > 0) missing.push(`score ${unscored} more skill${unscored === 1 ? "" : "s"}`);
    if (result == null) missing.push("choose a result");
    if (needFeedback && feedbackLen < 80) missing.push(`feedback needs ${80 - feedbackLen} more character${80 - feedbackLen === 1 ? "" : "s"}`);
    if (needFeedback && feedbackLen > 600) missing.push(`feedback is ${feedbackLen - 600} character${feedbackLen - 600 === 1 ? "" : "s"} too long`);
    if (needFeedback && focus.length === 0) missing.push("pick 1–3 focus areas");
    if (overriding && overrideLen < OVERRIDE_REASON_MIN) missing.push(`say why your result differs from the suggestion (${OVERRIDE_REASON_MIN - overrideLen} more characters)`);
    if (integrity && !category) missing.push("choose the kind of integrity concern");
  } else {
    if (happened === "NO_JOIN" && data.studentJoined) missing.push("the student joined, so choose another option");
    else if (happened === "DROPPED" && !data.studentJoined) missing.push("the student never joined, so choose another option");
    else if (happened === "DROPPED" && data.dropUsed && assessed15) missing.push("choose \"Interview completed\" and record a result (15+ minutes after an earlier drop)");
    else if (happened === "NO_JOIN" && !noJoinOpen) missing.push(`wait until ${timeOnly(data.noJoinFromIso)}, when the student's join window closes`);
    if (noteLen < NOT_COMPLETED_NOTE_MIN) missing.push(`say what happened (${NOT_COMPLETED_NOTE_MIN - noteLen} more character${NOT_COMPLETED_NOTE_MIN - noteLen === 1 ? "" : "s"})`);
  }
  const canSubmit = missing.length === 0 && !busy && data.editable;
  // The result is held for the interview team when the face doesn't match or a concern is raised.
  const held = completed && (face === false || integrity);

  /** Returns false when the server refused (keeps a confirm dialog open). */
  async function submit(): Promise<boolean> {
    setBusy(true);
    let succeeded = false;
    try {
      const res = await fetch(`/api/v1/interviewer/bookings/${data.bookingId}/outcome`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(
          completed
            ? {
                whatHappened: happened,
                faceMatched: face,
                codeMatched: codeVerified || idCode,
                result,
                suggestedResult: suggested,
                rubric: data.skills.map((s) => ({ skill: s, score: scores[s] })),
                feedback,
                focusAreas: focus,
                internalNotes: notes,
                integrityFlag: integrity,
                integrityCategory: integrity ? category : null,
                overrideReason: overriding ? overrideReason : "",
              }
            : { whatHappened: happened, internalNotes: notes, assessed15: happened === "DROPPED" ? assessed15 : undefined }
        ),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string; publishAtIso?: string | null; secondReview?: boolean };
      if (res.ok) {
        succeeded = true;
        if (completed) {
          const at = json.publishAtIso ? timeOnly(json.publishAtIso) : publishTime;
          toast.success(
            held
              ? `Outcome saved and held for review. ${HELD_FOR_REVIEW}`
              : json.secondReview
                ? "Outcome saved. A second reviewer checks this Pass before the student sees it."
                : `Outcome saved. You can edit it until ${at}; then the student sees it.`
          );
        } else {
          toast.success(`Recorded: ${WHAT_HAPPENED_LABEL[happened]}.`);
        }
        // Back to Today: it confirms what was saved and shows the next thing to do.
        router.push(`/schedule?done=${data.bookingId}`);
        router.refresh();
      } else {
        toast.error(json.message ?? "Couldn't submit");
      }
    } catch {
      toast.error("Couldn't reach the server. Your answers are still here; try again.");
    } finally {
      if (!succeeded) setBusy(false);
    }
    return succeeded;
  }

  if (!data.editable) {
    return <LockedOutcome data={data} />;
  }

  const section = "rounded-xl border border-rule bg-white p-5";
  const h = "font-display text-lg font-extrabold text-graphite mb-3";
  const submitLabel = busy ? "Saving…" : data.alreadySubmitted && completed ? "Save changes" : "Submit outcome";
  const submitButton = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!canSubmit}
      aria-describedby={missing.length ? submitHintId : undefined}
      className={btnClass("next", "mt-4 w-full")}
    >
      {submitLabel}
    </button>
  );

  return (
    <div className="space-y-4 pb-10 lg:grid lg:grid-cols-[1fr_280px] lg:gap-6 lg:space-y-0">
      <div className="space-y-4">
        <fieldset className={cn(section, "[&>*:not(legend)]:clear-left")}>
          <legend className={cn(h, "float-left w-full p-0")}>1. What happened?</legend>
          <Who>
            Completed: carry on below. Didn&apos;t join: uses 1 attempt and starts a wait, applied straight away. Couldn&apos;t happen or couldn&apos;t
            finish fairly: no attempt used, the student gets priority rebooking, applied straight away.
          </Who>
          {WHAT_HAPPENED.map((v) => {
            const unavailable = v === "NO_JOIN" && (data.studentJoined || !noJoinOpen);
            const hint =
              v === "NO_JOIN" && data.studentJoined
                ? "The student joined, so this isn't available."
                : v === "NO_JOIN" && !noJoinOpen
                  ? `Available from ${timeOnly(data.noJoinFromIso)}.`
                  : null;
            return (
              <label key={v} className={cn("flex min-h-11 items-center gap-2 text-sm", unavailable ? "text-pencil" : "text-graphite")}>
                <input
                  type="radio"
                  name="happened"
                  checked={happened === v}
                  disabled={unavailable && happened !== v}
                  onChange={() => setHappened(v)}
                  className="size-4 accent-graphite"
                />
                <span>
                  {WHAT_HAPPENED_LABEL[v]}
                  {hint && <span className="block text-xs text-pencil">{hint}</span>}
                </span>
              </label>
            );
          })}
          {happened === "DROPPED" && data.dropUsed && (
            <label className="mt-3 flex items-start gap-2 text-sm text-graphite">
              <input type="checkbox" checked={assessed15} onChange={(e) => setAssessed15(e.target.checked)} className="mt-0.5 size-4 accent-graphite" />
              <span>
                I assessed 15 minutes or more before it dropped
                <span className="block text-xs text-pencil">This student already had a free retake for a dropped call, so 15+ minutes means it counts: record a result.</span>
              </span>
            </label>
          )}
          {!completed && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-rule-soft px-3 py-2 text-sm text-graphite">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden="true" />
              {consequence(happened as Exclude<WhatHappened, "COMPLETED">)}
            </p>
          )}
        </fieldset>

        {!completed && (
          <div className={cn(section, "bg-rule-soft")}>
            <label htmlFor={noteId} className={cn(h, "flex items-center gap-1.5")}>2. Note for the interview team <Lock className="size-3.5" aria-hidden="true" /></label>
            <p id={`${noteId}-hint`} className="mb-2 text-xs text-pencil">Interview team only. Never shown to the student. At least {NOT_COMPLETED_NOTE_MIN} characters.</p>
            <textarea
              id={noteId}
              aria-describedby={`${noteId}-hint`}
              aria-required="true"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-rule bg-white p-2 text-sm"
              placeholder="For example: video dropped twice and we couldn't reconnect."
            />
            <p className={cn("mt-1 text-xs", noteLen >= NOT_COMPLETED_NOTE_MIN ? "text-mint" : "text-pencil")}>
              {noteLen} / {NOT_COMPLETED_NOTE_MIN} characters minimum
            </p>
          </div>
        )}

        {completed && (
          <>
            <fieldset className={cn(section, "[&>*:not(legend)]:clear-left")}>
              <legend className={cn(h, "float-left w-full p-0")}>2. Identity check</legend>
              <Who>
                Joining from their own account verifies the booking automatically. Ask them to read out the code, and check their face. If
                the face doesn&apos;t match, the result is held and a case opens for the interview team.
              </Who>
              {codeVerified ? (
                <p className="flex min-h-11 items-center gap-2 text-sm font-bold text-mint">
                  <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
                  {data.studentName.split(" ")[0]} joined from their own account at {timeOnly(data.codeVerifiedAtIso!)}
                  {data.bookingCode ? `. They should read out ${data.bookingCode}.` : "."}
                </p>
              ) : (
                <label className="flex min-h-11 items-center gap-2 text-sm text-graphite">
                  <input type="checkbox" checked={idCode} onChange={(e) => setIdCode(e.target.checked)} className="size-4 accent-graphite" />
                  <span>
                    The student didn&apos;t join through the app. The booking code they read out
                    {data.bookingCode ? <> (<span className="tracking-widest">{data.bookingCode}</span>)</> : null} matches.
                  </span>
                </label>
              )}
              <p className="mt-2 text-sm font-bold text-graphite">Does their face match the registered photo and college ID?</p>
              <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Face check" onKeyDown={onRadioGroupKeyDown}>
                {([
                  [true, "Matches"],
                  [false, "Doesn't match"],
                ] as const).map(([v, label], i) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={face === v}
                    tabIndex={face === v || (face === null && i === 0) ? 0 : -1}
                    onClick={() => setFace(v)}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 rounded-lg border-[1.5px] px-4 text-sm font-bold",
                      face === v
                        ? v
                          ? "border-mint bg-mint-soft text-graphite"
                          : "border-amberline bg-amberline-soft text-graphite"
                        : "border-rule bg-white text-graphite hover:border-graphite"
                    )}
                  >
                    {face === v && <Check className="size-4" aria-hidden="true" />}
                    {label}
                  </button>
                ))}
              </div>
              {face === false && (
                <p role="status" className="mt-3 flex items-start gap-2 border-l-4 border-amberline bg-amberline-soft px-3 py-2 text-sm text-graphite">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amberline" aria-hidden="true" />
                  You can still submit. The result is held, the student sees &ldquo;Result pending&rdquo;, and a case opens for the interview team.
                  Say what you saw in the internal notes.
                </p>
              )}
            </fieldset>

            <div className={section}>
              <p className={h}>3. Rubric</p>
              <Who>Interview team only. Your scores set the suggested result.</Who>
              <p className="mb-2 text-xs text-pencil">Score every skill from 1 to 4: 1 is not yet, 2 developing, 3 meets the bar, 4 strong.</p>
              <div className="space-y-3">
                {data.skills.map((s) => (
                  <div key={s} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-bold text-graphite">{s}</span>
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <div className="flex gap-1">
                        {SCORES.map((n) => (
                          <button
                            key={n}
                            type="button"
                            aria-pressed={scores[s] === n}
                            aria-label={`${s}: ${n}, ${SCORE_LABEL[n]}`}
                            title={SCORE_LABEL[n]}
                            onClick={() => setScores((p) => ({ ...p, [s]: n }))}
                            className={`size-11 rounded-md border text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ballpoint ${scores[s] === n ? "border-graphite bg-graphite text-white" : "border-rule"}`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <span className="min-h-4 text-xs text-pencil" aria-hidden="true">
                        {scores[s] ? `${scores[s]} · ${SCORE_LABEL[scores[s]]}` : "Not scored"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {suggested && (
                <p className="mt-3 rounded-lg bg-rule-soft px-3 py-2 text-sm text-graphite">
                  Suggested result: <strong>{RESULT_LABEL[suggested]}</strong>
                </p>
              )}
            </div>

            <div className={section}>
              <p id={resultLabelId} className={h}>4. Result</p>
              <Who>
                The student sees it {PUBLISH_DELAY_MINUTES} minutes after you submit (you can edit until then). Pass: badge and Miles. Fail: uses 1
                attempt, {FAIL_COOLDOWN_DAYS}-day wait. Retake later: no attempt used, {RETAKE_COOLDOWN_DAYS}-day wait.
              </Who>
              <div role="radiogroup" aria-labelledby={resultLabelId} onKeyDown={onRadioGroupKeyDown} className="grid grid-cols-3 gap-2">
                {OUTCOME_RESULTS.map((r, i) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={result === r}
                    tabIndex={result === r || (result == null && i === 0) ? 0 : -1}
                    onClick={() => setResult(r)}
                    className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ballpoint ${
                      result === r ? (r === "PASS" ? "border-mint bg-mint-soft text-graphite" : "border-graphite bg-ballpoint-soft text-graphite") : "border-rule text-graphite"
                    }`}
                  >
                    {result === r && <Check className="size-4" aria-hidden="true" />}
                    {RESULT_LABEL[r]}
                  </button>
                ))}
              </div>
              {overriding && (
                <div className="mt-4 rounded-lg bg-rule-soft p-3">
                  <label htmlFor={overrideId} className="flex items-center gap-1.5 text-sm font-bold text-graphite">
                    Why does your result differ from the suggested {RESULT_LABEL[suggested!]}? <Lock className="size-3.5" aria-hidden="true" />
                  </label>
                  <p className="mb-2 text-xs text-pencil">
                    Interview team only, never the student. At least {OVERRIDE_REASON_MIN} characters.
                    {passAgainst && " A Pass against the suggestion goes to a second reviewer before the student sees it."}
                  </p>
                  <textarea
                    id={overrideId}
                    aria-required="true"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-rule bg-white p-2 text-sm"
                  />
                  <p className={cn("mt-1 text-xs", overrideLen >= OVERRIDE_REASON_MIN ? "text-mint" : "text-pencil")}>
                    {overrideLen} / {OVERRIDE_REASON_MIN} characters minimum
                  </p>
                </div>
              )}
            </div>

            <div className={section}>
              <label htmlFor={feedbackId} className={cn(h, "block")}>5. Feedback for the student {needFeedback && <span className="text-[15px] font-bold text-amberline">(required)</span>}</label>
              <Who>The student sees this and the focus areas with their result.</Who>
              <textarea
                id={feedbackId}
                aria-describedby={feedbackHintId}
                aria-required={needFeedback || undefined}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-rule p-2 text-sm"
                placeholder="80–600 characters, required for Fail and Retake later."
              />
              <p id={feedbackHintId} className="mt-1 text-xs text-pencil">{feedbackLen} / 600 characters{needFeedback ? ", at least 80" : ""}</p>
              <p className="mt-3 text-[14px] font-bold text-graphite">Focus areas (up to 3)</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {data.skills.map((s) => {
                  const on = focus.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFocus((p) => (on ? p.filter((x) => x !== s) : p.length < 3 ? [...p, s] : p))}
                      className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ballpoint ${on ? "bg-graphite text-white" : "bg-rule-soft text-pencil"}`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={cn(section, "bg-rule-soft")}>
              <label htmlFor={notesId} className={cn(h, "flex items-center gap-1.5")}>6. Internal notes <Lock className="size-3.5" aria-hidden="true" /></label>
              <Who>Interview team only, never the student. Read with any integrity case.</Who>
              <p id={`${notesId}-hint`} className="sr-only">Interview team only. Never shown to the student.</p>
              <textarea id={notesId} aria-describedby={`${notesId}-hint`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-rule bg-white p-2 text-sm" />
            </div>

            <div className={section}>
              <label className="flex items-start gap-2 text-sm text-graphite">
                <input type="checkbox" checked={integrity} onChange={(e) => setIntegrity(e.target.checked)} className="mt-0.5 size-4 accent-review" />
                <span>
                  7. I have an integrity concern
                  <span className="block text-xs text-pencil">
                    Goes to the interview team: the result is held and a case opens. The student keeps seeing &ldquo;Result pending&rdquo; until it&apos;s
                    decided. Describe what you saw in the internal notes.
                  </span>
                </span>
              </label>
              {integrity && (
                <label className="mt-3 block text-sm font-bold text-graphite">
                  What kind of concern?{" "}
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as IntegrityCategory | "")}
                    aria-required="true"
                    className="mt-1 block w-full rounded-lg border border-rule bg-white p-2 text-sm font-normal"
                  >
                    <option value="">Choose one</option>
                    {(Object.keys(INTEGRITY_CATEGORIES) as IntegrityCategory[]).map((k) => (
                      <option key={k} value={k}>
                        {INTEGRITY_CATEGORIES[k]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </>
        )}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className={section}>
          <p className="text-[15px] font-bold text-graphite">What happens next</p>
          <p className="mt-1 text-sm text-graphite">
            {!started
              ? `You can submit from ${timeOnly(data.startIso)}, when the interview starts.`
              : !completed
                ? APPLIED_NOW
                : held
                  ? `${face === false ? "The face check didn't match, so this" : "This"} result will be held. ${HELD_FOR_REVIEW}`
                  : passAgainst
                    ? "This Pass is against the suggestion, so a second reviewer checks it before the student sees it. You can't edit it after submitting."
                    : data.alreadySubmitted
                      ? `You can change anything until ${publishTime}. Then it locks and the student sees it.`
                      : `If you submit now, you can edit until about ${publishTime}. Then it locks and the student sees it.`}
          </p>
          {completed && result && !held && (
            <button type="button" onClick={() => setPreviewOpen(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-ballpoint underline underline-offset-4">
              <Eye className="size-4" aria-hidden="true" /> Preview as student
            </button>
          )}
          {completed ? (
            <ConfirmDialog
              trigger={(open) => submitButton(open)}
              title={`Submit outcome: ${result ? RESULT_LABEL[result] : ""} for ${data.studentName}?`}
              impact={
                <>
                  {held ? (
                    <p>The result is held for the interview team. The student sees &ldquo;Result pending&rdquo; until it&apos;s decided.</p>
                  ) : passAgainst ? (
                    <p>A second reviewer checks this Pass first. The student sees it once it&apos;s approved.</p>
                  ) : (
                    <p>
                      The student sees this at {publishTime}. You can edit until then.
                    </p>
                  )}
                  {result === "FAIL" && !held && (
                    <p>
                      This uses 1 of their {data.maxAttempts} attempts{data.attemptsLeft <= 1 ? ", their last one, so booking for this badge closes" : ""}.
                    </p>
                  )}
                </>
              }
              confirmLabel={data.alreadySubmitted ? "Save changes" : "Submit outcome"}
              tone="notebook"
              onConfirm={submit}
            />
          ) : (
            <ConfirmDialog
              trigger={(open) => submitButton(open)}
              title={`Record "${WHAT_HAPPENED_LABEL[happened]}" for ${data.studentName}?`}
              impact={
                <>
                  <p>{consequence(happened as Exclude<WhatHappened, "COMPLETED">)}</p>
                  <p>{APPLIED_NOW}</p>
                </>
              }
              confirmLabel="Record and apply"
              tone="notebook"
              onConfirm={submit}
            />
          )}
          {missing.length > 0 && (
            <p id={submitHintId} className="mt-2 text-xs text-pencil">
              Still to do: {missing.join(", ")}.
            </p>
          )}
        </div>
      </aside>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="student sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-extrabold text-graphite">What {data.studentName.split(" ")[0]} will see</DialogTitle>
            <DialogDescription className="text-sm text-pencil">Only the result, your feedback and the focus areas. Never scores or notes.</DialogDescription>
          </DialogHeader>
          <StudentPreview result={result} feedback={feedback} focus={focus} badge={data.badge} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Read-only view once an outcome can't be edited (published, in review, applied straight away, or not needed). */
function LockedOutcome({ data }: { data: OutcomeFormData }) {
  const o = data.existing;
  const card = "rounded-xl border border-rule bg-white p-5";
  const next = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Link href="/schedule" className={btnClass("outline", "min-h-11 px-4 text-[15px]")}>
        Back to today
      </Link>
      {o && o.whatHappened === "COMPLETED" && data.lockedAt && !data.underReview && (
        <a
          href={`mailto:interview-team@panseeds.in?subject=${encodeURIComponent(`Result change request: ${data.studentName}, ${data.badge}`)}`}
          className={btnClass("link")}
        >
          Ask the interview team for a result change
        </a>
      )}
    </div>
  );
  if (!o)
    return (
      <div className="space-y-4">
        <p className={card}>{data.closedReason ?? "This outcome is published and locked."}</p>
        {next}
      </div>
    );
  const notCompleted = o.whatHappened !== "COMPLETED";
  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-rule-soft px-4 py-3 text-sm text-graphite">
        {notCompleted
          ? "Recorded and applied straight away. It can't be edited."
          : data.secondReview
            ? "A Pass against the suggestion: a second reviewer checks it before the student sees it. You can't edit it meanwhile."
            : data.underReview
            ? "Held for an integrity review. The interview team will decide; you can't edit it meanwhile."
            : data.lockedAt
              ? "Published and locked. To change it, ask the interview team for a result change."
              : "The edit window has closed and the result is being published."}
      </p>
      <div className={card}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-pencil">What happened</dt><dd className="font-medium text-graphite">{WHAT_HAPPENED_LABEL[o.whatHappened as WhatHappened] ?? o.whatHappened}</dd></div>
          {!notCompleted && <div><dt className="text-pencil">Result</dt><dd className="font-medium text-graphite">{o.result ? RESULT_LABEL[o.result] : "—"}</dd></div>}
        </dl>
        {notCompleted && (
          <>
            <p className="mt-3 text-sm text-pencil">{RECORDED_CONSEQUENCE[o.whatHappened as Exclude<WhatHappened, "COMPLETED">]}</p>
            {o.internalNotes && <p className="mt-3 text-sm text-graphite"><span className="text-pencil">Your note (interview team only): </span>{o.internalNotes}</p>}
          </>
        )}
        {o.rubric.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {o.rubric.map((r) => (
              <li key={r.skill} className="flex justify-between gap-2">
                <span className="text-graphite">{r.skill}</span>
                <span className="text-pencil">{r.score > 0 ? `${r.score} · ${SCORE_LABEL[r.score]}` : "Not scored"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {o.feedback && (
        <div className={card}>
          <p className="mb-1 text-sm font-semibold text-graphite">Feedback the student sees</p>
          <p className="text-sm text-graphite">{o.feedback}</p>
          {o.focusAreas.length > 0 && <p className="mt-2 text-sm text-pencil">Focus areas: {o.focusAreas.join(", ")}</p>}
        </div>
      )}
      {next}
    </div>
  );
}

/** Student-facing preview of a result: same words and calm palette as the student result page (no red, no rubric, no notes). */
function StudentPreview({ result, feedback, focus, badge }: { result: OutcomeResult | null; feedback: string; focus: string[]; badge: string }) {
  const headline =
    result === "PASS" ? `You earned the ${badge} badge` : result === "RETAKE_LATER" ? "Retake later: you're close" : "Not cleared this time";
  return (
    <div className="space-y-4 text-graphite">
      <p className="font-display text-2xl font-extrabold">{headline}</p>
      {result !== "PASS" && <p className="text-sm text-pencil">One interview doesn&apos;t define your GRIT. Read the feedback and try again.</p>}
      {feedback.trim() ? (
        <blockquote className="border-l-4 border-graphite pl-4 leading-relaxed">&ldquo;{feedback.trim()}&rdquo;</blockquote>
      ) : (
        <p className="text-sm text-pencil">No written note.</p>
      )}
      {focus.length > 0 && (
        <div>
          <p className="font-bold">Work on these next</p>
          <ul className="mt-1">
            {focus.map((f) => (
              <li key={f} className="flex items-center gap-2 py-1">
                <span className="size-2 rounded-full bg-ballpoint" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "Who sees this / what happens": one line under each section heading. */
function Who({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 flex items-start gap-1.5 text-[13px] leading-snug text-pencil">
      <Eye className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
