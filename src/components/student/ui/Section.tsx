import Link from "next/link";
import { cn } from "@/lib/utils";

/** A plain section: sentence-case heading, optional link on the right, content below a rule. */
export function Section({
  title,
  link,
  children,
  className,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="flex items-baseline justify-between gap-4 border-b-2 border-ink-line pb-2">
        <h2 className="text-xl font-extrabold text-graphite">{title}</h2>
        {link && (
          <Link href={link.href} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-ballpoint underline underline-offset-4">
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Page title block for non-hero pages (rules, help, leaderboard…). */
export function PageTitle({ title, intro, className }: { title: string; intro?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-8", className)}>
      <h1 className="text-[2.125rem] font-extrabold leading-tight text-graphite sm:text-[2.5rem]">{title}</h1>
      {intro && <p className="mt-2 max-w-[60ch] text-pencil">{intro}</p>}
    </div>
  );
}

/** Back link at the top of a sub-page. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-4 inline-flex min-h-11 items-center gap-1 text-[15px] font-semibold text-ballpoint">
      <span aria-hidden>‹</span> {label}
    </Link>
  );
}
