import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAdminPage } from "@/lib/auth";
import { getCaseList } from "@/services/adminView";
import { TimeIST } from "@/components/primitives/TimeIST";
import { CaseStatusChip } from "@/components/primitives/StatusChip";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "all", label: "All", empty: "No integrity cases yet." },
  { key: "open", label: "Needs decision", empty: "No cases need a decision right now." },
  { key: "decided", label: "Decided", empty: "No cases have been decided yet." },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const needsDecision = (status: string) => status === "TRIAGE" || status === "OPEN";

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdminPage();
  const { filter } = await searchParams;
  const active: FilterKey = FILTERS.find((f) => f.key === filter)?.key ?? "all";
  const all = await getCaseList(); // already sorted: triage → under review → decided (newest first)
  const counts: Record<FilterKey, number> = {
    all: all.length,
    open: all.filter((c) => needsDecision(c.status)).length,
    decided: all.filter((c) => !needsDecision(c.status)).length,
  };
  const cases = active === "all" ? all : all.filter((c) => (active === "open" ? needsDecision(c.status) : !needsDecision(c.status)));
  const emptyText = FILTERS.find((f) => f.key === active)!.empty;

  return (
    <div>
      <h1 className="mb-1 font-heading text-2xl font-bold text-ink">Integrity cases</h1>
      <p className="mb-4 text-sm text-ink-2">A Program Admin who didn&apos;t open a case decides it: dismiss, or confirm as a nullify or a disqualification. Opening a case doesn&apos;t put anything on hold, and confirming only changes journeys that are already on hold.</p>

      <nav aria-label="Filter cases" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/cases" : `/cases?filter=${f.key}`}
            aria-current={active === f.key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium",
              active === f.key ? "bg-ink text-paper" : "border border-border bg-card text-ink"
            )}
          >
            {f.label} · {counts[f.key]}
          </Link>
        ))}
      </nav>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {cases.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-2">{emptyText}</li>}
        {cases.map((c) => (
          <li key={c.id}>
            <Link href={`/cases/${c.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-accent">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {c.studentName ?? "Unknown student"} <span className="font-mono text-sm text-ink-2">· {c.code}</span>
                </p>
                <p className="truncate text-sm text-ink-2">{c.reason ?? "Integrity concern"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <CaseStatusChip status={c.status} />
                <span className="text-xs text-ink-2">
                  {c.decidedAtIso ? <>Decided <TimeIST value={c.decidedAtIso} mode="day" /></> : <>Opened <TimeIST value={c.createdAtIso} mode="day" /></>}
                </span>
                <ChevronRight className="size-4 text-ink-2" aria-hidden />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
