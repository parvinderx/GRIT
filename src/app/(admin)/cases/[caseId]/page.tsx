import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { getCase, type CaseDecisionKind, type CaseDetail } from "@/services/adminView";
import { CaseDecision, HoldButton } from "@/components/admin/ActionButtons";
import { INTEGRITY_CATEGORIES } from "@/lib/outcome";
import { StateChip, CaseStatusChip } from "@/components/primitives/StatusChip";
import { TimeIST } from "@/components/primitives/TimeIST";
import { STATUS } from "@/lib/journey/statusConfig";
import { formatDayShort } from "@/lib/time";

const EVENT_LABEL: Record<string, string> = {
  hold: "Put on hold",
  dismiss_hold: "Hold lifted",
  confirm_nullify: "Badge nullified",
  confirm_close: "Journey closed",
};

const DECISION_LABEL: Record<CaseDecisionKind, string> = {
  dismiss: "Dismissed: no malpractice",
  nullify: "Confirmed: nullify",
  disqualify: "Confirmed: disqualification",
};

/** What the case is doing to the student right now, from their journeys, badges and events. */
function effectLines(c: CaseDetail): string[] {
  const held = c.journeys.filter((j) => j.state === "ON_HOLD");
  const underReview = c.badges.filter((b) => b.status === "UNDER_REVIEW");
  const withheld = c.evidence.filter((e) => e.reviewStatus === "WITHHELD");
  const lines: string[] = [];

  if (c.status === "TRIAGE" || c.status === "OPEN") {
    if (held.length) {
      lines.push(
        `Booking paused for ${held.length === 1 ? "1 journey" : `${held.length} journeys`}: ${held
          .map((j) => `${j.label}${j.holdPrevState ? ` (was ${STATUS[j.holdPrevState].chipLabel})` : ""}`)
          .join("; ")}. The student sees “Under review”.`
      );
    } else {
      const ready = c.journeys.filter((j) => j.state === "ELIGIBLE");
      const booked = c.journeys.filter((j) => j.state === "BOOKED");
      const parts = [
        ready.length ? `ready to book: ${ready.map((j) => j.label).join("; ")}` : null,
        booked.length ? `booked: ${booked.map((j) => j.label).join("; ")}` : null,
      ].filter(Boolean);
      lines.push(
        parts.length
          ? `No journey is on hold, so this case doesn't change what the student can do (${parts.join(" · ")}).`
          : "No journey is on hold, so this case doesn't change what the student can do. None of their journeys is open for booking right now."
      );
    }
    for (const b of underReview) lines.push(`${b.label} badge is under review (${b.miles} Miles).`);
    if (withheld.length) lines.push(`${withheld.length === 1 ? "1 result is" : `${withheld.length} results are`} withheld: ${withheld.map((e) => e.journey).join("; ")}.`);
    return lines;
  }

  const day = c.decidedAtIso ? formatDayShort(c.decidedAtIso) : null;
  if (c.status === "CONFIRMED") {
    lines.push(
      `Malpractice confirmed${c.decision === "disqualify" ? " and recorded as a disqualification" : c.decision === "nullify" ? " (nullify)" : ""}${day ? ` on ${day}` : ""}${c.decidedByName ? ` by ${c.decidedByName}` : ""}.`
    );
    const decided = c.events.filter((e) => e.action === "confirm_nullify" || e.action === "confirm_close");
    for (const e of decided) lines.push(`${e.journey}: ${e.action === "confirm_nullify" ? "badge nullified" : "closed"}.`);
    for (const b of c.badges.filter((x) => x.status === "NULLIFIED")) {
      if (!decided.some((e) => e.action === "confirm_nullify" && e.journey === b.label)) lines.push(`${b.label} badge nullified (${b.miles} Miles removed).`);
      else lines.push(`${b.miles} Miles removed with the ${b.label} badge.`);
    }
    if (lines.length === 1) lines.push("No journey or badge changes are recorded for this case.");
    return lines;
  }

  // DISMISSED
  lines.push(`Dismissed${day ? ` on ${day}` : ""}${c.decidedByName ? ` by ${c.decidedByName}` : ""}: no malpractice.`);
  const lifted = c.events.filter((e) => e.action === "dismiss_hold");
  if (lifted.length) for (const e of lifted) lines.push(`${e.journey}: hold lifted, now ${e.toState ? STATUS[e.toState].chipLabel : "reopened"}.`);
  else lines.push("Nothing was on hold, so nothing changed for the student.");
  return lines;
}

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const ctx = await requireAdminPage();
  const { caseId } = await params;
  if (!isUuid(caseId)) notFound();
  const isProgramAdmin = ctx.roles.includes("PROGRAM_ADMIN");
  const c = await getCase(caseId, { userId: ctx.userId, isProgramAdmin });
  if (!c) notFound();

  const isOpener = c.openedById === ctx.userId;
  const decided = c.status === "CONFIRMED" || c.status === "DISMISSED";
  const canDecide = isProgramAdmin && !isOpener && !decided;
  const reason = !isProgramAdmin ? "Program Admin only." : isOpener ? "The decider can't be the opener." : decided ? "This case is decided." : undefined;
  const effects = effectLines(c);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-2xl font-bold text-ink">Case {c.code}</h1>
        <CaseStatusChip status={c.status} />
        <span className="text-sm text-ink-2">
          Opened <TimeIST value={c.createdAtIso} /> by {c.openedByName ?? "System"}
        </span>
      </div>

      <div className="mb-5 space-y-4">
        <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-ink-2">Student</p>
            <p className="font-semibold text-ink">
              {c.subjectStudentName ?? "Unknown student"}
              {c.gritIdMasked ? <span className="font-mono text-sm font-normal text-ink-2"> · {c.gritIdMasked}</span> : null}
            </p>
            {c.journeys.length > 0 && (
              <ul className="mt-2 space-y-1">
                {c.journeys.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                    <span>{j.label}</span>
                    <StateChip state={j.state} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-ink-2">Category</p>
            <p className="font-semibold text-ink">
              {c.category ? INTEGRITY_CATEGORIES[c.category as keyof typeof INTEGRITY_CATEGORIES] ?? c.category : c.reason ?? "Integrity concern"}
            </p>
            {c.category && c.reason && <p className="text-sm text-ink-2">{c.reason}</p>}
            {decided && (
              <>
                <p className="mt-3 font-mono text-xs uppercase tracking-wide text-ink-2">Decision</p>
                <p className="font-semibold text-ink">{c.decision ? DECISION_LABEL[c.decision] : "Not recorded (decided before decisions were stored)"}</p>
                {c.decisionNote && <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{c.decisionNote}</p>}
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-review/10 p-5">
          <h2 className="font-heading text-sm font-semibold text-review">{decided ? "What happened" : "Effect right now"}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            {effects.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="order-last space-y-4 lg:order-none">
          {c.evidence.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-heading text-sm font-semibold text-ink">Evidence on record</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {c.evidence.map((e) => (
                  <li key={`${e.journey}-${e.interviewStartIso}`} className="rounded-lg bg-paper-2 px-3 py-2">
                    <p className="text-ink">{e.reason ?? "Interviewer flagged an integrity concern"} · {e.journey}</p>
                    <p className="text-xs text-ink-2">
                      Interview <TimeIST value={e.interviewStartIso} />
                      {e.interviewerName ? ` · ${e.interviewerName}` : ""}
                      {e.reviewStatus === "WITHHELD" ? ` · recorded result "${e.result === "PASS" ? "Pass" : e.result === "FAIL" ? "Fail" : e.result === "RETAKE_LATER" ? "Retake later" : "none"}" is held` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-sm font-semibold text-ink">Timeline</h2>
            <ol className="mt-3 space-y-2 text-sm text-ink-2">
              <li>
                <span className="font-medium text-ink">Case opened</span> · <TimeIST value={c.createdAtIso} />
                {c.openedByName ? ` · ${c.openedByName}` : ""}
              </li>
              {c.events.map((e, i) => (
                <li key={`${e.atIso}-${i}`}>
                  <span className="font-medium text-ink">{EVENT_LABEL[e.action] ?? e.action}</span> · {e.journey} · <TimeIST value={e.atIso} />
                  {e.actorName ? ` · ${e.actorName}` : ""}
                </li>
              ))}
              {c.decidedAtIso && (
                <li>
                  <span className="font-medium text-ink">{c.decision ? DECISION_LABEL[c.decision] : c.status === "DISMISSED" ? "Dismissed" : "Confirmed"}</span> · <TimeIST value={c.decidedAtIso} />
                  {c.decidedByName ? ` · ${c.decidedByName}` : ""}
                </li>
              )}
            </ol>
          </div>
        </div>

        <div className="space-y-4">
        {c.status === "TRIAGE" && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-sm font-semibold text-ink">Before deciding</h2>
            <p className="mt-1 text-sm text-ink-2">
              Put the student under review to pause booking and freeze their badges while you look into it.
            </p>
            <div className="mt-3">
              <HoldButton caseId={c.id} disabled={!canDecide} disabledReason={reason} />
            </div>
          </div>
        )}
        <CaseDecision
          caseId={c.id}
          canDecide={canDecide}
          disabledReason={reason}
          gritIdForConfirm={c.gritIdForConfirm}
          heldJourneys={c.journeys.filter((j) => j.state === "ON_HOLD").map((j) => j.label)}
          heldResult={(() => {
            const h = c.evidence.find((e) => e.reviewStatus === "WITHHELD" && e.result);
            if (!h) return null;
            const label = h.result === "PASS" ? "Pass" : h.result === "FAIL" ? "Fail" : "Retake later";
            return `${label} on ${h.journey}`;
          })()}
        />
        </div>
      </div>
    </div>
  );
}
