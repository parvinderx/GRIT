"use client";

import Link from "next/link";
import { Popover } from "@base-ui/react/popover";

/** Miles count in the header. Opens a short "What are Miles?" explainer. */
export function MilesInfo({ miles }: { miles: number }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`${miles.toLocaleString("en-IN")} Miles. What are Miles?`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-[15px] hover:bg-rule-soft"
      >
        <span className="font-bold text-graphite">{miles.toLocaleString("en-IN")}</span>
        <span className="text-pencil">Miles</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Popover.Popup className="student w-72 max-w-[calc(100vw-2rem)] rounded-xl border-[1.5px] border-graphite bg-white p-4 text-[15px] outline-none">
            <Popover.Title className="text-lg font-extrabold text-graphite">What are Miles?</Popover.Title>
            <p className="mt-2 text-pencil">
              Miles come from the badges you clear, plus any starting Miles from your programme. They decide your
              place on the leaderboard.
            </p>
            <p className="mt-2 text-pencil">
              With one badge or more you&apos;re a Qualiflyer. Before your first badge you&apos;re a Pre-Qualiflyer.
            </p>
            <Link href="/leaderboard" className="mt-2 inline-flex min-h-11 items-center font-semibold text-ballpoint underline underline-offset-4">
              See the leaderboard
            </Link>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
