import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/utils";
import type { ActionVariant } from "@/lib/journey/statusConfig";

const VARIANTS: Record<ActionVariant, string> = {
  // Ink text on Saffron (contrast); the student's one next step.
  saffron: "bg-saffron text-saffron-ink hover:brightness-95 font-semibold shadow-sm",
  go: "bg-go text-white hover:brightness-110 font-semibold shadow-sm",
  goOutline: "border border-go/50 bg-transparent text-go hover:bg-go/5 font-semibold",
  cobalt: "bg-cobalt text-white hover:brightness-110 font-semibold shadow-sm",
  link: "text-cobalt underline underline-offset-4 hover:text-cobalt/80",
};

export interface ActionButtonProps {
  variant: ActionVariant;
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  type?: "button" | "submit";
  inline?: boolean;
  className?: string;
}

/**
 * Server-driven button. The server says which actions are allowed; this just
 * renders one. Primary variants are block buttons with >=44px targets; `link`
 * is a secondary text link. Disabled buttons always render their reason nearby.
 */
export function ActionButton({
  variant,
  label,
  href,
  onClick,
  disabled,
  disabledReason,
  type = "button",
  inline = false,
  className,
}: ActionButtonProps) {
  const reasonId = useId();
  const isLink = variant === "link";
  const base = isLink
    ? "inline-flex min-h-11 items-center text-sm font-medium"
    : `inline-flex min-h-[44px] items-center justify-center rounded-xl px-6 py-2.5 text-base transition ${inline ? "" : "w-full"}`;

  if (disabled) {
    return (
      <span className="block">
        <button
          type="button"
          disabled
          aria-describedby={disabledReason ? reasonId : undefined}
          className={cn(base, "cursor-not-allowed bg-paper-2 text-ink-2 opacity-70", className)}
        >
          {label}
        </button>
        {disabledReason && <span id={reasonId} className="mt-1 block text-xs text-ink-2">{disabledReason}</span>}
      </span>
    );
  }

  if (href) {
    return (
      <Link href={href} className={cn(base, VARIANTS[variant], className)}>
        {label}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} className={cn(base, VARIANTS[variant], className)}>
      {label}
    </button>
  );
}
