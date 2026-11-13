import { cn } from "@/lib/utils";

/** Shared staff (admin + interviewer) button styles so one role looks the same everywhere. */
const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2";

export const staffBtn = {
  base,
  primary: cn(base, "bg-cobalt text-white hover:brightness-110"),
  secondary: cn(base, "border border-border bg-card text-ink hover:bg-paper-2"),
  destructive: cn(base, "border border-alert/40 bg-card text-alert hover:bg-alert/5 focus-visible:ring-alert"),
};
