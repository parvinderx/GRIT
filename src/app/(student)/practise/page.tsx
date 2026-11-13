import { PageTitle } from "@/components/student/ui/Section";
import { ButtonLink } from "@/components/student/ui/Button";

const TIPS = [
  { title: "Think out loud", body: "Interviewers score how you reason, not only the final answer. Say each step as you work." },
  { title: "Re-solve a few problems", body: "Pick two or three contest problems from this badge's skills and solve them again, narrating as you go." },
  { title: "Do a dry run", body: "Ask a friend to play interviewer: 30 minutes, camera on, no notes." },
  { title: "Check your setup early", body: "Test your camera and mic from your interview page a day before, so the call starts smoothly." },
];

export default function PractisePage() {
  return (
    <div className="max-w-3xl">
      <PageTitle title="Practise for your interview" intro="Four ways to get ready for your next Level Clearance Interview." />
      <ul className="border-t-[1.5px] border-graphite">
        {TIPS.map((t) => (
          <li key={t.title} className="border-b border-rule py-5">
            <p className="text-lg font-bold text-graphite">{t.title}</p>
            <p className="mt-0.5 text-pencil">{t.body}</p>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <ButtonLink kind="outline" href="/tracks">
          See your badges
        </ButtonLink>
        <ButtonLink kind="link" href="/contests">
          How to clear skills
        </ButtonLink>
      </div>
    </div>
  );
}
