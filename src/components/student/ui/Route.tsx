import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RouteStop } from "@/lib/journey/route";

const SR: Record<RouteStop["status"], string> = {
  done: "done",
  past: "finished",
  current: "you are here",
  future: "not yet",
};

function Dot({ status }: { status: RouteStop["status"] }) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full",
        status === "done" && "bg-graphite text-white",
        status === "past" && "border-2 border-pencil bg-white",
        status === "current" && "bg-ballpoint ring-4 ring-ballpoint-soft",
        status === "future" && "border-2 border-rule bg-white"
      )}
      aria-hidden
    >
      {status === "done" && <Check className="size-3.5" strokeWidth={3} />}
      {status === "current" && <span className="size-2 rounded-full bg-white" />}
    </span>
  );
}

/**
 * The journey route. Vertical with a rule between stops on wide screens;
 * on phones it collapses to "Step n of m" plus a thin segmented bar.
 */
export function Route({ stops, title }: { stops: RouteStop[]; title: string }) {
  const currentIdx = stops.findIndex((s) => s.status === "current");
  const current = currentIdx >= 0 ? stops[currentIdx] : null;

  return (
    <div role="group" aria-label={`${title} progress`}>
      {/* phones */}
      <div className="lg:hidden">
        <p className="text-[15px] text-pencil">
          {current ? (
            <>
              Step {currentIdx + 1} of {stops.length}: <span className="font-bold text-graphite">{current.label}</span>
              {current.sub ? `, ${current.sub}` : ""}
            </>
          ) : (
            <span className="font-bold text-graphite">All steps done</span>
          )}
        </p>
        <div className="mt-2 flex gap-1" aria-hidden>
          {stops.map((s, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                s.status === "done" || s.status === "past" ? "bg-graphite" : s.status === "current" ? "bg-ballpoint" : "bg-rule"
              )}
            />
          ))}
        </div>
      </div>

      {/* wide screens */}
      <ol className="hidden lg:block">
        <li className="mb-4 text-[15px] font-bold text-pencil">{title}</li>
        {stops.map((s, i) => (
          <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
            {i < stops.length - 1 && (
              <span
                className={cn(
                  "absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5",
                  s.status === "done" || s.status === "past" ? "bg-graphite" : "bg-rule"
                )}
                aria-hidden
              />
            )}
            <Dot status={s.status} />
            <div className="-mt-0.5 min-w-0">
              <p className={cn("font-bold leading-snug", s.status === "future" ? "text-pencil" : "text-graphite")}>
                {s.label}
                <span className="sr-only">, {SR[s.status]}</span>
              </p>
              {s.sub && <p className="text-[15px] leading-snug text-pencil">{s.sub}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
