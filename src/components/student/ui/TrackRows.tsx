import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/primitives/Icon";
import type { ChipDef } from "@/lib/journey/statusConfig";
import { btnClass } from "./Button";

export interface TrackRowData {
  name: string; // "Novice"
  cleared: number;
  total: number;
  chip: ChipDef;
  journeyId: string;
  bookHref?: string;
}

const CHIP_TEXT: Partial<Record<ChipDef["tone"], string>> = {
  good: "text-mint",
  live: "text-mint",
  scheduled: "text-ballpoint",
  cobaltSoft: "text-ballpoint",
  pending: "text-amberline",
};

/** Skill progress as a row of ticks: one segment per skill, so "3 of 5" is visible without reading. */
function SkillTicks({ cleared, total }: { cleared: number; total: number }) {
  if (total <= 0) return null;
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex gap-[3px]" aria-hidden>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={cn("h-3 w-2 rounded-[2px]", i < cleared ? "bg-graphite" : "bg-rule")} />
        ))}
      </span>
      <span className="text-[15px] text-pencil">
        {cleared}/{total} skills
      </span>
    </span>
  );
}

/** One track: its badges as ruled rows. No card around it. */
export function TrackRows({ trackName, rows }: { trackName: string; rows: TrackRowData[] }) {
  return (
    <div>
      <h3 className="pt-5 text-lg font-extrabold text-graphite">{trackName}</h3>
      <ul className="mt-1">
        {rows.map((r) => (
          <li
            key={r.journeyId}
            className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-rule py-3 sm:grid-cols-[120px_1fr_auto]"
          >
            <Link href={`/badge/${r.journeyId}`} className="inline-flex min-h-11 items-center font-bold text-graphite underline-offset-4 hover:underline">
              {r.name}
            </Link>
            <span className="order-3 col-span-2 sm:order-none sm:col-span-1">
              <SkillTicks cleared={r.cleared} total={r.total} />
            </span>
            {r.bookHref ? (
              <Link href={r.bookHref} className={btnClass("outline", "min-h-11 px-4 text-[15px]")}>
                Book
              </Link>
            ) : (
              <span className={cn("flex items-center gap-1.5 text-[15px] font-bold", CHIP_TEXT[r.chip.tone] ?? "text-pencil")}>
                <Icon name={r.chip.icon} className="size-4" aria-hidden />
                {r.chip.chipLabel}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
