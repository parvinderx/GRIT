import Link from "next/link";
import { RULES, RULE_GROUPS } from "@/lib/rules";
import { PageTitle } from "@/components/student/ui/Section";

const OTHER = [
  "You can hold one booked Level Clearance Interview at a time.",
  "The interview is a 30-minute live video call. Keep your camera on and college ID ready. No AI tools or outside help.",
  "Integrity reviews can pause a journey or nullify a badge under GRIT T&C 7.4.",
  "GRIT needs a Track Badge by 31 Dec 2026, so book early to leave room for a retry.",
];

export default function RulesPage() {
  const groups = [...RULE_GROUPS.map((g) => ({ title: g.title, items: g.ids.map((id) => RULES[id]) })), { title: "Good to know", items: OTHER }];
  return (
    <div className="max-w-3xl">
      <PageTitle title="Interview rules" intro="How Level Clearance Interviews work, in short. Open a section to read it." />
      <div className="border-t-[1.5px] border-graphite">
        {groups.map((g, i) => (
          <details key={g.title} open={i === 0} className="group border-b border-rule">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg font-bold text-graphite">
              {g.title}
              <span className="text-2xl font-normal text-pencil transition-transform group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <ul className="space-y-3 pb-5 text-pencil">
              {g.items.map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-pencil" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <p className="mt-8 text-pencil">
        Something not covered here?{" "}
        <Link href="/help" className="font-semibold text-ballpoint underline underline-offset-4">
          Contact GRIT support
        </Link>
      </p>
    </div>
  );
}
