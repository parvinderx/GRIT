import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { StudentShell } from "@/components/shells/StudentShell";
import { getStudentMiles } from "@/services/students";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (!ctx?.studentId) redirect("/start");
  const miles = await getStudentMiles(ctx.studentId);
  return (
    <StudentShell miles={miles} initials={initialsOf(ctx.name)}>
      {children}
    </StudentShell>
  );
}
