import type { LucideIcon } from "lucide-react";
import { Icon } from "./Icon";
import {
  STATUS,
  SLOT_STATUS,
  RISK_STATUS,
  caseStatusDef,
  approvalTypeDef,
  type ChipTone,
  type StatusDef,
} from "@/lib/journey/statusConfig";
import type { JourneyState } from "@/lib/state-machine";
import type { RowKind } from "@/services/interviewerView";
import type { DeadlineRisk } from "@/services/adminView";
import { cn } from "@/lib/utils";

/**
 * One meaning per tone (see statusConfig ChipTone). Amber text on its own 10% tint is
 * ~3:1, so the waiting tone uses ink text with an amber icon + border for ≥4.5:1.
 */
const TONES: Record<ChipTone, { chip: string; icon?: string }> = {
  good: { chip: "bg-saffron text-saffron-ink border-saffron" },
  pending: { chip: "bg-amber/10 text-ink border-amber/50", icon: "text-amber" },
  action: { chip: "bg-alert/10 text-alert border-alert/30" },
  review: { chip: "bg-review/10 text-review border-review/30" },
  live: { chip: "bg-go/10 text-go border-go/25" },
  scheduled: { chip: "bg-transparent text-cobalt border-cobalt/50" },
  cobaltSoft: { chip: "bg-cobalt/10 text-cobalt border-cobalt/20" },
  neutral: { chip: "bg-paper-2 text-ink border-ink/15" },
  muted: { chip: "bg-paper-2 text-ink-2 border-ink/10" },
  open: { chip: "bg-transparent text-ink-2 border-dashed border-ink/30" },
};

/** Status chip — always icon + text (never colour alone). Icon is decorative; text is the name. */
export function StatusChip({
  tone,
  icon,
  label,
  className,
}: {
  tone: ChipTone;
  /** Icon-map name (journey chips) or a lucide component. */
  icon: string | LucideIcon;
  label: string;
  className?: string;
}) {
  const t = TONES[tone];
  const iconCls = cn("size-3.5 shrink-0", t.icon);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        t.chip,
        className
      )}
    >
      {typeof icon === "string" ? <Icon name={icon} className={iconCls} aria-hidden /> : <LucideGlyph icon={icon} className={iconCls} />}
      {label}
    </span>
  );
}

function LucideGlyph({ icon: Glyph, className }: { icon: LucideIcon; className?: string }) {
  return <Glyph className={className} aria-hidden />;
}

function DefChip({ def, className }: { def: StatusDef; className?: string }) {
  return <StatusChip tone={def.tone} icon={def.icon} label={def.label} className={className} />;
}

/** Convenience: chip straight from a stored journey state. */
export function StateChip({ state, className }: { state: JourneyState; className?: string }) {
  const d = STATUS[state];
  return <StatusChip tone={d.tone} icon={d.icon} label={d.chipLabel} className={className} />;
}

/** Interviewer schedule row status. */
export function SlotStatusChip({ kind, label, className }: { kind: RowKind; label?: string; className?: string }) {
  const def = SLOT_STATUS[kind];
  return <DefChip def={label ? { ...def, label } : def} className={className} />;
}

/** Integrity case status (raw DB enum in, human label out). */
export function CaseStatusChip({ status, className }: { status: string; className?: string }) {
  return <DefChip def={caseStatusDef(status)} className={className} />;
}

/** Deadline risk on the admin tracker. */
export function RiskChip({ risk, className }: { risk: DeadlineRisk; className?: string }) {
  return <DefChip def={RISK_STATUS[risk]} className={className} />;
}

/** Approval request type. */
export function ApprovalTypeChip({ action, className }: { action: string; className?: string }) {
  return <DefChip def={approvalTypeDef(action)} className={className} />;
}
