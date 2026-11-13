import type { JourneyView } from "@/services/studentView";
import { STATUS, type ChipDef } from "./statusConfig";

/** "AI Product Mastery · Novice" → "Novice". */
export function badgeShort(badgeName: string): string {
  return badgeName.split("·")[1]?.trim() ?? "Novice";
}

/**
 * Status chip for one badge row in a track list (dashboard + Tracks page).
 * `withDate` adds the interview date to a booked row — off on the dashboard,
 * where the hero already shows it.
 */
export function trackChip(j: JourneyView, group: JourneyView[], opts: { withDate?: boolean } = {}): ChipDef {
  if (j.state === "BOOKED") {
    return opts.withDate && j.ctx.interviewDateHuman
      ? { chipLabel: `Booked for ${j.ctx.interviewDateHuman}`, tone: "scheduled", icon: "CalendarCheck" }
      : STATUS.BOOKED;
  }
  if (j.state === "LOCKED") {
    if (j.badgeLevel > 1) {
      const prereq = group.find((g) => g.badgeLevel === j.badgeLevel - 1);
      if (prereq && prereq.state !== "PASSED") return { chipLabel: `Earn ${badgeShort(prereq.badgeName)} first`, tone: "neutral", icon: "Lock" };
    }
    const left = j.skillsTotal - j.skillsCleared;
    return { chipLabel: left > 0 ? `${left} skill${left === 1 ? "" : "s"} to go` : "Locked", tone: "neutral", icon: "Lock" };
  }
  // A dated way back after a result (spec: "Not cleared — reattempt from 12 Dec").
  const until = j.ctx.nextUnlockDateHuman;
  if (j.state === "FAILED" && until && !j.ctx.cooldownPastDeadline) return { ...STATUS.FAILED, chipLabel: `Reattempt from ${until}` };
  if (j.state === "RETAKE_LATER" && until && !j.ctx.cooldownPastDeadline) return { ...STATUS.RETAKE_LATER, chipLabel: `Retake from ${until}` };
  if (j.state === "NO_SHOW" && until && !j.ctx.cooldownPastDeadline) return { ...STATUS.NO_SHOW, chipLabel: `Rebook from ${until}` };
  if (j.state === "AWAITING_RESULT" && j.ctx.resultAtHuman) return { ...STATUS.AWAITING_RESULT, chipLabel: `Result at ${j.ctx.resultAtHuman}` };
  return STATUS[j.state];
}

/** A row's own "Book" button — only when the server allows booking this journey now. */
export function trackBookHref(j: JourneyView): string | undefined {
  return j.allowed.includes("book") || j.allowed.includes("rebook_now") ? `/book/${j.journeyId}` : undefined;
}
