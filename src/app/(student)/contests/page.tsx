import { PageTitle } from "@/components/student/ui/Section";
import { ButtonLink } from "@/components/student/ui/Button";

// These happen in order, so they're numbered.
const STEPS = [
  { title: "Solve contest problems", body: "Work through problems on the GRIT contest platform. Each one builds up your skills." },
  { title: "Clear every skill for a badge", body: "Once they're all cleared, that badge's interview opens for booking here." },
  { title: "Book and join your interview", body: "Pick a time, join on the day, and earn the badge and its Miles." },
];

export default function ContestsPage() {
  return (
    <div className="max-w-3xl">
      <PageTitle
        title="How to clear skills"
        intro="Contests run on the GRIT contest platform, which your programme team shares with you. This app is where you book the interview once your skills are cleared."
      />
      <ol className="border-t-[1.5px] border-graphite">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4 border-b border-rule py-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-graphite font-display text-lg font-extrabold">
              {i + 1}
            </span>
            <div>
              <p className="text-lg font-bold text-graphite">{s.title}</p>
              <p className="mt-0.5 text-pencil">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <ButtonLink kind="outline" href="/tracks">
          See which skills you need
        </ButtonLink>
        <ButtonLink kind="link" href="/practise">
          How to practise for the interview
        </ButtonLink>
      </div>
    </div>
  );
}
