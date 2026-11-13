import { requireAdminPage } from "@/lib/auth";
import { getAdminNavCounts } from "@/services/adminView";
import { StaffShell, type NavItem } from "@/components/shells/StaffShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAdminPage();

  const isProgramAdmin = ctx.roles.includes("PROGRAM_ADMIN");
  const counts = await getAdminNavCounts();
  const roleLabel = isProgramAdmin ? "Program Admin" : "Interview Admin";
  // Order follows the daily routine. Interview Admins can't decide approvals, but they
  // file "Request more hours" there, so they keep the page (read-only) without a badge.
  const nav: NavItem[] = [
    { href: "/overview", label: "Overview", icon: "LayoutDashboard" },
    { href: "/cases", label: "Integrity cases", icon: "ShieldAlert", badge: counts.cases || undefined, badgeLabel: "need a decision" },
    {
      href: "/approvals",
      label: "Approvals",
      icon: "CheckCircle2",
      badge: isProgramAdmin ? counts.approvals || undefined : undefined,
      badgeLabel: "waiting",
    },
    { href: "/tracker", label: "Booking tracker", icon: "CalendarCheck" },
    { href: "/capacity", label: "Capacity", icon: "Hourglass" },
  ];
  return (
    <StaffShell name={ctx.name} roleLabel={roleLabel} subtitle="Interview Ops" nav={nav}>
      {children}
    </StaffShell>
  );
}
