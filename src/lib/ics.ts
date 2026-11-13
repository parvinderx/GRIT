import { DateTime } from "luxon";

/** Minimal, spec-correct iCalendar (RFC 5545) VEVENT builder. */
export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startIso: string; // UTC ISO
  durationMinutes: number;
  /** Stamp for DTSTAMP; defaults to startIso so output stays deterministic. */
  stampIso?: string;
}

function toUtcStamp(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).toFormat("yyyyLLdd'T'HHmmss'Z'");
}

/** Escape per RFC 5545 §3.3.11 (TEXT): backslash, comma, semicolon, newline. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function buildIcs(ev: IcsEvent): string {
  const dtStart = toUtcStamp(ev.startIso);
  const dtEnd = toUtcStamp(DateTime.fromISO(ev.startIso, { zone: "utc" }).plus({ minutes: ev.durationMinutes }).toISO()!);
  const dtStamp = toUtcStamp(ev.stampIso ?? ev.startIso);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GRIT//Interview Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(ev.title)}`,
    ev.description ? `DESCRIPTION:${esc(ev.description)}` : null,
    ev.location ? `LOCATION:${esc(ev.location)}` : null,
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(ev.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean) as string[];

  // RFC 5545 requires CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}
