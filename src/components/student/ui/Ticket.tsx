import { toIST, formatTime, timeOnly } from "@/lib/time";

/**
 * The booking as an object: date and time first and largest, then the details a
 * student needs on the day. A plain white slip with a graphite edge.
 */
export function Ticket({
  badgeName,
  startIso,
  joinOpensIso,
  joinByIso,
  interviewerFirstName,
  bookingCode,
  showWhen = true,
}: {
  badgeName: string;
  startIso: string;
  joinOpensIso?: string;
  joinByIso?: string;
  interviewerFirstName?: string | null;
  bookingCode?: string | null;
  /** Hide the big date/time block when the page headline already says it. */
  showWhen?: boolean;
}) {
  const rows: [string, React.ReactNode][] = [["Badge", badgeName]];
  if (joinOpensIso) rows.push(["Join opens", timeOnly(joinOpensIso)]);
  if (joinByIso) rows.push(["Join by", timeOnly(joinByIso)]);
  if (interviewerFirstName) rows.push(["Interviewer", interviewerFirstName]);
  if (bookingCode) rows.push(["Booking code", <span key="c" className="font-bold tracking-[0.12em]">{bookingCode}</span>]);
  rows.push(["Where", "Your interview page"]);

  return (
    <div className="overflow-hidden rounded-xl border-[1.5px] border-graphite bg-white">
      <div className="border-b-[1.5px] border-dashed border-graphite/40 px-5 py-4">
        <p className="text-[15px] font-bold text-pencil">Level Clearance Interview, 30 min</p>
        {showWhen ? (
          <>
            <p className="mt-1 font-display text-2xl font-extrabold text-graphite">{toIST(startIso).toFormat("cccc d LLLL")}</p>
            <p className="font-display text-[2.5rem] font-extrabold leading-none text-graphite">
              {formatTime(startIso)} <span className="text-xl font-bold text-pencil">IST</span>
            </p>
          </>
        ) : (
          <p className="mt-0.5 font-display text-xl font-extrabold text-graphite">Booking details</p>
        )}
      </div>
      <dl className="divide-y divide-rule px-5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-[15px] text-pencil">{k}</dt>
            <dd className="text-right font-bold text-graphite">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
