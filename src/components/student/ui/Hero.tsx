import { cn } from "@/lib/utils";
import { StatusLine, type StudentTone } from "./StatusLine";

/**
 * The student hero slot: sits on the sheet (no card), on faint graph paper.
 * Reading order is fixed on every screen so the eye learns it:
 *   status line → headline (the fact) → one sentence → actions
 * The aside (route, badge mark, ticket) sits to the right on wide screens.
 *
 * `mark` draws the highlighter stroke under the headline. Use it only when the
 * hero also carries the screen's one highlighted action, or the result itself
 * is the thing to look at (e.g. a booking just confirmed).
 */
export function HeroFrame({
  status,
  headline,
  note,
  actions,
  aside,
  mark = false,
  as: Heading = "h1",
  headingId,
  className,
}: {
  status?: { tone: StudentTone; icon: string; text: string; pulse?: boolean };
  headline: React.ReactNode;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  mark?: boolean;
  as?: "h1" | "h2";
  headingId?: string;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "grit-card px-5 pb-8 pt-7 sm:px-8 sm:pb-9 sm:pt-8",
        className
      )}
    >
      <div className={cn("grid gap-7", aside && "lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:gap-12")}>
        <div className="min-w-0">
          {status && <StatusLine {...status} />}
          <Heading
            id={headingId}
            className="mt-3 max-w-[22ch] text-[2.125rem] font-extrabold leading-[1.08] text-graphite sm:text-[2.75rem]"
          >
            {mark ? <span className="highlight-stroke">{headline}</span> : headline}
          </Heading>
          {note && <div className="mt-4 max-w-[60ch] text-[17px] leading-relaxed text-pencil">{note}</div>}
          {actions && <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">{actions}</div>}
        </div>
        {aside && <div className="min-w-0 lg:border-l-2 lg:border-dashed lg:border-rule lg:pl-8">{aside}</div>}
      </div>
    </section>
  );
}
