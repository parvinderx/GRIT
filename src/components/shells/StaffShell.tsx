import { cookies } from "next/headers";
import { cn } from "@/lib/utils";
import { StaffSidebar, type NavItem } from "./StaffSidebar";
import { SIDEBAR_COOKIE } from "./sidebarCookie";

export type { NavItem };

/** Staff console (interviewer + admin): collapsible dark sidebar, content beside it. */
export async function StaffShell({
  name,
  roleLabel,
  subtitle,
  nav,
  className,
  children,
}: {
  name: string;
  roleLabel: string;
  subtitle: string;
  nav: NavItem[];
  /** Extra class on the shell root (the interviewer passes its type/colour scope). */
  className?: string;
  children: React.ReactNode;
}) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
  return (
    <div className={cn("min-h-dvh bg-background lg:flex", className)}>
      <StaffSidebar name={name} roleLabel={roleLabel} subtitle={subtitle} nav={nav} initiallyCollapsed={collapsed} />
      <main id="main" className="mx-auto w-full min-w-0 max-w-[1200px] flex-1 px-4 py-6 pb-16 lg:px-10">
        {children}
      </main>
    </div>
  );
}
