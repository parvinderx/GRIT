import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { JourneyView } from "@/services/studentView";
import { BadgeMedal } from "./ui/BadgeMedal";
import { btnClass } from "./ui/Button";
import { medalFor } from "@/lib/journey/medal";
import { badgeShort, trackBookHref } from "@/lib/journey/trackChip";
import { trackTheme } from "@/lib/journey/trackTheme";

const CAPTION_TONE: Record<string, string> = {
  earned: "text-gold-ink",
  ready: "text-ballpoint",
  booked: "text-ballpoint",
  pending: "text-amberline",
  waiting: "text-amberline",
};

export interface ShelfTrack {
  trackName: string;
  trackCode: string;
  journeys: JourneyView[];
}

export function groupByTrack(journeys: JourneyView[]): ShelfTrack[] {
  const map = new Map<string, ShelfTrack>();
  for (const j of journeys) {
    const t = map.get(j.trackCode) ?? { trackName: j.trackName, trackCode: j.trackCode, journeys: [] };
    t.journeys.push(j);
    map.set(j.trackCode, t);
  }
  for (const t of map.values()) t.journeys.sort((a, b) => a.badgeLevel - b.badgeLevel);
  return [...map.values()];
}

/**
 * Badges as medals. "path" (Badges page): each track is a card with its levels joined
 * by a line that fills as badges are earned. "compact" (Home): one row per badge.
 * Book buttons only appear where the server allows booking; `hideBookFor` drops the
 * one the hero already offers.
 */
export function BadgeShelf({
  tracks,
  variant,
  hideBookFor,
}: {
  tracks: ShelfTrack[];
  variant: "path" | "compact";
  hideBookFor?: string;
}) {
  if (variant === "compact") {
    return (
      <div className="space-y-5">
        {tracks.map((t) => (
          <div key={t.trackCode}>
            <h3 className="flex items-center gap-2 pt-4 text-lg font-extrabold text-graphite">
              <span className="size-2.5 rounded-full" style={{ background: trackTheme(t.trackCode).hue }} aria-hidden />
              {t.trackName}
            </h3>
            <ul className="mt-1">
              {t.journeys.map((j) => {
                const m = medalFor(j, t.journeys);
                const book = j.journeyId === hideBookFor ? undefined : trackBookHref(j);
                return (
                  <li key={j.journeyId} className="flex items-center gap-4 border-b border-rule py-2.5">
                    <BadgeMedal track={m.track} level={m.level} state={m.state} progress={m.progress} size="sm" isNew={m.isNew} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/badge/${j.journeyId}`}
                        className="inline-flex min-h-11 items-center font-bold text-graphite underline-offset-4 hover:underline"
                      >
                        {badgeShort(j.badgeName)}
                      </Link>
                      <p className={cn("-mt-2 text-[15px] font-semibold", CAPTION_TONE[m.state] ?? "text-pencil")}>
                        {m.caption}
                        {m.state === "progress" && (
                          <span className="font-normal text-pencil">
                            {" "}
                            · {j.skillsCleared}/{j.skillsTotal} skills
                          </span>
                        )}
                      </p>
                    </div>
                    {book && (
                      <Link href={book} className={btnClass("outline", "min-h-11 px-4 text-[15px]")}>
                        Book
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {tracks.map((t) => {
        const theme = trackTheme(t.trackCode);
        const earned = t.journeys.filter((j) => j.state === "PASSED").length;
        return (
          <section key={t.trackCode} aria-labelledby={`track-${t.trackCode}`} className="grit-card">
            <div className="grit-band flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 sm:px-6" style={{ background: theme.soft }}>
              <h2 id={`track-${t.trackCode}`} className="flex items-center gap-2 text-xl font-extrabold text-graphite">
                <span className="size-3 rounded-full" style={{ background: theme.hue }} aria-hidden />
                {t.trackName}
              </h2>
              <p className="text-[15px] text-pencil">
                {earned} of {t.journeys.length} earned
              </p>
            </div>

            <ol className="flex flex-col gap-0 p-5 sm:flex-row sm:items-start sm:p-6">
              {t.journeys.map((j, i) => {
                const m = medalFor(j, t.journeys);
                const book = trackBookHref(j);
                // The line into this medal fills once the badge before it is earned.
                const doneSoFar = i > 0 && t.journeys[i - 1].state === "PASSED";
                return (
                  <Fragment key={j.journeyId}>
                    {i > 0 && (
                      <li aria-hidden className="flex sm:mt-[38px] sm:flex-1">
                        <span
                          className={cn(
                            "ml-[35px] h-6 w-[3px] rounded sm:ml-0 sm:h-[3px] sm:w-full",
                            doneSoFar ? "" : "bg-rule"
                          )}
                          style={doneSoFar ? { background: theme.hue } : undefined}
                        />
                      </li>
                    )}
                    <li className="flex items-center gap-4 sm:w-44 sm:flex-col sm:items-center sm:text-center">
                      <BadgeMedal track={m.track} level={m.level} state={m.state} progress={m.progress} size="md" isNew={m.isNew} />
                      <div className="min-w-0">
                        <Link
                          href={`/badge/${j.journeyId}`}
                          className="inline-flex min-h-11 items-center text-lg font-extrabold text-graphite underline-offset-4 hover:underline"
                        >
                          {badgeShort(j.badgeName)}
                        </Link>
                        <p className={cn("-mt-1.5 text-[15px] font-semibold", CAPTION_TONE[m.state] ?? "text-pencil")}>{m.caption}</p>
                        {m.state === "progress" && (
                          <p className="text-[14px] text-pencil">
                            {j.skillsCleared} of {j.skillsTotal} skills cleared
                          </p>
                        )}
                        {book && (
                          <Link href={book} className={btnClass("outline", "mt-2 min-h-11 px-4 text-[15px]")}>
                            Book
                          </Link>
                        )}
                      </div>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
