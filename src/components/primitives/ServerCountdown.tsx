"use client";

import { useEffect, useState } from "react";

/**
 * Counts down to a target instant using the SERVER clock, not the device clock:
 * we anchor to server_time from the page load and advance by locally-elapsed ms.
 * (The simulated clock can jump; a page refresh re-anchors.)
 */
export function ServerCountdown({
  targetIso,
  serverNowIso,
  className,
  expiredText = "now",
  compact = false,
}: {
  targetIso: string;
  serverNowIso: string;
  className?: string;
  expiredText?: string;
  compact?: boolean;
}) {
  const target = new Date(targetIso).getTime();
  const serverNow = new Date(serverNowIso).getTime();
  // Render is pure: the first paint uses the server instant; an interval advances it by
  // locally-elapsed time. `anchor` ties the state to the serverNow it was computed from,
  // so a refresh with a new server_time re-anchors without a setState-in-effect.
  const [clock, setClock] = useState({ anchor: serverNow, now: serverNow });

  useEffect(() => {
    const startedLocal = Date.now();
    const id = setInterval(() => setClock({ anchor: serverNow, now: serverNow + (Date.now() - startedLocal) }), 1000);
    return () => clearInterval(id);
  }, [serverNow]);

  const effectiveNow = clock.anchor === serverNow ? clock.now : serverNow;
  let ms = target - effectiveNow;
  if (ms <= 0) return <span className={className}>{expiredText}</span>;

  const d = Math.floor(ms / 86_400_000);
  ms -= d * 86_400_000;
  const h = Math.floor(ms / 3_600_000);
  ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000);
  ms -= m * 60_000;
  const s = Math.floor(ms / 1000);

  const parts = compact
    ? [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean)
    : [d && `${d}d`, `${h}h`, `${m}m`, !d && `${s}s`].filter(Boolean);

  return (
    <span className={className} aria-live="off">
      {parts.join(" ")}
    </span>
  );
}
