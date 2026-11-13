"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toIST, formatTime } from "@/lib/time";
import { TestSetupButton } from "./TestSetupButton";
import { ConfirmDialog } from "@/components/primitives/ConfirmDialog";
import { postJson, requestJson } from "@/lib/clientFetch";
import { FREE_CHANGES } from "@/lib/rules";
import type { BookingWindowState } from "@/services/bookingView";
import { btnClass } from "./ui/Button";

/** How many IST days of open times the reschedule picker shows. */
const PICKER_DAYS = 4;

type SlotTime = { startAt: string; count: number };
type Resp = { bookingId?: string; interviewerFirstName?: string | null; bookingCode?: string; message?: string };

export function MyInterviewActions({
  bookingId,
  journeyId,
  startIso,
  windowState,
  changesLeft,
}: {
  bookingId: string;
  journeyId: string;
  /** Current start — excluded from the reschedule picker. */
  startIso: string;
  windowState: BookingWindowState;
  changesLeft: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [times, setTimes] = useState<SlotTime[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [reported, setReported] = useState(false);

  async function post(path: string, body?: unknown): Promise<{ ok: boolean; json: Resp }> {
    setBusy(true);
    try {
      const r = await postJson<Resp>(path, body, { idempotent: true });
      return { ok: r.ok, json: { ...r.data, message: r.message } };
    } finally {
      setBusy(false);
    }
  }

  async function openReschedule() {
    setRescheduling(true);
    setLoadingTimes(true);
    // Server-side filter: only starts a reschedule accepts (>= change cutoff from now, not the current time).
    const qs = new URLSearchParams({ for: "reschedule", exclude: startIso });
    const r = await requestJson<{ times: SlotTime[] }>("GET", `/api/v1/journeys/${journeyId}/available-times?${qs}`);
    setLoadingTimes(false);
    if (!r.ok) toast.error(r.message ?? "Couldn't load open times");
    setTimes(r.data.times ?? []);
  }

  async function doReschedule(startAt: string) {
    const { ok, json } = await post(`/api/v1/bookings/${bookingId}/reschedule`, { start_at: startAt });
    if (ok && json.bookingId) {
      toast.success("Rescheduled");
      router.push(`/booked/${json.bookingId}`);
      return true;
    }
    toast.error(json.message ?? "Couldn't reschedule");
    return false;
  }

  async function doCancel() {
    const { ok, json } = await post(`/api/v1/bookings/${bookingId}/cancel`);
    if (ok) {
      toast.success("Booking cancelled. You can book a new time from your dashboard.");
      router.push("/home");
      return true;
    }
    toast.error(json.message ?? "Couldn't cancel");
    return false;
  }

  async function doEmergency(reason: string) {
    const { ok, json } = await post(`/api/v1/bookings/${bookingId}/emergency`, { reason });
    if (ok) {
      setReported(true);
      toast.success("Reported. The team will decide within 1 working day.");
      return true;
    }
    toast.error(json.message ?? "Couldn't report");
    return false;
  }

  const changesAfter = Math.max(0, changesLeft - 1);
  const changesNote = `This uses 1 of your free changes (${changesAfter} left after this). It doesn't count as an attempt.`;
  // Cancelling ends this booking; the next booking starts with a fresh set of changes.
  const cancelNote = `You'll need to book a new time before the deadline. Your next booking comes with ${FREE_CHANGES} free changes. Cancelling doesn't count as an attempt.`;

  // Group open times by IST day; show the first few days with openings.
  const days: { label: string; items: SlotTime[] }[] = [];
  for (const t of times) {
    const label = toIST(t.startAt).toFormat("cccc d LLL");
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(t);
    else if (days.length < PICKER_DAYS) days.push({ label, items: [t] });
    else break;
  }

  const link = btnClass("link");

  return (
    <div className="w-full space-y-3">
      {windowState === "under12h" && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <TestSetupButton className={btnClass("outline")} />
          {reported ? (
            <p className="text-[15px] text-pencil">Emergency reported. The team will decide within 1 working day.</p>
          ) : (
            <ConfirmDialog
              tone="student"
              title="Report an emergency?"
              impact={<p>The interview team reviews it within 1 working day and tells you what happens next.</p>}
              reason={{ label: "What happened?", placeholder: "e.g. Family emergency, travelling to hospital.", minLength: 10 }}
              confirmLabel="Send report"
              onConfirm={doEmergency}
              trigger={(open) => (
                <button onClick={open} disabled={busy} className={link}>
                  Report an emergency
                </button>
              )}
            />
          )}
        </div>
      )}

      {windowState === "scheduled" && (
        <>
          {!rescheduling ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <button onClick={openReschedule} disabled={busy || changesLeft <= 0} className={btnClass("outline")}>
                Change the time
              </button>
              <ConfirmDialog
                title="Cancel this interview?"
                impact={<p>{cancelNote}</p>}
                confirmLabel="Cancel interview"
                tone="student"
                onConfirm={doCancel}
                trigger={(open) => (
                  <button
                    onClick={open}
                    disabled={busy || changesLeft <= 0}
                    className={`${link} disabled:text-pencil disabled:no-underline`}
                  >
                    Cancel booking
                  </button>
                )}
              />
              <TestSetupButton className={link} />
              <p className="w-full text-[15px] text-pencil">
                {changesLeft > 0
                  ? `${changesLeft} free change${changesLeft === 1 ? "" : "s"} left`
                  : "You've used your free changes. For an emergency, contact Help."}
              </p>
            </div>
          ) : (
            <div className="w-full max-w-xl rounded-xl border-[1.5px] border-graphite bg-white p-4">
              <p className="mb-3 text-lg font-extrabold text-graphite">
                Pick a new time <span className="text-[15px] font-normal text-pencil">IST</span>
              </p>
              <div className="max-h-80 space-y-4 overflow-y-auto">
                {loadingTimes && <span className="text-pencil">Loading open times…</span>}
                {!loadingTimes &&
                  days.map((d) => (
                    <div key={d.label}>
                      <p className="mb-2 text-[15px] font-bold text-pencil">{d.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {d.items.map((t) => (
                          <ConfirmDialog
                            tone="student"
                            key={t.startAt}
                            title={`Move your interview to ${toIST(t.startAt).toFormat("ccc d LLL")}, ${formatTime(t.startAt)} IST?`}
                            impact={<p>{changesNote}</p>}
                            confirmLabel="Move interview"
                            onConfirm={() => doReschedule(t.startAt)}
                            trigger={(open) => (
                              <button onClick={open} disabled={busy} className="min-h-11 min-w-[88px] rounded-lg border-[1.5px] border-rule bg-white px-3 font-bold text-graphite hover:border-graphite">
                                {formatTime(t.startAt)}
                              </button>
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                {!loadingTimes && times.length === 0 && <span className="text-pencil">No open times right now. New times open at 8 PM each day.</span>}
              </div>
              <button onClick={() => setRescheduling(false)} className={`${link} mt-2`}>
                Keep my current time
              </button>
            </div>
          )}
        </>
      )}

      {windowState === "past" && <p className="text-pencil">This interview has ended.</p>}
    </div>
  );
}
