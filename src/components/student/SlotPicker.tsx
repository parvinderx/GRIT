"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/clientFetch";
import { DateTime } from "luxon";
import { toIST, formatTime, timeOnly, dateTime } from "@/lib/time";
import { RULES, HORIZON_DAYS, JOIN_OPEN_MINUTES, CHANGE_CUTOFF_HOURS } from "@/lib/rules";
import { cn } from "@/lib/utils";
import { IST } from "@/lib/env";
import { onRadioGroupKeyDown } from "@/lib/roving";
import { btnClass } from "./ui/Button";

type SlotTime = { startAt: string; count: number };

/** Book a time: pick a day, pick a time, confirm in the summary panel
 *  (desktop: sticky right column; phones: a bar pinned to the bottom). */
export function SlotPicker({
  journeyId,
  times,
  serverNowIso,
  bookByHuman,
  deadlineHuman,
  showDeadlineHint,
}: {
  journeyId: string;
  times: SlotTime[];
  serverNowIso: string;
  bookByHuman?: string | null;
  /** Season deadline, e.g. "31 Dec". */
  deadlineHuman?: string | null;
  showDeadlineHint?: boolean;
}) {
  const router = useRouter();

  const byDay = useMemo(() => {
    const m = new Map<string, SlotTime[]>();
    for (const t of times) {
      const key = toIST(t.startAt).toFormat("yyyy-MM-dd");
      m.set(key, [...(m.get(key) ?? []), t]);
    }
    return m;
  }, [times]);

  const days = useMemo(() => {
    const start = toIST(serverNowIso).startOf("day");
    const out: { key: string; dow: string; dom: string; cnt: number }[] = [];
    // Inclusive: services/slots.ts builds days 0..horizon (d <= horizon).
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const d = start.plus({ days: i });
      const key = d.toFormat("yyyy-MM-dd");
      out.push({ key, dow: d.toFormat("ccc"), dom: d.toFormat("dd"), cnt: (byDay.get(key) ?? []).length });
    }
    // trim trailing empty days beyond the last with availability (keep at least 7)
    let last = out.length - 1;
    while (last > 6 && out[last].cnt === 0) last--;
    return out.slice(0, last + 1);
  }, [serverNowIso, byDay]);

  const firstOpen = days.find((d) => d.cnt > 0)?.key ?? days[0]?.key ?? null;
  const [selectedDay, setSelectedDay] = useState<string | null>(firstOpen);
  const [selected, setSelected] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Below lg the summary is a fixed bottom bar. Reserve exactly its height at the
  // bottom of the page so it never covers the last times (it grows with the
  // taken-slot list, errors or expanded details).
  useEffect(() => {
    const container = containerRef.current;
    const panel = panelRef.current;
    if (!container || !panel || !selected) return;
    const desktop = window.matchMedia("(min-width: 64rem)");
    const apply = () => {
      container.style.paddingBottom = desktop.matches ? "" : `${Math.ceil(panel.getBoundingClientRect().height) + 16}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(panel);
    desktop.addEventListener("change", apply);
    return () => {
      ro.disconnect();
      desktop.removeEventListener("change", apply);
      container.style.paddingBottom = "";
    };
  }, [selected]);

  const dayTimes = selectedDay ? byDay.get(selectedDay) ?? [] : [];
  const groups: Record<string, SlotTime[]> = { Morning: [], Afternoon: [], Evening: [] };
  for (const t of dayTimes) {
    const h = toIST(t.startAt).hour;
    groups[h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"].push(t);
  }

  // Roving tab stops: the checked radio, else the first enabled one.
  const dateTabStop = days.some((d) => d.key === selectedDay && d.cnt > 0) ? selectedDay : (days.find((d) => d.cnt > 0)?.key ?? null);
  const timeTabStop = dayTimes.some((t) => t.startAt === selected) ? selected : (dayTimes[0]?.startAt ?? null);

  async function confirm(startAt: string) {
    setBusy(true);
    setError(null);
    setTaken(null);
    const r = await postJson<{ bookingId: string; nearest: string[] }>(
      "/api/v1/bookings",
      { journey_id: journeyId, start_at: startAt },
      { idempotent: true }
    );
    if (r.ok && r.data.bookingId) {
      router.push(`/booked/${r.data.bookingId}`);
      return;
    }
    setBusy(false);
    if (r.data.error === "SLOT_TAKEN") setTaken(r.data.nearest ?? []);
    else setError(r.message ?? "We couldn't book that time. Please try again.");
  }

  return (
    <div ref={containerRef} className="grid gap-5 lg:grid-cols-[1fr_360px]">
      {/* left: date + times */}
      <div className="min-w-0">
        {showDeadlineHint && bookByHuman && (
          <p className="mb-8 border-l-4 border-amberline bg-amberline-soft px-4 py-3 text-[15px] text-graphite">
            Book by <strong>{bookByHuman}</strong> to leave room for a retry. If this attempt isn&apos;t cleared, the next one opens after the {deadlineHuman ?? "season"} deadline.
          </p>
        )}
        {times[0] && (
          <p className="mb-6 text-[15px] text-pencil">
            Earliest open: <strong className="text-graphite">{dateTime(times[0].startAt)}</strong>
          </p>
        )}
        <h2 className="mb-3 text-xl font-extrabold text-graphite">Pick a day</h2>
        <div role="radiogroup" aria-label="Choose a date" onKeyDown={onRadioGroupKeyDown} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((d) => {
            const active = d.key === selectedDay;
            const full = d.cnt === 0;
            const few = d.cnt > 0 && d.cnt <= 2;
            return (
              <button
                key={d.key}
                role="radio"
                aria-checked={active}
                tabIndex={d.key === dateTabStop ? 0 : -1}
                disabled={full}
                onClick={() => {
                  setSelectedDay(d.key);
                  setSelected(null);
                }}
                className={cn(
                  "flex min-w-[76px] shrink-0 flex-col items-center rounded-lg border-[1.5px] px-3 py-2.5 disabled:cursor-not-allowed",
                  active ? "border-graphite bg-graphite text-white" : full ? "border-dashed border-rule text-pencil" : "border-rule bg-white text-graphite hover:border-graphite"
                )}
              >
                <span className="text-[14px]">{d.dow}</span>
                <span className="font-display text-xl font-extrabold leading-tight">{d.dom}</span>
                <span className={cn("mt-0.5 text-[13px] font-bold", active ? "text-white/80" : full ? "text-pencil" : few ? "text-amberline" : "text-mint")}>
                  {full ? "Full" : few ? `${d.cnt} left` : `${d.cnt} open`}
                </span>
              </button>
            );
          })}
        </div>

        <h2 className="mb-3 mt-10 text-xl font-extrabold text-graphite">
          Pick a time on {selectedDay ? DateTime.fromISO(selectedDay, { zone: IST }).toFormat("cccc d LLL") : "that day"}
          <span className="ml-2 text-[15px] font-normal text-pencil">IST</span>
        </h2>
        <div className="space-y-6" role="radiogroup" aria-label="Choose a time" onKeyDown={onRadioGroupKeyDown}>
          {(["Morning", "Afternoon", "Evening"] as const).map((part) =>
            groups[part].length ? (
              <div key={part}>
                <p className="mb-2 text-[15px] font-bold text-pencil">{part}</p>
                <div className="flex flex-wrap gap-2">
                  {groups[part].map((t) => {
                    const active = selected === t.startAt;
                    const few = t.count <= 2;
                    return (
                      <button
                        key={t.startAt}
                        role="radio"
                        aria-checked={active}
                        tabIndex={t.startAt === timeTabStop ? 0 : -1}
                        aria-label={`${toIST(t.startAt).toFormat("cccc d LLLL")}, ${formatTime(t.startAt)} IST${few ? ", few left" : ""}`}
                        onClick={() => setSelected(t.startAt)}
                        className={cn(
                          "flex min-h-12 min-w-[104px] flex-col items-center justify-center rounded-lg border-[1.5px] px-4 font-bold",
                          active ? "border-graphite bg-graphite text-white" : "border-rule bg-white text-graphite hover:border-graphite"
                        )}
                      >
                        {formatTime(t.startAt)}
                        {few && <span className={cn("text-[13px]", active ? "text-white/75" : "text-amberline")}>Few left</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null
          )}
          {dayTimes.length === 0 && <p className="text-pencil">No open times this day. Try another day above.</p>}
        </div>
      </div>

      {/* right: booking summary. Desktop: sticky column. Below lg, once a time is
          picked: a compact fixed bottom bar (details expand inside it). */}
      <div
        ref={panelRef}
        className={cn(
          "h-fit bg-white text-graphite lg:sticky lg:top-24 lg:rounded-xl lg:border-[1.5px] lg:border-graphite lg:p-6",
          selected
            ? "fixed inset-x-0 bottom-0 z-30 max-h-[85vh] overflow-y-auto border-t-[1.5px] border-graphite px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-6px_18px_rgba(29,33,41,0.12)] lg:inset-x-auto lg:bottom-auto lg:z-auto lg:max-h-none lg:overflow-visible lg:shadow-none"
            : "rounded-xl border-[1.5px] border-rule p-6"
        )}
      >
        <p className={cn("text-[15px] font-bold text-pencil", selected && "hidden lg:block")}>Your booking</p>
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-3 lg:block">
              <div>
                <p className="font-display text-2xl font-extrabold leading-tight lg:mt-2 lg:text-[2.5rem]">
                  {formatTime(selected)} <span className="text-base font-bold text-pencil lg:text-xl">IST</span>
                </p>
                <p className="text-[15px] font-bold lg:text-lg">{toIST(selected).toFormat("cccc d LLLL yyyy")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1 lg:hidden">
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  aria-expanded={showDetails}
                  aria-controls="booking-details"
                  className="min-h-11 rounded-lg px-3 text-[15px] font-semibold text-ballpoint underline underline-offset-4"
                >
                  {showDetails ? "Hide details" : "Details"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setTaken(null);
                    setError(null);
                  }}
                  className="min-h-11 rounded-lg border-[1.5px] border-graphite px-3 text-[15px] font-bold"
                >
                  Change
                </button>
              </div>
            </div>
            <div
              id="booking-details"
              className={cn(
                "my-3 grid-cols-2 gap-3 border-y border-rule py-3 text-[15px] lg:my-5 lg:grid lg:py-4",
                showDetails ? "grid" : "hidden"
              )}
            >
              <div>
                <p className="text-[14px] text-pencil">Join opens</p>
                <p className="font-bold">{timeOnly(DateTime.fromISO(selected).minus({ minutes: JOIN_OPEN_MINUTES }).toISO()!)}</p>
              </div>
              <div>
                <p className="text-[14px] text-pencil">Free changes until</p>
                <p className="font-bold">{dateTime(DateTime.fromISO(selected).minus({ hours: CHANGE_CUTOFF_HOURS }).toISO()!)}</p>
              </div>
            </div>
            {taken && (
              <div className="mb-3 mt-3 border-l-4 border-amberline bg-amberline-soft p-3 text-graphite lg:mt-0">
                <p className="text-[15px] font-bold">Someone just booked {formatTime(selected)}. These times are still open:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {taken.map((t) => (
                    <button key={t} disabled={busy} onClick={() => { setSelected(t); void confirm(t); }} className="min-h-11 rounded-lg border-[1.5px] border-graphite bg-white px-3 text-[14px] font-bold text-graphite">
                      {toIST(t).toFormat("ccc d LLL")}, {formatTime(t)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="mb-3 mt-3 border-l-4 border-graphite bg-rule-soft p-3 text-[15px] lg:mt-0">{error}</p>}
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg bg-rule-soft p-3 text-[15px] lg:mt-0">
              <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-graphite" />
              <span>I&apos;ll join on time with my camera on and college ID ready. {RULES.missed}</span>
            </label>
            <button
              disabled={!agreed || busy}
              onClick={() => confirm(selected)}
              className={btnClass("next", "mt-3 w-full lg:mt-4")}
            >
              {busy ? "Booking…" : "Confirm booking"}
            </button>
            {!agreed && !busy && <p className="mt-2 text-[14px] text-pencil">Tick the box above to confirm.</p>}
          </>
        ) : (
          <p className="mt-3 text-pencil">Pick a day and a time. Your booking shows up here before you confirm.</p>
        )}
      </div>
    </div>
  );
}
