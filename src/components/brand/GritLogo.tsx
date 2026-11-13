import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The official GRIT lockup (public/grit-logo.png: white artwork on transparent,
 * 319×73). On dark surfaces it shows as-is; on light surfaces it's inverted to black.
 */
export function GritLogo({ tone = "ink", size = "md", className }: { tone?: "ink" | "light"; size?: "sm" | "md"; className?: string }) {
  const h = size === "sm" ? 26 : 34;
  const w = Math.round((h * 319) / 73);
  return (
    <Image
      src="/grit-logo.png"
      alt="GRIT"
      width={w}
      height={h}
      priority
      className={cn("select-none", tone === "ink" && "invert", className)}
      style={{ width: w, height: h }}
    />
  );
}
