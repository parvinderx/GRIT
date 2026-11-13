import Link from "next/link";
import { ChevronRight, Clock } from "lucide-react";
import { requireAdminPage } from "@/lib/auth";
import { getPendingApprovals, type ApprovalRow } from "@/services/adminView";
import { ApproveButton, DeclineButton } from "@/components/admin/ActionButtons";
import { TimeIST } from "@/components/primitives/TimeIST";
import { ApprovalTypeChip } from "@/components/primitives/StatusChip";
import { approvalTypeDef } from "@/lib/journey/statusConfig";
import { APPROVAL_EFFECT } from "@/lib/approvalEffects";
import { waitingFor } from "@/lib/time";
import { serverNow } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { staffBtn } from "@/components/primitives/staffButton";

const FILTERS: { key: string; label: string; match?: (r: ApprovalRow) => boolean }[] = [
  { key: "all", label: "All" },
  { key: "emergency", label: "Emergencies", match: (r) => r.action === "EMERGENCY_WAIVER" },
  { key: "integrity", label: "Integrity", match: (r) => approvalTypeDef(r.action).group === "integrity" },
  { key: "result", label: "Result changes", match: (r) => approvalTypeDef(r.action).group === "result" },
  {
    key: "attempts",
    label: "Attempts and cooldowns",
    match: (r) => approvalTypeDef(r.action).group === "attempts" && r.action !== "EMERGENCY_WAIVER",
  },
  {
    key: "access",
    label: "Access and capacity",
    match: (r) => ["access", "capacity"].includes(approvalTypeDef(r.action).group),
  },
];

/** One line naming who / what the request is about. */
function subjectLine(r: ApprovalRow): string | null {
  if (r.subject) {
    return `${r.subject.studentName}${r.subject.gritIdMasked ? ` (${r.subject.gritIdMasked})` : ""}${r.subject.journey ? ` · ${r.subject.journey}` : ""}`;
  }
  if (r.action === "SEASON_RULE" || r.action === "ROLE_GRANT") {
    const who = r.requestedByName ? `${r.requestedByName}${r.requesterRoleLabel ? `, ${r.requesterRoleLabel}` : ""}` : "an admin";
    const gap = r.gapAtFiling != null && r.gapAtFiling > 0 ? ` · capacity gap at filing: ${r.gapAtFiling} students` : "";
    return `Filed by ${who}${gap}`;
  }
  if (r.interviewerName) return `Interviewer: ${r.interviewerName}`;
  return null;
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requireAdminPage();
  const { filter } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const active = activeFilter.key;
  const [all, now] = await Promise.all([getPendingApprovals(), serverNow()]);
  const nowMs = now.getTime();
  const rows = activeFilter.match ? all.filter(activeFilter.match) : all;
  const isProgramAdmin = ctx.roles.includes("PROGRAM_ADMIN");

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-ink">Approvals</h1>
      <p className="mb-4 text-ink-2">
        Every change to a result, attempt, cooldown or badge needs a second person. Approving here records that sign-off and applies the
        change straight away. Oldest requests are listed first.
        {!isProgramAdmin && " Program Admins decide these; you can follow progress here."}
      </p>

      <nav aria-label="Filter approvals" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = f.match ? all.filter(f.match).length : all.length;
          return (
            <Link
              key={f.key}
              href={f.key === "all" ? "/approvals" : `/approvals?filter=${f.key}`}
              aria-current={active === f.key ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium",
                active === f.key ? "bg-ink text-paper" : "border border-border bg-card text-ink"
              )}
            >
              {f.label} · {n}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3">
        {rows.length === 0 && <p className="rounded-2xl border border-border bg-card px-4 py-8 text-center text-sm text-ink-2">Nothing waiting here.</p>}
        {rows.map((r) => {
          const m = approvalTypeDef(r.action);
          const self = r.requestedById === ctx.userId;
          const isInterviewer = !!r.interviewerUserId && r.interviewerUserId === ctx.userId;
          const blocked = !isProgramAdmin ? "A Program Admin decides this." : self ? "Needs a different Program Admin (you filed it)." : isInterviewer ? "Needs a Program Admin who isn't the interviewer." : null;
          const about = subjectLine(r);
          return (
            <div key={r.id} className={cn("rounded-2xl border bg-card p-5", self ? "border-dashed border-border" : "border-border")}>
              <div className="flex flex-wrap items-center gap-2">
                <ApprovalTypeChip action={r.action} />
                <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                  <Clock className="size-3.5" aria-hidden />
                  Waiting {waitingFor(new Date(r.createdAtIso).getTime(), nowMs)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {about && <p className="font-semibold text-ink">{about}</p>}
                  {r.reason && <p className="text-ink">&ldquo;{r.reason}&rdquo;</p>}
                  {APPROVAL_EFFECT[r.action] && (
                    <p className="mt-1 text-sm text-ink">
                      <span className="font-medium">What approving does:</span> {APPROVAL_EFFECT[r.action]}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-ink-2">
                    {self ? "Requested by you" : `Requested by ${r.requestedByName ?? "unknown"}`} · <TimeIST value={r.createdAtIso} mode="day" />
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {m.group === "integrity" && r.caseId && (
                    <Link href={`/cases/${r.caseId}`} className={staffBtn.secondary}>
                      Review case {r.caseCode}
                      <ChevronRight className="size-4" aria-hidden />
                    </Link>
                  )}
                  {blocked ? (
                    <span className="text-sm text-ink-2">{blocked}</span>
                  ) : (
                    <>
                      <DeclineButton id={r.id} />
                      <ApproveButton
                        id={r.id}
                        effect={APPROVAL_EFFECT[r.action]}
                        title={
                          r.action === "NULLIFY"
                            ? "Approve nullifying this badge?"
                            : r.action === "DISQUALIFY"
                              ? "Approve disqualifying this student?"
                              : r.action === "EMERGENCY_WAIVER"
                                ? "Approve this emergency waiver?"
                                : `Approve this request (${m.label})?`
                        }
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
