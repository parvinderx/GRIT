"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Moves focus to itself on mount (WCAG: focus the heading when a result loads). */
export function FocusHeading({
  children,
  className,
  as: As = "h1",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2";
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <As ref={ref} tabIndex={-1} className={cn("outline-none", className)}>
      {children}
    </As>
  );
}
