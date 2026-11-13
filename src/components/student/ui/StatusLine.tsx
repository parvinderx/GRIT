import { cn } from "@/lib/utils";
import { Icon } from "@/components/primitives/Icon";

/** Student status tones. No red: "not cleared" and "missed" are quiet, never alarming. */
export type StudentTone = "info" | "live" | "waiting" | "quiet" | "done";

const TONE: Record<StudentTone, string> = {
  info: "text-ballpoint",
  live: "text-mint",
  waiting: "text-amberline",
  quiet: "text-pencil",
  done: "text-mint",
};

/** One line that says where the student is: icon + plain words. Not a pill, not caps. */
export function StatusLine({
  tone,
  icon,
  text,
  pulse,
  className,
}: {
  tone: StudentTone;
  icon: string;
  text: string;
  /** A small live dot, only for "live now". */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <p className={cn("flex items-center gap-2 text-base font-bold", TONE[tone], className)}>
      {pulse ? (
        <span className="relative flex size-2.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2.5 rounded-full bg-mint" />
        </span>
      ) : (
        <Icon name={icon} className="size-[18px]" />
      )}
      {text}
    </p>
  );
}
