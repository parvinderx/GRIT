"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/primitives/ConfirmDialog";
import { postJson } from "@/lib/clientFetch";
import { cn } from "@/lib/utils";
import { staffBtn } from "@/components/primitives/staffButton";

const btnPrimary = staffBtn.primary;
const btnSecondary = staffBtn.secondary;

function DisabledNote({ text }: { text: string }) {
  return <span className="text-xs text-ink-2">{text}</span>;
}

/** Approving records the second person's sign-off and applies the request's effect. */
export function ApproveButton({
  id,
  disabled,
  disabledReason,
  title,
  effect,
}: {
  id: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Dialog title, e.g. "Approve nullifying this badge?". */
  title: string;
  /** What approving does (lib/approvalEffects). */
  effect?: string;
}) {
  const router = useRouter();
  if (disabled) return <DisabledNote text={disabledReason ?? "Can't approve"} />;

  return (
    <ConfirmDialog
      title={title}
      impact={
        <ul className="list-disc space-y-1 pl-5">
          <li>The request is marked approved, with you as the second person.</li>
          {effect && <li>{effect}</li>}
          <li>This happens straight away and is recorded in the student&apos;s history.</li>
        </ul>
      }
      confirmLabel="Approve and apply"
      onConfirm={async () => {
        const r = await postJson(`/api/v1/admin/approvals/${id}/approve`);
        if (r.ok) {
          toast.success("Approved and applied");
          router.refresh();
          return true;
        }
        toast.error(r.message ?? "Couldn't approve");
        return false;
      }}
      trigger={(open) => (
        <button type="button" onClick={open} className={btnPrimary}>Approve</button>
      )}
    />
  );
}

/** Put a case in triage under review (pause booking, badges under review). */
export function HoldButton({ caseId, disabled, disabledReason }: { caseId: string; disabled?: boolean; disabledReason?: string }) {
  const router = useRouter();
  if (disabled) return <DisabledNote text={disabledReason ?? "Can't put on hold"} />;
  return (
    <ConfirmDialog
      title="Put this student under review?"
      impact={
        <ul className="list-disc space-y-1 pl-5">
          <li>Booking pauses on their journeys; the student sees &ldquo;Under review&rdquo;. A booked interview still goes ahead.</li>
          <li>Their badges go under review and Miles are frozen until you decide.</li>
          <li>Dismissing later puts everything back as it was.</li>
        </ul>
      }
      confirmLabel="Put under review"
      onConfirm={async () => {
        const r = await postJson<{ message: string }>(`/api/v1/admin/cases/${caseId}/hold`);
        if (r.ok) {
          toast.success(r.data.message ?? "Under review");
          router.refresh();
          return true;
        }
        toast.error(r.message ?? "Couldn't put it on hold");
        return false;
      }}
      trigger={(open) => (
        <button type="button" onClick={open} className={btnSecondary}>Put under review</button>
      )}
    />
  );
}

export function DeclineButton({ id, disabled, disabledReason }: { id: string; disabled?: boolean; disabledReason?: string }) {
  const router = useRouter();
  if (disabled) return <DisabledNote text={disabledReason ?? "Can't decline"} />;
  return (
    <ConfirmDialog
      title="Decline this request?"
      impact={<p>The request is marked declined, with your reason if you give one. For a second review, the suggested result publishes instead; for a 3rd Retake later, it counts as Not cleared. Otherwise nothing else changes.</p>}
      reason={{ label: "Reason for the requester", placeholder: "e.g. Not enough evidence for a waiver." }}
      confirmLabel="Decline request"
      onConfirm={async (reason) => {
        const r = await postJson(`/api/v1/admin/approvals/${id}/decline`, { reason: reason || undefined });
        if (r.ok) {
          toast.success("Declined");
          router.refresh();
          return true;
        }
        toast.error(r.message ?? "Couldn't decline");
        return false;
      }}
      trigger={(open) => (
        <button type="button" onClick={open} className={btnSecondary}>Decline</button>
      )}
    />
  );
}

/** Tracker filters the server re-applies to find the reminder's recipients. */
export type ReminderFilters = Partial<Record<"track" | "badge" | "batch" | "campus" | "section" | "eligible" | "nobadge" | "risk" | "q" | "state" | "overdue" | "missed", string>>;

/**
 * Sends a booking reminder to every not-booked student matching the tracker
 * filters — all pages, not only the visible one. Only the filters are sent; the
 * server resolves the recipients itself and re-checks each one (still not booked
 * on any track, not reminded in 72 h), so `count` here is an upper bound.
 */
