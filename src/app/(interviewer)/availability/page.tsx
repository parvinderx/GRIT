import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getAvailability } from "@/services/interviewerView";
import { getAvailabilityConfig, releaseLabel } from "@/services/availabilityEditor";
import { AvailabilityEditor } from "@/components/interviewer/AvailabilityEditor";
import { label12 } from "@/lib/slotGrid";

export default async function AvailabilityPage() {
  const ctx = await getCtx();
  if (!ctx?.interviewerId) redirect("/start");
  const [a, cfg] = await Promise.all([getAvailability(ctx.interviewerId), getAvailabilityConfig()]);
  const g = cfg.grid;
  const tracks = a.tracks.map((t) => `${t.name} up to Level ${t.maxLevel}`).join(", ");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[2rem] font-extrabold leading-tight text-graphite">Your hours</h1>
        <p className="mt-1 max-w-[70ch] text-pencil">
          Set when you can interview. Students book {g.durationMinutes}-minute interviews that start every {g.gridMinutes} minutes,
          between {label12(g.gridStart)} and {label12(g.gridEnd)} IST. Over the next {a.horizonDays} days you have{" "}
          <strong className="text-graphite">{a.slotsInHorizon} open slots</strong> and{" "}
          <strong className="text-graphite">{a.bookedInHorizon} booked</strong>.
        </p>
      </div>

      <AvailabilityEditor
        initialWeekly={a.weekly}
        initialOverrides={a.overrides}
        grid={g}
        today={cfg.today}
        nowMinute={cfg.nowMinute}
        keptSlots={a.keptSlots}
        deadlineDate={cfg.deadlineDate}
        lastInterviewDate={cfg.lastInterviewDate}
        sidebar={
          <ul className="space-y-2 border-t border-rule pt-3 text-[14px] text-pencil">
            {tracks && <li>You interview for {tracks}.</li>}
            <li>Each day opens for booking at {releaseLabel(cfg.releaseHourIst)} IST, {cfg.horizonDays} days ahead.</li>
            <li>Changing hours never cancels a booked interview. If you can&apos;t take one, contact the interview team.</li>
          </ul>
        }
      />
    </div>
  );
}
