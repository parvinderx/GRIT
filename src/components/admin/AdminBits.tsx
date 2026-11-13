import { RiskChip } from "@/components/primitives/StatusChip";
import type { DeadlineRisk } from "@/services/adminView";

/** Deadline risk — shared status chip (icon + text, never colour alone). */
export function DeadlineRiskBadge({ risk }: { risk: DeadlineRisk }) {
  return <RiskChip risk={risk} />;
}
