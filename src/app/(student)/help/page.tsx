import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { PageTitle } from "@/components/student/ui/Section";

const CHANNELS = [
  {
    href: "mailto:grit-support@panseeds.in?subject=GRIT%20interview%20help",
    icon: Mail,
    title: "Email the GRIT team",
    detail: "grit-support@panseeds.in",
  },
  {
    href: "https://wa.me/919999999999?text=GRIT%20interview%20help",
    icon: MessageCircle,
    title: "Message on WhatsApp",
    detail: "Chat with the GRIT team",
  },
];

export default function HelpPage() {
  return (
    <div className="max-w-3xl">
      <PageTitle title="Get help" intro="The GRIT team usually replies within one working day." />

      <ul className="border-t-[1.5px] border-graphite">
        {CHANNELS.map((c) => (
          <li key={c.title} className="border-b border-rule">
            <a href={c.href} className="flex min-h-16 items-center gap-4 py-4 hover:bg-rule-soft">
              <c.icon className="size-6 shrink-0 text-ballpoint" aria-hidden />
              <span>
                <span className="block text-lg font-bold text-graphite">{c.title}</span>
                <span className="block text-pencil">{c.detail}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-10 border-l-4 border-ballpoint bg-ballpoint-soft px-5 py-4">
        <p className="font-bold text-graphite">Problem with an interview you&apos;ve booked?</p>
        <p className="mt-1 text-pencil">
          Use &ldquo;Report an emergency&rdquo; on your interview page so the team can act fast. Many other questions are answered in the{" "}
          <Link href="/rules" className="font-semibold text-ballpoint underline underline-offset-4">
            interview rules
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
