"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * A ticking countdown anchored to the SERVER clock (the simulated clock can jump;
 * each server render re-anchors). More than a day out it shows days, hours and
 * minutes; inside a day it shows hours, minutes and seconds.
 * When it reaches zero it refreshes the page once, so the server can move the
 * screen on (e.g. booked → join open).
 */
export function LiveCountdown({
  targetIso,
  serverNowIso,
  label,
  doneText,
  refreshAtZero = true,
  alsoRefreshAtIso,
  size = "lg",
  className,
}: {
  targetIso: string;
  serverNowIso: string;
  /** e.g. "Join opens in" */
  label: string;
  /** Shown once the target has passed. */
  doneText: string;
  refreshAtZero?: boolean;
  /** An earlier instant that should also refresh the page once (e.g. join opening before the start). */
  alsoRefreshAtIso?: string;
  size?: "lg" | "sm";
  className?: string;
}) {
  const router = useRouter();
  const target = new Date(targetIso).getTime();
  const serverNow = new Date(serverNowIso).getTime();
  const [clock, setClock] = useState({ anchor: serverNow, now: serverNow });
  // The instant each refresh last fired for: a new target (e.g. the next interview) can fire again.
  const refreshedFor = useRef<number | null>(null);
  const refreshedEarlyFor = useRef<number | null>(null);
  const early = alsoRefreshAtIso ? new Date(alsoRefreshAtIso).getTime() : null;

  useEffect(() => {
    const startedLocal = Date.now();
    const id = setInterval(() => setClock({ anchor: serverNow, now: serverNow + (Date.now() - startedLocal) }), 1000);
    return () => clearInterval(id);
  }, [serverNow]);

  const now = clock.anchor === serverNow ? clock.now : serverNow;
  const ms = target - now;

  useEffect(() => {
    if (ms <= 0 && refreshAtZero && refreshedFor.current !== target && target > serverNow) {
      refreshedFor.current = target;
      router.refresh();
    }
  }, [ms, refreshAtZero, router, target, serverNow]);

  useEffect(() => {
    if (early != null && now >= early && early > serverNow && refreshedEarlyFor.current !== early) {
      refreshedEarlyFor.current = early;
      router.refresh();
    }
  }, [early, now, serverNow, router]);

  if (ms <= 0) {
    return <p className={cn("font-bold text-mint", size === "lg" ? "text-xl" : "text-base", className)}>{doneText}</p>;
  }

  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const units: [number, string][] = d > 0 ? [[d, d === 1 ? "day" : "days"], [h, "hours"], [m, "min"]] : [[h, "hours"], [m, "min"], [s, "sec"]];
  const spoken = units.map(([n, u]) => `${n} ${u}`).join(" ");

  return (
    <div className={className}>
      <p className={cn("font-bold text-pencil", size === "lg" ? "text-[15px]" : "text-[14px]")}>{label}</p>
      <p className="sr-only">{spoken}</p>
      <div className="mt-1 flex items-end gap-2" aria-hidden>
        {units.map(([n, u], i) => (
          <div key={u} className="flex items-end gap-2">
            {i > 0 && <span className={cn("pb-5 font-display font-extrabold text-rule", size === "lg" ? "text-3xl" : "text-xl")}>:</span>}
            <div className="text-center">
              <span
                className={cn(
                  "block rounded-lg border-[1.5px] border-graphite bg-white font-display font-black tabular-nums leading-none text-graphite",
                  size === "lg" ? "min-w-[3.5rem] px-2 py-2 text-[2.25rem]" : "min-w-[2.5rem] px-1.5 py-1 text-xl"
                )}
              >
                {String(n).padStart(2, "0")}
              </span>
              <span className="mt-1 block text-[13px] text-pencil">{u}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
