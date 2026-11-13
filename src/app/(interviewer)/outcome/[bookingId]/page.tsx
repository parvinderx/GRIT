import { notFound, redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { ApiError } from "@/lib/errors";
import { getOutcomeForm } from "@/services/interviewerView";
import { OutcomeForm } from "@/components/interviewer/OutcomeForm";
import { toIST, formatTime } from "@/lib/time";
import { BackLink } from "@/components/student/ui/Section";

const BACK: Record<string, { href: (id: string) => string; label: string }> = {
  room: { href: (id) => `/room/${id}`, label: "Back to the room" },
  outcomes: { href: () => "/outcomes", label: "Outcomes due" },
};

export default async function OutcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ from?: string; mark?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx?.interviewerId) redirect("/start");
  const { bookingId } = await params;
  const { from, mark } = await searchParams;
  if (!isUuid(bookingId)) notFound();
  const data = await getOutcomeForm(bookingId, ctx.interviewerId).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const roomGone = from === "room" && (data.alreadySubmitted || !!data.closedReason);
  const back = (!roomGone && BACK[from ?? ""]) || { href: () => "/schedule", label: "Today" };

  return (
    <div>
      <BackLink href={back.href(bookingId)} label={back.label} />
      <h1 className="text-[2rem] font-extrabold leading-tight text-graphite">
        {data.editable ? `Record ${data.studentName.split(" ")[0]}'s outcome` : `${data.studentName.split(" ")[0]}'s outcome`}
      </h1>
      <p className="mb-6 mt-1 text-pencil">
        {data.studentName}, {data.badge}. Interview on {toIST(data.startIso).toFormat("ccc d LLL")} at {formatTime(data.startIso)} IST.
      </p>
      <OutcomeForm data={data} preselect={mark === "no_join" ? "NO_JOIN" : undefined} />
    </div>
  );
}
