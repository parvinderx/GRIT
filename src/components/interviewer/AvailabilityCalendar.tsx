"use client";

import { DateTime } from "luxon";
import { CalendarOff, Flag, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CalendarMark {
  date: string; // YYYY-MM-DD
  kind: "ADD" | "REMOVE";
  unsaved: boolean;
}

/**
 * Read-only month view of date overrides (including unsaved ones), today and the
 * badge deadline. Shows the current month through the deadline month (max 2), so
 * you can see weekday alignment when choosing override dates.
 */
export function AvailabilityCalendar({
  today,
  deadlineDate,
  marks,
}: {
  today: string;
  deadlineDate: string | null;
  marks: CalendarMark[];
}) {
  const t = DateTime.fromISO(today);
  const first = t.startOf("month");
  const months = [first];
  if (deadlineDate) {
    const d = DateTime.fromISO(deadlineDate).startOf("month");
    if (d > first) months.push(first.plus({ months: 1 }));
  }
  const byDate = new Map(marks.map((m) => [m.date, m]));

  return (
    <div className="rounded-xl border border-rule bg-white p-4">
      <div className="space-y-4">
        {months.map((m) => (
          <Month key={m.toISODate()} month={m} today={today} deadlineDate={deadlineDate} byDate={byDate} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-pencil" aria-label="Calendar legend">
        <li className="flex items-center gap-1"><CalendarOff className="size-3.5" aria-hidden="true" />Off: day off</li>
        <li className="flex items-center gap-1"><Plus className="size-3.5 text-ballpoint" aria-hidden="true" />Extra: extra hours</li>
        {deadlineDate && (
          <li className="flex items-center gap-1"><Flag className="size-3.5 text-graphite" aria-hidden="true" />Badge deadline</li>
        )}
        <li className="flex items-center gap-1"><span className="inline-block size-3.5 rounded border border-dashed border-pencil" aria-hidden="true" />Not saved yet</li>
      </ul>
    </div>
  );
}

function Month({
  month,
  today,
  deadlineDate,
  byDate,
}: {
  month: DateTime;
  today: string;
  deadlineDate: string | null;
  byDate: Map<string, CalendarMark>;
}) {
  const lead = month.weekday - 1; // Monday-first: luxon weekday 1=Mon..7=Sun
  const days = month.daysInMonth ?? 30;
  const cells: (DateTime | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => month.plus({ days: i })),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks: (DateTime | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <table className="w-full table-fixed border-separate border-spacing-0.5 text-center text-xs">
      <caption className="mb-1 text-left font-display text-[15px] font-extrabold text-graphite">{month.toFormat("LLLL yyyy")}</caption>
      <thead>
        <tr>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <th key={d} scope="col" abbr={d} className="py-1 font-normal text-pencil">
              <span aria-hidden="true">{d.slice(0, 2)}</span>
              <span className="sr-only">{d}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((w, wi) => (
          <tr key={wi}>
            {w.map((d, di) => {
              if (!d) return <td key={di} />;
              const iso = d.toISODate()!;
              const mk = byDate.get(iso);
              const past = iso < today;
              const isToday = iso === today;
              const deadline = iso === deadlineDate;
              const parts = [
                d.toFormat("ccc d LLL"),
                isToday && "today",
                mk && (mk.kind === "REMOVE" ? "day off" : "extra hours"),
                mk?.unsaved && "not saved yet",
                deadline && "badge deadline",
              ].filter(Boolean);
              return (
                <td
                  key={di}
                  className={cn(
                    "h-8 rounded-md align-middle leading-tight",
                    past ? "text-pencil/70" : "text-graphite",
                    mk?.kind === "REMOVE" && "bg-rule-soft",
                    mk?.kind === "ADD" && "bg-ballpoint-soft text-ballpoint",
                    mk?.unsaved && "outline outline-1 -outline-offset-1 outline-dashed outline-pencil",
                    deadline && "border-[1.5px] border-graphite",
                    isToday && "font-bold underline underline-offset-2"
                  )}
                >
                  <span className="sr-only">{parts.join(", ")}</span>
                  <span aria-hidden="true" className="flex flex-col items-center">
                    <span className="flex items-center gap-0.5">
                      {d.day}
                      {deadline && <Flag className="size-3 text-graphite" />}
                    </span>
                    {mk && <span className="text-[10px] font-bold">{mk.kind === "REMOVE" ? "Off" : "Extra"}</span>}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