export function SendReminderButton({ count, filters, filterSummary }: { count: number; filters: ReminderFilters; filterSummary: string }) {
  const router = useRouter();
  if (count === 0) {
    return (
      <span className="inline-flex min-h-11 items-center rounded-xl border border-dashed border-border px-4 text-sm text-ink-2">
        No unbooked students in this view
      </span>
    );
  }
  return (
    <ConfirmDialog
      title={`Send a booking reminder to ${count} student${count === 1 ? "" : "s"}?`}
      impact={
        <>
          <p>Who: every student in <span className="font-medium text-ink">{filterSummary}</span> who is ready to book and has no interview booked on any track, across all pages of results, not just the rows on screen.</p>
          <p>Anyone reminded in the last 72 hours, or who books in the meantime, is skipped automatically.</p>
        </>
      }
      confirmLabel="Send reminders"
      onConfirm={async () => {
        const r = await postJson("/api/v1/admin/reminders", { filters });
        if (r.ok) {
          toast.success(r.message ?? "Reminders sent");
          router.refresh();
          return true;
        }
        toast.error(r.message ?? "Couldn't send reminders");
        return false;
      }}
      trigger={(open) => (
        <button type="button" onClick={open} className={btnPrimary}>
          Send booking reminder ({count})
        </button>
      )}
    />
  );
}

export function RequestHoursButton({ gap }: { gap: number }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      title="Request more interviewer hours?"
      impact={
        <>
          <p>This files a request for a second admin to approve{gap > 0 ? ` (current gap: about ${gap} students)` : ""}.</p>
          <p>Approving it records the second admin&apos;s sign-off only; the extra hours are arranged by the team separately.</p>
        </>
      }
      reason={{ label: "Note for the second admin", placeholder: "e.g. Cloud track is short for the week of 14 Dec." }}
      confirmLabel="File request"
      onConfirm={async (note) => {
        const r = await postJson("/api/v1/admin/capacity/request-hours", { note: note || undefined, gap });
        if (r.ok) {
          toast.success(r.message ?? "Request filed");
          router.refresh();
          return true;
        }
        toast.error(r.message ?? "Couldn't file the request");
        return false;
      }}
      trigger={(open) => (
        <button type="button" onClick={open} className={btnPrimary}>Request more hours</button>
      )}
    />
  );
}

type Choice = "dismiss" | "nullify" | "disqualify";

