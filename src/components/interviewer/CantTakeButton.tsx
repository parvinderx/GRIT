"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/primitives/ConfirmDialog";
import { postJson } from "@/lib/clientFetch";

/** "I can't take this interview" (spec §5 I2): swap at least 24 h before, else the team decides. */
export function CantTakeButton({ bookingId, early }: { bookingId: string; early: boolean }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      title="Can't take this interview?"
      impact={
        early ? (
          <ul className="list-disc space-y-1 pl-5">
            <li>We hand it to another interviewer who&apos;s free at the same time. The student keeps their time.</li>
            <li>If nobody is free, it&apos;s called off and the student gets a priority rebook. It won&apos;t count against them.</li>
          </ul>
        ) : (
          <p>
            It&apos;s less than 24 hours away, so the interview team decides. They&apos;ll try to find someone free at the
            same time. Until they confirm, it&apos;s still yours.
          </p>
        )
      }
      reason={{ label: "Why", placeholder: "e.g. Called into an exam duty at that time.", minLength: 10 }}
      confirmLabel={early ? "Hand it over" : "Tell the team"}
      onConfirm={async (reason) => {
        const r = await postJson<{ message: string }>(`/api/v1/interviewer/bookings/${bookingId}/release`, { reason });
        if (r.ok) {
          toast.success(r.data.message ?? "Done");
          router.refresh();
          return true;
        }
        toast.error(r.message ?? "That didn't work");
        return false;
      }}
      trigger={(open) => (
        <button type="button" onClick={open} className="mt-3 w-full text-center text-[15px] font-bold text-ballpoint underline underline-offset-4">
          I can&apos;t take this interview
        </button>
      )}
    />
  );
}
