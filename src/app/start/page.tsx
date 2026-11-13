import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { users, userRoles, students, interviewers, interviewJourneys } from "@/db/schema";
import { PersonaButton } from "@/components/demo/PersonaButton";
import { DemoAccessProvider } from "@/components/demo/DemoAccess";
import { GritLogo } from "@/components/brand/GritLogo";
import { env } from "@/lib/env";
import { STATUS } from "@/lib/journey/statusConfig";
import type { JourneyState } from "@/lib/state-machine";

export const dynamic = "force-dynamic";

const REASON_TEXT: Record<string, string> = {
  "no-role": "Your account has no role in this app yet, so there's no home page to open. Pick a persona below, or ask a Program Admin to give your account a role.",
  "no-access": "Your account can't open that page. Pick a persona below.",
};

export default async function StartPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  if (!env.personaSwitch) {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="font-heading text-3xl font-bold text-ink">Sign-in not available</h1>
        <p className="mt-2 max-w-xl text-ink-2">
          This deploy has no sign-in configured yet. Ask the team that runs it for access.
        </p>
      </main>
    );
  }
  const reasonText = reason ? REASON_TEXT[reason] : undefined;
  const roleRows = await db.select().from(userRoles);
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) {
    rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.role]);
  }

  // students with a representative journey state
  const studentRows = await db
    .select({ userId: students.userId, name: users.displayName, studentId: students.id })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId));
  const sids = studentRows.map((s) => s.studentId);
  const journeys = sids.length
    ? await db
        .select({ studentId: interviewJourneys.studentId, state: interviewJourneys.state })
        .from(interviewJourneys)
        .where(inArray(interviewJourneys.studentId, sids))
    : [];
  const rank = (s: string) => (s === "LOCKED" ? 0 : s === "ELIGIBLE" ? 2 : 1);
  const bestState = new Map<string, JourneyState>();
  for (const j of journeys) {
    const cur = bestState.get(j.studentId);
    if (!cur || rank(j.state) > rank(cur)) bestState.set(j.studentId, j.state as JourneyState);
  }

  const studentPersonas = studentRows
    .map((s) => {
      const st = bestState.get(s.studentId);
      const chip = st ? STATUS[st]?.chipLabel ?? st : "No journey";
      return { id: s.userId, name: s.name, roles: rolesByUser.get(s.userId) ?? ["STUDENT"], sub: chip };
    })
    .sort((a, b) => (a.name === "Ravi Teja" ? -1 : b.name === "Ravi Teja" ? 1 : a.name.localeCompare(b.name)));

  const staffRows = await db
    .select({ userId: interviewers.userId, name: users.displayName })
    .from(interviewers)
    .innerJoin(users, eq(users.id, interviewers.userId));
  const interviewerPersonas = staffRows.map((s) => ({
    id: s.userId,
    name: s.name,
    roles: rolesByUser.get(s.userId) ?? ["INTERVIEWER"],
    sub: "Interviewer",
  }));

  const adminPersonas = roleRows
    .filter((r) => r.role === "INTERVIEW_ADMIN" || r.role === "PROGRAM_ADMIN")
    .map((r) => r.userId);
  const uniqueAdmins = [...new Set(adminPersonas)];
  const adminUserRows = uniqueAdmins.length
    ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, uniqueAdmins))
    : [];
  const teamPersonas = adminUserRows.map((u) => ({
    id: u.id,
    name: u.name,
    roles: rolesByUser.get(u.id) ?? [],
    sub: (rolesByUser.get(u.id) ?? []).includes("PROGRAM_ADMIN") ? "Program Admin" : "Interview team",
  }));

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10 pb-28">
      <header className="mb-8">
        <GritLogo className="mb-6" />
        <p className="text-sm text-ink-2">GRIT interview scheduling prototype</p>
        <h1 className="mt-2 font-heading text-3xl font-bold text-ink">Watch the whole interview workflow</h1>
        <p className="mt-2 max-w-xl text-ink-2">
          {env.devTools ? (<>The fastest way in: open <strong className="text-ink">Demo controls</strong> (bottom right) and press{" "}
          <strong className="text-ink">Start the story</strong>. It walks Ravi, a student, from booking to result, and
          switches you to his interviewer when it&apos;s their turn. Each step can run for you or show you where to click.</>) : (<>Pick anyone below to see the interview workflow as them.</>)}
        </p>
        {env.devTools && (
          <p className="mt-2 max-w-xl text-ink-2">Or pick anyone below to look around as them. There&apos;s no login.</p>
        )}
        {reasonText && (
          <p role="status" className="mt-4 rounded-xl border border-alert/40 bg-alert/5 px-4 py-3 text-sm text-ink">
            {reasonText}
          </p>
        )}
      </header>

      <DemoAccessProvider required={env.passcodeRequired} passcodeHint={env.demoPasscode}>
      <Section title="Students" note="Each is parked in a different journey state.">
        {studentPersonas.map((p) => (
          <PersonaButton key={p.id} {...p} />
        ))}
      </Section>

      <Section title="Interviewers">
        {interviewerPersonas.map((p) => (
          <PersonaButton key={p.id} {...p} />
        ))}
      </Section>

      <Section title="Interview team & Program Admins" note="Two Program Admins so two-person approvals work.">
        {teamPersonas.map((p) => (
          <PersonaButton key={p.id} {...p} />
        ))}
      </Section>
      </DemoAccessProvider>
    </main>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">{title}</h2>
        {note && <span className="text-xs text-ink-2/80">{note}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}
