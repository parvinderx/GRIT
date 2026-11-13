import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Student buttons.
 *  next     the highlighter: the student's ONE next action on a screen (use once)
 *  live     mint: join / live-now actions
 *  outline  graphite outline: a real action that isn't the next step
 *  link     ballpoint underline: quiet secondary links
 */
export type BtnKind = "next" | "live" | "outline" | "link";

const BASE =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border-2 border-ink-line px-6 text-[16px] font-bold shadow-[0_3px_0_var(--color-ink-line)] transition-[transform,box-shadow,filter] active:translate-y-[2px] active:shadow-[0_1px_0_var(--color-ink-line)] disabled:cursor-not-allowed disabled:opacity-50";

const KIND: Record<BtnKind, string> = {
  next: "border-grit-purple bg-grit-purple text-white shadow-none hover:brightness-110 [.notebook_&]:border-ink-line [.notebook_&]:bg-highlight [.notebook_&]:text-highlight-ink [.notebook_&]:shadow-[0_3px_0_var(--color-ink-line)]",
  live: "border-mint bg-mint text-[#04130d] shadow-none hover:brightness-110",
  outline: "bg-white text-graphite hover:bg-cream [.student_&]:border-rule [.student_&]:shadow-none",
  link: "min-h-11 px-0 text-base font-semibold text-ballpoint underline decoration-[1.5px] underline-offset-4 hover:decoration-2",
};

export function btnClass(kind: BtnKind, extra?: string) {
  return cn(kind === "link" ? "inline-flex items-center" : BASE, KIND[kind], extra);
}

/** A link styled as a student button. `download` renders a plain <a download> (e.g. .ics files). */
export function ButtonLink({
  kind,
  href,
  download,
  className,
  children,
}: {
  kind: BtnKind;
  href: string;
  download?: boolean | string;
  className?: string;
  children: React.ReactNode;
}) {
  if (download) {
    return (
      <a href={href} download={typeof download === "string" ? download : true} className={btnClass(kind, className)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={btnClass(kind, className)}>
      {children}
    </Link>
  );
}