export function CaseDecision({
  caseId,
  canDecide,
  disabledReason,
  gritIdForConfirm,
  heldJourneys,
  heldResult = null,
}: {
  caseId: string;
  canDecide: boolean;
  disabledReason?: string;
  /** The full GRIT ID for the typed confirmation — only passed to someone who can decide. */
  gritIdForConfirm: string | null;
  /** Labels ("Track · Badge") of the student's journeys on hold right now. */
  heldJourneys: string[];
  /** A recorded interview result held by this case, e.g. "Pass on AI Product Mastery · Novice". */
  heldResult?: string | null;
}) {
  const router = useRouter();
  const groupId = useId();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const gritId = gritIdForConfirm;
  const anyHeld = heldJourneys.length > 0;
  const heldList = heldJourneys.join("; ");

  const isConfirm = choice === "nullify" || choice === "disqualify";
  const noteOk = note.trim().length >= 50;
  const idOk = !!gritId && typed.trim() === gritId;
  const ready = choice === "dismiss" ? note.trim().length > 0 : isConfirm && noteOk && idOk;

  const missing: string[] = [];
  if (!choice) missing.push("choose a decision");
  else if (choice === "dismiss" && !note.trim()) missing.push("add a short note");
  else if (isConfirm) {
    if (!noteOk) missing.push(`write ${50 - note.trim().length} more characters in the note`);
    if (!gritId) missing.push("this student has no GRIT ID on record, so a confirmation isn't possible");
    else if (!idOk) missing.push(`type ${gritId}`);
  }

  async function send() {
    if (!choice || !ready) return;
    setBusy(true);
    try {
      const kind = choice === "dismiss" ? "dismiss" : "confirm";
      const r = await postJson(`/api/v1/admin/cases/${caseId}/${kind}`, {
        decision: choice,
        note: note.trim(),
        confirmId: isConfirm ? typed.trim() : undefined,
      });
      if (r.ok) {
        toast.success(
          choice === "dismiss" && heldResult
            ? `Case dismissed. The held result (${heldResult}) is released to the student now.`
            : isConfirm && heldResult
              ? "Decision recorded. The held interview counts as Not cleared: 1 attempt used and the usual wait starts."
              : choice === "dismiss"
            ? anyHeld
              ? "Case dismissed. The held journeys are open for booking again."
              : "Case dismissed. Nothing was on hold, so nothing changed for the student."
            : anyHeld
              ? `Decision recorded (${choice === "nullify" ? "nullify" : "disqualification"}). Held journeys are closed and any badge earned on them is nullified.`
              : `Decision recorded (${choice === "nullify" ? "nullify" : "disqualification"}) on the case only. No journey was on hold.`
        );
        router.refresh();
      } else toast.error(r.message ?? "Couldn't update the case");
    } finally {
      setBusy(false);
    }
  }

  const noHoldConfirm = "No journey is on hold, so confirming records the decision on the case only.";
  const options: { key: Choice; label: string; sub?: string }[] = [
    {
      key: "dismiss",
      label: "Dismiss",
      sub: heldResult
        ? `It was the right person. The held result (${heldResult}) is released to the student straight away.`
        : anyHeld
          ? `No malpractice. On hold now, these reopen for booking: ${heldList}.`
          : "No malpractice. No journey is on hold, so nothing changes for the student.",
    },
    {
      key: "nullify",
      label: anyHeld ? `Confirm · nullify ${heldJourneys.length === 1 ? "the badge" : "badges"} on hold` : "Confirm · nullify",
      sub: heldResult
        ? "Not the right person. The held interview counts as Not cleared: 1 attempt used and the usual wait. The student sees a neutral note pointing to the rules."
        : anyHeld
          ? `On hold: ${heldList}. A held journey with a badge has it nullified; one without is closed.`
          : noHoldConfirm,
    },
    {
      key: "disqualify",
      label: "Confirm · record a disqualification",
      sub: anyHeld
        ? "Same changes to the held journeys as nullify, and the case is recorded as a disqualification. Journeys not on hold stay open."
        : "No journey is on hold, so confirming records the disqualification on the case only. Nothing changes for the student.",
    },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-heading text-base font-semibold text-ink">Decision</h2>
      <p className="mt-1 text-sm text-ink-2">Program Admins only. You can&apos;t decide a case you opened.</p>

      {!canDecide ? (
        <p className="mt-3 rounded-lg bg-paper-2 p-3 text-sm text-ink-2">{disabledReason ?? "You can't decide this case."}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div role="radiogroup" aria-labelledby={`${groupId}-label`} className="space-y-2">
            <span id={`${groupId}-label`} className="sr-only">Decision</span>
            {options.map((o) => {
              const selected = choice === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setChoice(o.key)}
                  className={cn(
                    "flex min-h-11 w-full items-start gap-2.5 rounded-xl border-2 px-4 py-3 text-left",
                    selected ? "border-review bg-review/5" : "border-border"
                  )}
                >
                  <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-review" : "border-ink-2/40")}>
                    {selected && <span className="size-2 rounded-full bg-review" />}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-ink">{o.label}</span>
                    {o.sub && <span className="block text-xs text-ink-2">{o.sub}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {choice && (
            <div>
              <label htmlFor={`${groupId}-note`} className="mb-1 block text-sm font-medium text-ink">
                Internal decision note{isConfirm ? " (50+ characters)" : ""}
              </label>
              <textarea
                id={`${groupId}-note`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-border p-2 text-sm"
              />
              {isConfirm && (
                <p className={cn("mt-1 text-xs", noteOk ? "text-go" : "text-ink-2")}>{note.trim().length} / 50 characters minimum</p>
              )}
            </div>
          )}

          {isConfirm && (
            <>
              <div className="rounded-lg bg-paper-2 p-3 text-sm text-ink">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">What happens</p>
                {anyHeld ? (
                  <p>The journeys on hold ({heldList}) are closed. If a badge was earned on one, it&apos;s nullified and removed from the leaderboard. Journeys not on hold aren&apos;t changed.</p>
                ) : (
                  <p>{noHoldConfirm}</p>
                )}
                <p>The case is recorded as {choice === "disqualify" ? "a disqualification" : "a nullify decision"}, with your note.</p>
              </div>
              <div>
                <label htmlFor={`${groupId}-confirm`} className="mb-1 block text-sm font-medium text-ink">
                  {gritId ? <>Type <span className="font-mono">{gritId}</span> to confirm</> : "No GRIT ID on record for this student"}
                </label>
                <input
                  id={`${groupId}-confirm`}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  disabled={!gritId}
                  className="w-full rounded-lg border border-border p-2 font-mono text-sm"
                />
              </div>
            </>
          )}

          <button
            type="button"
            onClick={send}
            disabled={!ready || busy}
            className={cn(staffBtn.base, "w-full bg-review text-white")}
          >
            {busy ? "Saving…" : choice === "dismiss" ? "Dismiss case" : choice ? "Confirm decision" : "Choose a decision"}
          </button>
          {!ready && missing.length > 0 && <p className="text-xs text-ink-2">To continue: {missing.join(", ")}.</p>}
        </div>
      )}
    </div>
  );
}
