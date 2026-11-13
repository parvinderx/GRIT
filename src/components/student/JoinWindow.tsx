"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Video } from "lucide-react";
import { formatTime, timeOnly } from "@/lib/time";
import { JOIN_GRACE_MINUTES } from "@/lib/rules";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/clientFetch";
import { TestSetupButton } from "./TestSetupButton";
import { HeroFrame } from "./ui/Hero";
import { btnClass } from "./ui/Button";

const CHECKS = ["Camera and mic work", "Stable Wi-Fi or mobile data", "College ID card in hand", "Quiet spot, no other tabs or AI tools"];

export function JoinWindow({
  bookingId,
  startIso,
  joinByIso,
  interviewerFirstName,
  waiting,
  bookingCode,
}: {
  bookingId: string;
  startIso: string;
  joinByIso: string;
  interviewerFirstName: string | null;
  waiting: boolean;
  /** Shown so the student can read it out to the interviewer. */
  bookingCode: string | null;
}) {
  const [ticked, setTicked] = useState<boolean[]>([false, false, false, false]);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<{ name: string | null; code: string } | null>(null);
  const ready = ticked.filter(Boolean).length;
  const allReady = ready === 4;

  async function post(path: string, body?: unknown) {
    setBusy(true);
    try {
      const r = await postJson<{ interviewerFirstName: string | null; bookingCode: string }>(path, body, { idempotent: !body });
      return { ok: r.ok, json: { ...r.data, message: r.message } };
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    const { ok, json } = await post(`/api/v1/bookings/${bookingId}/join`, {});
    if (ok) setJoined({ name: json.interviewerFirstName ?? null, code: json.bookingCode ?? "" });
    else toast.error(json.message ?? "Join isn't open yet");
  }
  async function absent() {
    const { ok, json } = await post(`/api/v1/bookings/${bookingId}/interviewer-absent`);
    if (ok) toast.success((json as { message?: string }).message ?? "We've alerted the interview team. Stay on this page while they sort it out.");
    else toast.error(json.message ?? "You can report this from 5 minutes after the start time.");
  }

  if (joined) {
    return (
      <HeroFrame
        headingId="join-title"
        status={{ tone: "live", icon: "Radio", text: "You're in", pulse: true }}
        headline="You're in the room"
        note={
          <p>
            Your interviewer{joined.name ? ` is ${joined.name}` : " will be with you shortly"}. Read out your booking code{" "}
            <strong className="tracking-[0.12em] text-graphite">{joined.code}</strong> when they ask, and keep your college ID ready.
          </p>
        }
      />
    );
  }

  return (
    <HeroFrame
      headingId="join-title"
      status={{ tone: "live", icon: "Radio", text: waiting ? "Waiting for your interviewer" : "Live now", pulse: true }}
      headline={waiting ? `Your interview started at ${formatTime(startIso)} IST` : `Your interview starts at ${formatTime(startIso)} IST`}
      note={
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <dt className="text-[15px] text-pencil">Interviewer</dt>
            <dd className="font-display text-xl font-extrabold text-graphite">{interviewerFirstName ?? "Being assigned"}</dd>
          </div>
          <div>
            <dt className="text-[15px] text-pencil">Join by</dt>
            <dd className="font-display text-xl font-extrabold text-graphite">{timeOnly(joinByIso)}</dd>
          </div>
        </dl>
      }
      actions={
        <div className="w-full">
          {bookingCode && (
            <p className="text-graphite">
              Your booking code is{" "}
              <strong className="font-display text-2xl font-extrabold tracking-[0.2em]">{bookingCode}</strong>. Read it out to your
              interviewer when you join.
            </p>
          )}
          <button onClick={join} disabled={!allReady || busy} className={btnClass("live", "mt-4 w-full max-w-md sm:w-auto sm:min-w-[260px]")}>
            <Video className="size-5" aria-hidden /> {busy ? "Joining…" : "Join interview"}
          </button>
          <p className="mt-2 text-[15px] text-pencil">
            {!allReady ? `Tick the ${4 - ready} remaining check${4 - ready === 1 ? "" : "s"}. ` : ""}
            After {timeOnly(joinByIso)} ({JOIN_GRACE_MINUTES} min after the start) it counts as missed.
          </p>
          {waiting && (
            <button onClick={absent} disabled={busy} className={btnClass("link", "mt-2")}>
              My interviewer hasn&apos;t joined
            </button>
          )}
        </div>
      }
      aside={
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-extrabold text-graphite">Before you join</h2>
            <span className="text-[15px] text-pencil">{ready} of 4 ready</span>
          </div>
          <div className="mt-2 flex gap-1" aria-hidden>
            {CHECKS.map((_, i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-full", ticked[i] ? "bg-mint" : "bg-rule")} />
            ))}
          </div>
          <div className="mt-2 divide-y divide-rule">
            {CHECKS.map((label, i) => (
              <button
                key={label}
                type="button"
                role="checkbox"
                aria-checked={ticked[i]}
                onClick={() => setTicked((t) => t.map((v, j) => (j === i ? !v : v)))}
                className="flex min-h-12 w-full items-center gap-3 py-2 text-left"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md border-[1.5px]",
                    ticked[i] ? "border-mint bg-mint text-white" : "border-graphite bg-white text-transparent"
                  )}
                >
                  <Check className="size-4" strokeWidth={3} aria-hidden="true" />
                </span>
                <span className="text-graphite">{label}</span>
              </button>
            ))}
          </div>
          <TestSetupButton className={btnClass("link", "mt-2")} />
        </div>
      }
    />
  );
}
