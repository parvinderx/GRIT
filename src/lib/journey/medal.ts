import type { JourneyView } from "@/services/studentView";
import type { MedalState } from "@/components/student/ui/BadgeMedal";
import { trackChip } from "./trackChip";

/** Which medal a journey shows. Pairs with trackChip(), which supplies the words. */
export function medalStateOf(j: JourneyView, group: JourneyView[]): MedalState {
  switch (j.state) {
    case "PASSED":
      return "earned";
    case "NULLIFIED":
      return "nullified";
    case "AWAITING_RESULT":
    case "ON_HOLD":
      return "pending";
    case "BOOKED":
      return "booked";
    case "ELIGIBLE":
      return "ready";
    case "FAILED":
    case "RETAKE_LATER":
    case "NO_SHOW":
      return "waiting";
    case "CLOSED":
      return "closed";
    case "LOCKED": {
      // Waiting on the badge below vs. skills still to clear.
      const below = j.badgeLevel > 1 ? group.find((g) => g.badgeLevel === j.badgeLevel - 1) : undefined;
      if (below && below.state !== "PASSED") return "locked";
      return j.skillsTotal > 0 && j.skillsCleared < j.skillsTotal ? "progress" : "locked";
    }
  }
}

/** Medal + its words for one journey: state, arc progress, caption and accessible label. */
export function medalFor(j: JourneyView, group: JourneyView[]) {
  const state = medalStateOf(j, group);
  const chip = trackChip(j, group, { withDate: true });
  const level = j.badgeName.split("·")[1]?.trim() ?? "";
  const caption =
    state === "earned" && j.ctx.interviewDateLongHuman ? `Earned ${j.ctx.interviewDateLongHuman}` : chip.chipLabel;
  return {
    state,
    level: j.badgeLevel,
    track: j.trackCode,
    progress: j.skillsTotal > 0 ? j.skillsCleared / j.skillsTotal : 0,
    caption,
    label: `${j.trackName} ${level}: ${caption}`,
    isNew: !!j.ctx.earnedRecently,
  };
}
