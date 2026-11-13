"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { ConfirmDialog } from "@/components/primitives/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { postJson, requestJson } from "@/lib/clientFetch";
import { toIST } from "@/lib/time";

type Kind = "result" | "attempt" | "wait" | "book" | "reassign" | "void" | null;

const COOLDOWN = ["FAILED", "RETAKE_LATER", "NO_SHOW"];

/**
 * Per-row staff actions on the tracker. Requests (result change, extra attempt, end
 * the wait) go to Approvals for a second Program Admin. Booking actions (book on
 * behalf, reassign, void) apply straight away and are recorded with the reason.
 */
export function TrackerRowActions({
  journeyId,
  studentName,
  state,
  liveBookingId,
  studentHasLiveBooking,
  interviewerName,
}: {
  journeyId: string;
  studentName: string;
  state: string;
  liveBookingId: string | null;
  studentHasLiveBooking: boolean;
  interviewerName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Kind>(null);
  const [newResult, setNewResult] = useState<"PASS" | "FAIL" | "RETAKE_LATER">("PASS");
  const [fault, setFault] = useState<"PLATFORM" | "INTERVIEWER">("INTERVIEWER");
  const [excludeCurrent, setExcludeCurrent] = useState(true);
  const [times, setTimes] = useState<{ startAt: string; count: number }[] | null>(null);
  const [startAt, setStartAt] = useState("");

  const canResult = ["FAILED", "RETAKE_LATER", "ELIGIBLE", "CLOSED"].includes(state);
  const canWait = COOLDOWN.includes(state);
  const canAttempt = ["FAILED", "NO_SHOW", "CLOSED", "ELIGIBLE", "RETAKE_LATER"].includes(state);
  const canBook = state === "ELIGIBLE" && !studentHasLiveBooking;
  const canBookingOps = !!liveBookingId && state === "BOOKED";

  async function openBook() {
    setOpen("book");
    setTimes(null);
    const r = await requestJson<{ times: { startAt: string; count: number }[] }>(
      "GET",
      `/api/v1/admin/journeys/${journeyId}/available-times`
    );
    const list = r.data.times ?? [];
    setTimes(list);
    setStartAt(list[0]?.startAt ?? "");
  }

  async function done(r: { ok: boolean; message?: string }, okText: string) {
    if (r.ok) {
      toast.success(okText);
      router.refresh();
      return true;
    }
    toast.error(r.message ?? "That didn't work");
    return false;
  }

  const any = canResult || canWait || canAttempt || canBook || canBookingOps;
  if (!any) return <span className="text-xs text-ink-2">—</span>;

  const close = (o: boolean) => !o && setOpen(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${studentName}`}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card text-ink hover:border-cobalt/40"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {canBook && <DropdownMenuItem onClick={openBook}>Book on their behalf…</DropdownMenuItem>}
          {canBookingOps && <DropdownMenuItem onClick={() => setOpen("reassign")}>Reassign interviewer…</DropdownMenuItem>}
          {canBookingOps && <DropdownMenuItem onClick={() => setOpen("void")}>Void this interview…</DropdownMenuItem>}
          {canResult && <DropdownMenuItem onClick={() => setOpen("result")}>Request a result change…</DropdownMenuItem>}
          {canAttempt && <DropdownMenuItem onClick={() => setOpen("attempt")}>Request an extra attempt…</DropdownMenuItem>}
          {canWait && <DropdownMenuItem onClick={() => setOpen("wait")}>Request to end the wait…</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={open === "result"}
        onOpenChange={close}
        title={`Request a result change for ${studentName}?`}
        impact={
          <div className="space-y-2">
            <p>A second Program Admin approves it. A change to Pass awards the badge; a Pass can only be removed through an integrity case.</p>
            <label className="block text-sm font-medium text-ink">
              New result{" "}
              <select
                value={newResult}
                onChange={(e) => setNewResult(e.target.value as typeof newResult)}
                className="ml-2 rounded-md border border-border bg-card px-2 py-1"
              >
                <option value="PASS">Pass</option>
                <option value="RETAKE_LATER">Retake later</option>
                <option value="FAIL">Not cleared</option>
              </select>
            </label>
          </div>
        }
        reason={{ label: "Why", placeholder: "e.g. Recorded against the wrong student.", minLength: 10 }}
        confirmLabel="Send for approval"
        onConfirm={async (reason) =>
          done(await postJson("/api/v1/admin/approvals", { kind: "RESULT_AMENDMENT", journey_id: journeyId, new_result: newResult, reason }), "Sent for approval")
        }
      />

      <ConfirmDialog
        open={open === "attempt"}
        onOpenChange={close}
        title={`Request an extra attempt for ${studentName}?`}
        impact={<p>A second Program Admin approves it. Approving adds one attempt and reopens booking if it was closed.</p>}
        reason={{ label: "Why", placeholder: "e.g. Interview disrupted by a documented outage.", minLength: 10 }}
        confirmLabel="Send for approval"
        onConfirm={async (reason) => done(await postJson("/api/v1/admin/approvals", { kind: "REOPEN", journey_id: journeyId, reason }), "Sent for approval")}
      />

      <ConfirmDialog
        open={open === "wait"}
        onOpenChange={close}
        title={`Request to end ${studentName}'s wait?`}
        impact={<p>A second Program Admin approves it. Approving lets the student book straight away.</p>}
        reason={{ label: "Why", placeholder: "e.g. Medical emergency, documented.", minLength: 10 }}
        confirmLabel="Send for approval"
        onConfirm={async (reason) => done(await postJson("/api/v1/admin/approvals", { kind: "COOLDOWN_OVERRIDE", journey_id: journeyId, reason }), "Sent for approval")}
      />

      <ConfirmDialog
        open={open === "book"}
        onOpenChange={close}
        title={`Book an interview for ${studentName}?`}
        impact={
          <div className="space-y-2">
            <p>You pick the time; the system assigns the interviewer. The student is told, and it uses their normal booking.</p>
            {times === null ? (
              <p>Loading open times…</p>
            ) : times.length === 0 ? (
              <p>No open times for this student right now.</p>
            ) : (
              <label className="block text-sm font-medium text-ink">
                Time (IST){" "}
                <select value={startAt} onChange={(e) => setStartAt(e.target.value)} className="ml-2 max-w-full rounded-md border border-border bg-card px-2 py-1">
                  {times.map((t) => (
                    <option key={t.startAt} value={t.startAt}>
                      {toIST(t.startAt).toFormat("ccc d LLL, h:mm a")} · {t.count} open
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        }
        reason={{ label: "Why you're booking for them", placeholder: "e.g. Student asked by phone; no app access.", minLength: 10 }}
        confirmLabel="Book it"
        onConfirm={async (reason) => {
          if (!startAt) return false;
          return done(
            await postJson("/api/v1/admin/bookings", { journey_id: journeyId, start_at: startAt, reason }, { idempotent: true }),
            "Booked"
          );
        }}
      />

      <ConfirmDialog
        open={open === "reassign"}
        onOpenChange={close}
        title={`Give ${studentName}'s interview to another interviewer?`}
        impact={
          <div className="space-y-2">
            <p>Same time. The system picks someone qualified and free; you can only exclude, never choose.</p>
            {interviewerName && (
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={excludeCurrent} onChange={(e) => setExcludeCurrent(e.target.checked)} />
                Exclude the current interviewer ({interviewerName})
              </label>
            )}
          </div>
        }
        reason={{ label: "Why", placeholder: "e.g. Interviewer unwell.", minLength: 10 }}
        confirmLabel="Reassign"
        onConfirm={async (reason) =>
          done(await postJson(`/api/v1/admin/bookings/${liveBookingId}/reassign`, { exclude_current: excludeCurrent, reason }), "Reassigned")
        }
      />

      <ConfirmDialog
        open={open === "void"}
        onOpenChange={close}
        tone="destructive"
        title={`Void ${studentName}'s interview?`}
        impact={
          <div className="space-y-2">
            <p>No attempt is used and the student gets a priority rebook. Only for a platform or interviewer fault, before any result exists.</p>
            <label className="block text-sm font-medium text-ink">
              Fault{" "}
              <select value={fault} onChange={(e) => setFault(e.target.value as typeof fault)} className="ml-2 rounded-md border border-border bg-card px-2 py-1">
                <option value="INTERVIEWER">Interviewer</option>
                <option value="PLATFORM">Platform</option>
              </select>
            </label>
          </div>
        }
        reason={{ label: "What happened", placeholder: "e.g. Video platform outage 7–8 PM.", minLength: 10 }}
        confirmLabel="Void interview"
        onConfirm={async (reason) => done(await postJson(`/api/v1/admin/bookings/${liveBookingId}/void`, { fault, reason }), "Interview voided")}
      />
    </>
  );
}
