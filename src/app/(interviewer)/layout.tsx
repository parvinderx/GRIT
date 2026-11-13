import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { listOutcomesDue } from "@/services/interviewerView";
import { StaffShell, type NavItem } from "@/components/shells/StaffShell";

/** Same console layout as the interview team and admins: dark sidebar, content beside it. */
export default async function InterviewerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (!ctx?.interviewerId) redirect("/start");

  // Same query as the /outcomes page and the Today hero.
  const due = (await listOutcomesDue(ctx.interviewerId)).items.length;

  const nav: NavItem[] = [
    { href: "/schedule", label: "Today", icon: "CalendarCheck", match: ["/room"] },
    { href: "/outcomes", label: "Outcomes due", icon: "Hourglass", badge: due || undefined, badgeLabel: "to record", match: ["/outcome"] },
    { href: "/availability", label: "Availability", icon: "CalendarPlus" },
  ];
  return (
    <StaffShell name={ctx.name} roleLabel="Interviewer" subtitle="Interviews" nav={nav} className="notebook">
      {children}
    </StaffShell>
  );
}
