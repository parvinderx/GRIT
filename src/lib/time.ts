import { DateTime } from "luxon";
import { IST } from "./env";

/** Works in both server and client code (luxon is isomorphic). */

export function toIST(value: Date | string | number): DateTime {
  const dt =
    value instanceof Date
      ? DateTime.fromJSDate(value)
      : typeof value === "number"
        ? DateTime.fromMillis(value)
        : DateTime.fromISO(value);
  return dt.setZone(IST);
}

/** "Sat, 28 Nov 2026 · 7:00 PM IST" */
export function formatIST(value: Date | string | number): string {
  return toIST(value).toFormat("ccc, d LLL yyyy · h:mm a") + " IST";
}

/** "Sat, 28 Nov" */
export function formatDayShort(value: Date | string | number): string {
  return toIST(value).toFormat("ccc d LLL");
}

/** "7:00 PM" */
export function formatTime(value: Date | string | number): string {
  return toIST(value).toFormat("h:mm a");
}

/** "7:00–7:30 PM IST" given start + duration minutes */
export function formatRangeIST(start: Date | string | number, durationMin: number): string {
  const s = toIST(start);
  const e = s.plus({ minutes: durationMin });
  return `${s.toFormat("h:mm")}–${e.toFormat("h:mm a")} IST`;
}

/** "Sat 28 Nov, 7:00 PM IST" */
export function dateTime(value: Date | string | number): string {
  return toIST(value).toFormat("ccc d LLL, h:mm a") + " IST";
}

/** "7:00 PM IST" */
export function timeOnly(value: Date | string | number): string {
  return toIST(value).toFormat("h:mm a") + " IST";
}

export const Morning = "Morning";
export const Afternoon = "Afternoon";
export const Evening = "Evening";

/** Group a start time into Morning (<12) / Afternoon (<17) / Evening */
export function partOfDay(value: Date | string | number): "Morning" | "Afternoon" | "Evening" {
  const h = toIST(value).hour;
  if (h < 12) return Morning;
  if (h < 17) return Afternoon;
  return Evening;
}

/** Whole days from `now` until `target` (IST calendar days). */
export function daysUntil(now: Date, target: Date): number {
  const a = toIST(now).startOf("day");
  const b = toIST(target).startOf("day");
  return Math.round(b.diff(a, "days").days);
}

/** "31 Dec" — e.g. the season deadline from seasons.deadline_at. */
export function formatDayMonth(value: Date | string | number): string {
  return toIST(value).toFormat("d LLL");
}

/** "just now" / "3 hours" / "2 days" — how long something has been waiting. */
export function waitingFor(sinceMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  if (mins < 60) return mins <= 1 ? "under a minute" : `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
