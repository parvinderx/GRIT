import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { timeOnly } from "@/lib/time";
import { btnClass } from "@/components/student/ui/Button";
import { StatusLine } from "@/components/student/ui/StatusLine";
import { CantTakeButton } from "./CantTakeButton";

export interface BriefInfo {
  bookingId: string;
  studentName: string | null;
  badge: string | null;
  /** Null outside the brief window (T-24 h to T+24 h). */
  bookingCode: string | null;
  skillsCleared: string[];
  startIso: string;
  /** True once the interview has started (now >= start) and the row is live or ended. */
  canStart: boolean;
  /** Live window (join open). */
  live: boolean;
  /** "I can't take this": null hides it; true = at least 24 h away (handed over), false = the team decides. */
  release?: boolean | null;
}

function initialsOf(name: string | null): string {
  const parts = (name ?? "").replace(/[.]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * The ONE interview brief: shown in the Today page and in a row's dialog (BriefButton).
 * It always ends in the room, never a dead end. Never shows attempt numbers, earlier
 * results or contact details.
 */
export function InterviewBrief({
  info,
  Title = DefaultTitle,
}: {
  info: BriefInfo;
  /** Heading element; the dialog passes its DialogTitle so the dialog is labelled. */
  Title?: ComponentType<{ className?: string; children: ReactNode }>;
}) {
  const start = timeOnly(info.startIso);
  return (
    <div>
      <StatusLine
        tone={info.live ? "live" : "info"}
        icon={info.live ? "Radio" : "CalendarCheck"}
        pulse={info.live}
        text={info.live ? `Live now, ${start}` : `Starts at ${start}`}
      />
      <div className="mt-3 flex items-center gap-4">
        {/* Stand-in for the registered photo: there is no photo storage in the prototype. */}
        <figure className="m-0 shrink-0 text-center">
          <div
            role="img"
            aria-label={`Registered photo of ${info.studentName ?? "the student"} (placeholder showing initials)`}
            className="flex size-16 items-center justify-center rounded-full border-[1.5px] border-graphite bg-rule-soft font-display text-xl font-extrabold text-graphite"
          >
            {initialsOf(info.studentName)}
          </div>
          <figcaption className="mt-1 text-[12px] text-pencil">Registered photo</figcaption>
        </figure>
        <div className="min-w-0">
          <Title className="text-2xl font-extrabold leading-tight text-graphite">{info.studentName ?? "Student"}</Title>
          {info.badge && <p className="text-pencil">{info.badge}</p>}
        </div>
      </div>
      {info.bookingCode && (
        <p className="mt-2 text-pencil">
          Booking code <span className="font-display text-lg font-extrabold tracking-[0.14em] text-graphite">{info.bookingCode}</span>
        </p>
      )}

      {info.skillsCleared.length > 0 && (
        <>
          <p className="mt-5 font-bold text-graphite">Skills they cleared</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {info.skillsCleared.map((s) => (
              <li key={s} className="rounded-md bg-ballpoint-soft px-2 py-0.5 text-[14px] font-bold text-ballpoint">
                {s}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-5 font-bold text-graphite">Before you start</p>
      <ul className="mt-1 space-y-1 text-graphite">
        <li>Face matches the registered photo and college ID</li>
        <li>Student reads out the booking code{info.bookingCode ? ` ${info.bookingCode}` : ""}</li>
        <li>Camera and mic work on both sides</li>
      </ul>

      <Link href={`/room/${info.bookingId}`} className={btnClass(info.live ? "live" : "outline", "mt-6 w-full min-h-11 text-[15px]")}>
        {info.live ? "Join the room" : "Open the room"}
      </Link>
      {info.release != null && !info.live && !info.canStart && <CantTakeButton bookingId={info.bookingId} early={info.release} />}
      <p className="mt-3 text-[14px] text-pencil">Earlier attempts and results are never shown, so every interview starts fresh.</p>
    </div>
  );
}

function DefaultTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h2 className={className}>{children}</h2>;
}
