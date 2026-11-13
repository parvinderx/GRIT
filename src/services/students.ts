import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { students, studentBadges } from "@/db/schema";

/** Total Miles = base + sum of ACTIVE badge Miles (nullified badges don't count). */
export async function getStudentMiles(studentId: string): Promise<number> {
  const s = await db
    .select({ base: students.baseMiles })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  const base = s[0]?.base ?? 0;
  const badges = await db
    .select({ miles: studentBadges.miles })
    .from(studentBadges)
    .where(and(eq(studentBadges.studentId, studentId), eq(studentBadges.status, "ACTIVE")));
  return base + badges.reduce((a, b) => a + b.miles, 0);
}
