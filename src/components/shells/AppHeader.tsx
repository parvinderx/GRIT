"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MilesInfo } from "@/components/student/MilesInfo";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLinkItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { GritLogo } from "@/components/brand/GritLogo";

const TABS = [
  { label: "Home", href: "/home", match: ["/home", "/book", "/booked", "/interview", "/result"] },
  { label: "Badges", href: "/tracks", match: ["/tracks", "/badge"] },
  { label: "Leaderboard", href: "/leaderboard", match: ["/leaderboard"] },
  { label: "Clear skills", href: "/contests", match: ["/contests", "/practise"] },
];

export function AppHeader({ miles, initials }: { miles: number; initials: string }) {
  const pathname = usePathname();
  const isActive = (m: string[]) => m.some((p) => pathname === p || pathname.startsWith(p + "/"));

  return (
    <header className="sticky top-0 z-20 bg-sheet/90 px-3 pt-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-[1120px] items-center gap-5 rounded-full border border-rule bg-cream px-4 py-1.5 sm:px-6">
        <Link href="/home" className="flex min-h-11 items-center" aria-label="GRIT home">
          <GritLogo size="sm" tone="light" />
        </Link>
        <span className="hidden items-center gap-1.5 rounded-full border border-highlight/50 bg-highlight/10 px-2.5 py-1 text-[12px] font-bold text-highlight lg:inline-flex">
          <span className="size-1.5 rounded-full bg-highlight" aria-hidden />
          GRIT 2026-27
        </span>
        {/* Wide screens: tabs sit inline with the wordmark. */}
        <nav aria-label="Main" className="hidden flex-1 gap-1 md:flex">
          {TABS.map((t) => (
            <Tab key={t.href} {...t} active={isActive(t.match)} />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <MilesInfo miles={miles} />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Account menu"
              className="flex size-11 items-center justify-center rounded-full"
            >
              <span className="flex size-9 items-center justify-center rounded-full border-[1.5px] border-graphite bg-white text-[13px] font-bold text-graphite">
                {initials}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="student w-48">
              <DropdownMenuLinkItem render={<Link href="/profile" />} className="min-h-11 px-3">Your profile</DropdownMenuLinkItem>
              <DropdownMenuLinkItem render={<Link href="/rules" />} className="min-h-11 px-3">Interview rules</DropdownMenuLinkItem>
              <DropdownMenuLinkItem render={<Link href="/help" />} className="min-h-11 px-3">Get help</DropdownMenuLinkItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Phones: tabs on their own row, scrollable. */}
      <nav aria-label="Main" className="mx-auto flex max-w-[1120px] gap-1 overflow-x-auto px-1 py-2 md:hidden">
        {TABS.map((t) => (
          <Tab key={t.href} {...t} active={isActive(t.match)} />
        ))}
      </nav>
    </header>
  );
}

function Tab({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-[15px] font-semibold",
        active ? "bg-ink-line text-white" : "text-graphite hover:bg-rule-soft"
      )}
    >
      {label}
    </Link>
  );
}
