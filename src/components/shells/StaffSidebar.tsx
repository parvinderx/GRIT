"use client";

import { useState } from "react";
import { GritLogo } from "@/components/brand/GritLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Icon } from "@/components/primitives/Icon";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: number;
  /** Screen-reader text after the count, e.g. "need a decision". */
  badgeLabel?: string;
  /** Extra path prefixes that also mark this item active (e.g. /outcome/… for "Outcomes due"). */
  match?: string[];
}

import { SIDEBAR_COOKIE } from "./sidebarCookie";

function initialsOf(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/**
 * Staff sidebar (interviewer + admin). Desktop: pinned to the window height and
 * collapsible to an icon rail; the choice is kept in a cookie so the server renders
 * it the same way next time (no flicker). Phones: a top bar with scrollable tabs.
 */
export function StaffSidebar({
  name,
  roleLabel,
  subtitle,
  nav,
  initiallyCollapsed,
}: {
  name: string;
  roleLabel: string;
  subtitle: string;
  nav: NavItem[];
  initiallyCollapsed: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      className={cn(
        "z-30 flex flex-col bg-ink text-paper lg:sticky lg:top-0 lg:h-dvh lg:shrink-0 lg:transition-[width] lg:duration-200 motion-reduce:transition-none",
        collapsed ? "lg:w-[72px]" : "lg:w-[248px]"
      )}
    >
      {/* Wordmark + collapse toggle (a small icon button) */}
      <div className={cn("flex items-center justify-between gap-2 px-5 py-4 lg:py-5", collapsed && "lg:justify-center lg:px-0")}>
        <div className={cn(collapsed && "lg:hidden")}>
          <GritLogo tone="light" size="sm" />
          <p className="text-[13px] text-paper/60">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden size-8 items-center justify-center rounded-md text-paper/60 hover:bg-white/10 hover:text-paper focus-visible:outline-2 focus-visible:outline-paper lg:flex"
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}
        </button>
      </div>

      {/* Nav */}
      <nav aria-label="Main" className={cn("flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible", collapsed && "lg:px-2")}>
        {nav.map((n) => {
          const active = [n.href, ...(n.match ?? [])].some((p) => pathname === p || pathname.startsWith(p + "/"));
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? n.label : undefined}
              className={cn(
                "relative flex min-h-11 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium",
                active ? "bg-white/12 text-paper" : "text-paper/70 hover:bg-white/6 hover:text-paper",
                collapsed && "lg:justify-center lg:px-0"
              )}
            >
              {active && <span className="absolute inset-y-2 left-0 hidden w-[3px] rounded-r bg-paper lg:block" aria-hidden />}
              <Icon name={n.icon} className="size-[18px] shrink-0" aria-hidden />
              <span className={cn(collapsed && "lg:sr-only")}>{n.label}</span>
              {n.badge ? (
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full bg-alert px-1.5 text-xs font-bold text-white",
                    collapsed ? "ml-auto lg:absolute lg:right-1.5 lg:top-1 lg:ml-0 lg:h-4 lg:min-w-4 lg:px-1 lg:text-[10px]" : "ml-auto"
                  )}
                >
                  {n.badge}
                  <span className="sr-only"> {n.badgeLabel ?? "pending"}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Person (desktop only) */}
      <div className={cn("hidden border-t border-white/10 p-3 lg:block", collapsed && "lg:px-2")}>
        <div className={cn("flex items-center gap-3 rounded-lg px-2 py-2", collapsed && "justify-center px-0")} title={collapsed ? `${name}, ${roleLabel}` : undefined}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[13px] font-bold">{initialsOf(name)}</span>
          <span className={cn("min-w-0", collapsed && "sr-only")}>
            <span className="block truncate text-sm font-semibold text-paper">{name}</span>
            <span className="block truncate text-xs text-paper/60">{roleLabel}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
