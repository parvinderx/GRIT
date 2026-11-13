import { formatIST, formatTime, formatDayShort } from "@/lib/time";

type Mode = "full" | "time" | "day";

/** Absolute IST time (never the device clock). */
export function TimeIST({
  value,
  mode = "full",
  className,
}: {
  value: Date | string | number;
  mode?: Mode;
  className?: string;
}) {
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  const text = mode === "time" ? formatTime(value) : mode === "day" ? formatDayShort(value) : formatIST(value);
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
