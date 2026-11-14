"use client";

import { useCallback, useEffect, useState } from "react";
import { switchPersona } from "@/lib/demoAccess";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, Clapperboard, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { homePathForRoles } from "@/lib/roleHome";
import { toIST } from "@/lib/time";
import { SCENARIOS, type Scenario, type StoryAction, type StoryFacts } from "@/lib/demoStorySteps";

type Persona = { id: string; name: string; roles: string[] };
type Me = { id: string; name: string; roles: string[] } | null;
type Progress = { scenario: string; done: number } | null;
type ClockInfo = { shifted: boolean; offsetSeconds: number; serverIso: string; loadedAt: number };
type NextInterview = { id: string; startAt: string; studentName: string; interviewerName: string; scope: "yours" | "anyone" };
type Rules = { joinOpenMinutes: number; attendanceCheckMinutes: number; slotDurationMinutes: number };
const DEFAULT_RULES: Rules = { joinOpenMinutes: 10, attendanceCheckMinutes: 15, slotDurationMinutes: 40 };

const JOB_WORDS: Record<string, string> = {
  slotMaterialiser: "new open times",
  decemberPools: "December seat pools",
  poolRelease: "seat pool release",
  attendanceCheck: "attendance check",
  outcomePublisher: "results published",
  cooldownExpiry: "wait periods ended",
  deadlineSweep: "season deadline",
  reminders: "reminders sent",
  outcomeSla: "overdue outcome alerts",
  triageSla: "overdue case alerts",
  seasonEnd: "season closed",
};

/** The jobs that changed something, in plain words: ["attendance check (1)", …] */
function jobSummary(jobs: unknown): string[] {
  return ((jobs ?? []) as { job: string; affected: number }[])
    .filter((j) => j.affected > 0)
    .map((j) => `${JOB_WORDS[j.job] ?? j.job} (${j.affected})`);
}

/** "2 days 3 h", "45 min", "under a minute" */
function spanWords(seconds: number) {
  const s = Math.abs(Math.round(seconds));
  if (s < 60) return "under a minute";
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const parts = [d ? `${d} ${d === 1 ? "day" : "days"}` : "", h ? `${h} h` : "", !d && m ? `${m} min` : ""].filter(Boolean);
  return parts.join(" ");
}

const OPEN_KEY = "grit-demo-open";
const MSG_KEY = "grit-demo-message";
const PROGRESS_KEY = "grit-demo-progress";

const ROLE_GROUPS: { label: string; test: (r: string[]) => boolean }[] = [
  { label: "Students", test: (r) => r.includes("STUDENT") },
  { label: "Interviewers", test: (r) => r.includes("INTERVIEWER") },
  { label: "Interview team and admins", test: (r) => r.includes("INTERVIEW_ADMIN") || r.includes("PROGRAM_ADMIN") },
];
const GROUP_ORDER: Scenario["group"][] = ["Core outcomes", "Joining", "Integrity", "Called off and changes", "Limits"];
const AS_WORD = { student: "the student", interviewer: "the interviewer", admin: "the interview team" } as const;

const roleWord = (roles: string[]) =>
  roles.includes("STUDENT") ? "student" : roles.includes("INTERVIEWER") ? "interviewer" : roles.length ? "interview team" : "no role";

function store(key: string, value: string | null) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the panel still works, it just forgets */
  }
}
function read<T>(key: string): T | null {
  try {
    const v = sessionStorage.getItem(key);
    return v == null ? null : (JSON.parse(v) as T);
  } catch {
    return null;
  }
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

/**
 * Demo controls: user-case stories for the whole interview workflow, plus free play.
 * Each step says what happens and offers "Do it for me" (run it through the real
 * services) or "Show me" (set the moment up and open the page as the right person, so
 * you can do it yourself, then mark it done).
 */
export function StoryPanel() {
  const pathname = usePathname();
  const [available, setAvailable] = useState(true);
  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [me, setMe] = useState<Me>(null);
  const [facts, setFacts] = useState<StoryFacts | null>(null);
  const [progress, setProgress] = useState<Progress>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);
  const [clockInfo, setClockInfo] = useState<ClockInfo | null>(null);
  const [next, setNext] = useState<NextInterview | null>(null);
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [helpOpen, setHelpOpen] = useState(false);
  const [customAt, setCustomAt] = useState("");
  const [tickNow, setTickNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [list, who, story, clk] = await Promise.all([
      fetch("/api/v1/dev/switch-user"),
      fetch("/api/v1/me"),
      fetch("/api/v1/dev/story"),
      fetch("/api/v1/dev/clock"),
    ]);
    if (list.status === 404) return setAvailable(false);
    const cj = await clk.json().catch(() => ({}));
    if (cj.clock) {
      setClockInfo({ shifted: !!cj.clock.shifted, offsetSeconds: cj.clock.offsetSeconds ?? 0, serverIso: cj.server_time, loadedAt: Date.now() });
      setNext(cj.nextInterview ?? null);
      if (cj.rules) setRules(cj.rules);
    }
    const l = await list.json().catch(() => ({}));
    const m = await who.json().catch(() => ({}));
    const s = await story.json().catch(() => ({}));
    setPersonas(l.users ?? []);
    setMe(m.user ? { id: m.user.userId, name: m.user.name, roles: m.user.roles ?? [] } : null);
    if (s.facts) setFacts(s.facts);
  }, []);

  useEffect(() => {
    // Restore per-tab UI state after a full navigation (the panel survives page loads this way).
    const savedOpen = read<boolean>(OPEN_KEY);
    const msg = read<{ text: string; error?: boolean }>(MSG_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring per-tab UI state after a full navigation
    setOpen(savedOpen ?? pathname === "/start");
    setProgress(read<Progress>(PROGRESS_KEY));
    if (msg) {
      setMessage(msg);
      store(MSG_KEY, null);
    }
    void load();
  }, [pathname, load]);

  // The panel's clock ticks along with the app clock while it's open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  if (!available) return null;

  const appNowMs = clockInfo ? new Date(clockInfo.serverIso).getTime() + (tickNow - clockInfo.loadedAt) : null;
  const appNowText = appNowMs != null ? toIST(new Date(appNowMs).toISOString()).toFormat("ccc d LLL, h:mm:ss a") : "…";
  const nextStartMs = next ? new Date(next.startAt).getTime() : null;
  const INTERVIEW_MOMENTS: { label: string; hint: string; minutes: number }[] = [
    { label: "Join opens", hint: `${rules.joinOpenMinutes} min before`, minutes: -rules.joinOpenMinutes },
    { label: "Interview starts", hint: "start time", minutes: 0 },
    { label: "Attendance check", hint: `${rules.attendanceCheckMinutes} min after start`, minutes: rules.attendanceCheckMinutes },
    { label: "Interview over", hint: `${rules.slotDurationMinutes} min after start`, minutes: rules.slotDurationMinutes },
  ];

  const scenario = progress ? SCENARIOS.find((s) => s.id === progress.scenario) ?? null : null;

  function toggle(v: boolean) {
    setOpen(v);
    store(OPEN_KEY, JSON.stringify(v));
  }
  function saveProgress(p: Progress) {
    setProgress(p);
    store(PROGRESS_KEY, p ? JSON.stringify(p) : null);
  }

  /** Become `userId` (if needed) and load `path` with a full navigation, so every page re-reads the session. */
  async function go(userId: string | null, path: string, msg?: { text: string; error?: boolean }) {
    if (userId && userId !== me?.id) {
      const err = await switchPersona(userId);
      if (err) {
        setBusy(null);
        setMessage({ text: err, error: true });
        return;
      }
    }
    if (msg) store(MSG_KEY, JSON.stringify(msg));
    store(OPEN_KEY, "true");
    window.location.assign(path);
  }

  async function run(action: StoryAction, mode: "do" | "show", stepIndex: number) {
    if (!scenario) return;
    setBusy(`${mode}-${stepIndex}`);
    setMessage(null);
    const { ok, json } = await postJson("/api/v1/dev/story", { action, mode });
    if (!ok) {
      setBusy(null);
      setMessage({ text: json.message ?? "That step didn't work. Start the story over.", error: true });
      return;
    }
    // "Do it" (and the reset) completes the step; "Show me" waits for you to mark it done.
    if (mode === "do" || action === "reset") saveProgress({ scenario: scenario.id, done: stepIndex + 1 });
    await go(json.userId, json.redirect, { text: json.message });
  }

  function pickStory(s: Scenario) {
    saveProgress({ scenario: s.id, done: 0 });
    setMessage(null);
  }

  async function clock(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMessage(null);
    const { ok, json } = await postJson("/api/v1/dev/clock", { ...body, runJobs: true });
    if (!ok) {
      setBusy(null);
      return setMessage({ text: json.message ?? "Couldn't move the clock.", error: true });
    }
    const at = `${toIST(json.now).toFormat("ccc d LLL, h:mm a")} IST`;
    const changed = jobSummary(json.jobs);
    const jobsText = changed.length ? ` Jobs that ran: ${changed.join(", ")}.` : " Nothing else was due yet.";
    const who = json.interview ? ` (${json.interview.studentName}'s interview with ${json.interview.interviewerName})` : "";
    store(
      MSG_KEY,
      JSON.stringify({
        text: body.real
          ? `Back to real time: ${at}.${jobsText}`
          : `Jumped to ${at}${who}. The clock keeps running from here.${jobsText}`,
      })
    );
    store(OPEN_KEY, "true");
    window.location.reload();
  }

  async function tick() {
    setBusy("tick");
    const { ok, json } = await postJson("/api/v1/dev/tick", {});
    setBusy(null);
    if (!ok) return setMessage({ text: json.message ?? "Couldn't run the jobs.", error: true });
    const changed = jobSummary(json.jobs);
    store(MSG_KEY, JSON.stringify({ text: changed.length ? `Jobs ran: ${changed.join(", ")}.` : "Jobs ran. Nothing was due." }));
    window.location.reload();
  }

  const btnPrimary =
    "flex min-h-11 items-center rounded-lg bg-highlight px-4 font-bold text-highlight-ink shadow-[inset_0_-3px_0_rgba(58,46,0,0.18)] disabled:opacity-50";
  const btnOutline = "flex min-h-11 items-center rounded-lg border-[1.5px] border-graphite bg-white px-4 font-bold text-graphite disabled:opacity-50";

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => toggle(true)}
          className="notebook fixed bottom-4 right-4 z-50 flex min-h-12 items-center gap-2 rounded-full border-[1.5px] border-graphite bg-white px-4 font-bold text-graphite shadow-[0_6px_20px_rgba(29,33,41,0.18)]"
        >
          <Clapperboard className="size-5" aria-hidden /> Demo stories
        </button>
      )}

      {open && (
        <aside
          aria-label="Demo stories"
          className="notebook fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col border-t-[1.5px] border-graphite bg-white text-[15px] shadow-[0_-8px_24px_rgba(29,33,41,0.16)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-h-[calc(100dvh-2rem)] sm:w-[400px] sm:rounded-xl sm:border-[1.5px]"
        >
          {/* where and who */}
          <div className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
            <div>
              <p className="text-[13px] font-bold text-pencil">
                {clockInfo?.shifted ? `Demo time, ${spanWords(clockInfo.offsetSeconds)} ahead of real time` : "App time (real time)"}
              </p>
              <p className="font-display text-xl font-extrabold leading-tight tabular-nums text-graphite">
                {appNowMs != null ? `${appNowText} IST` : facts ? `${toIST(facts.clockIso).toFormat("ccc d LLL, h:mm a")} IST` : "…"}
              </p>
              <p className="mt-0.5 text-pencil">
                Viewing as <span className="font-bold text-graphite">{me ? `${me.name} (${roleWord(me.roles)})` : "nobody yet"}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => setHelpOpen((v) => !v)}
                aria-label="What are demo controls?"
                aria-expanded={helpOpen}
                aria-controls="demo-help"
                title="What are demo controls?"
                className={cn("flex size-11 items-center justify-center rounded-lg hover:bg-rule-soft", helpOpen && "bg-ballpoint-soft text-ballpoint")}
              >
                <Info className="size-5" aria-hidden />
              </button>
              <button type="button" onClick={() => toggle(false)} aria-label="Close demo stories" className="flex size-11 items-center justify-center rounded-lg hover:bg-rule-soft">
                <X className="size-5" aria-hidden />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto px-4 pb-4">
            {helpOpen && (
              <div id="demo-help" className="mt-3 rounded-lg border-[1.5px] border-ballpoint bg-ballpoint-soft px-3 py-3 text-[14px] text-graphite">
                <p className="font-extrabold">What are demo controls?</p>
                <p className="mt-1">
                  A helper that exists only on this demo. It lets you see the whole interview workflow in a few minutes, without waiting
                  days for real time to pass or signing in as different people. Real users never see it.
                </p>
                <dl className="mt-2 space-y-2">
                  <div>
                    <dt className="font-bold">Stories</dt>
                    <dd>
                      Guided walk-throughs of real situations (pass, fail, no-show, cheating, reschedule…). &ldquo;Do it for me&rdquo; runs
                      the step through the real system. &ldquo;Show me&rdquo; opens the right page as the right person so you can click it
                      yourself.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold">Move the clock</dt>
                    <dd>
                      The app has its own clock. A jump moves it forward, then it keeps ticking normally from the new moment, so
                      countdowns and join windows behave exactly as they would for real. Anything that became due (attendance checks,
                      publishing results, wait periods ending) happens straight after the jump. Time only moves forward; &ldquo;Back to
                      real time&rdquo; returns to today.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold">Be someone else</dt>
                    <dd>Switch to any sample student, interviewer or admin to see their screens.</dd>
                  </div>
                </dl>
                <p className="mt-2 text-pencil">
                  Everything here changes the shared demo data. &ldquo;Start over&rdquo; inside a story puts Ravi back to a clean start.
                </p>
                <button type="button" onClick={() => setHelpOpen(false)} className="mt-2 min-h-11 font-semibold text-ballpoint underline underline-offset-4">
                  Got it
                </button>
              </div>
            )}

            {message && (
              <p
                role="status"
                className={cn(
                  "mt-3 border-l-4 px-3 py-2 text-graphite",
                  message.error ? "border-amberline bg-amberline-soft" : "border-mint bg-mint-soft"
                )}
              >
                {message.text}
              </p>
            )}

            {!scenario ? (
              /* ── Pick a story ─────────────────────────────────────────── */
              <div>
                <h2 className="mt-4 text-lg font-extrabold text-graphite">Pick a story</h2>
                <p className="text-pencil">Each one follows Ravi, a student, through a real situation, from a clean start.</p>
                {GROUP_ORDER.map((g) => (
                  <div key={g} className="mt-4">
                    <p className="text-[13px] font-bold text-pencil">{g}</p>
                    <ul className="mt-1 divide-y divide-rule border-y border-rule">
                      {SCENARIOS.filter((s) => s.group === g).map((s) => (
                        <li key={s.id}>
                          <button type="button" onClick={() => pickStory(s)} className="block w-full py-2.5 text-left hover:bg-rule-soft">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="font-bold text-graphite">{s.title}</span>
                              <span className="shrink-0 text-[13px] text-pencil">{s.steps.length} steps</span>
                            </span>
                            <span className="block text-[14px] text-pencil">{s.summary}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              /* ── Inside a story ───────────────────────────────────────── */
              <div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button type="button" onClick={() => saveProgress(null)} className="inline-flex min-h-11 items-center gap-1 font-semibold text-ballpoint">
                    <ChevronLeft className="size-4" aria-hidden /> All stories
                  </button>
                  {progress!.done > 0 && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => run("reset", "do", 0)}
                      className="min-h-11 px-1 font-semibold text-ballpoint underline underline-offset-4 disabled:opacity-50"
                    >
                      Start over
                    </button>
                  )}
                </div>
                <h2 className="text-lg font-extrabold text-graphite">{scenario.title}</h2>
                <p className="text-pencil">{scenario.summary}</p>

                <ol className="mt-3">
                  {scenario.steps.map((s, i) => {
                    const state = i < progress!.done ? "done" : i === progress!.done ? "current" : "later";
                    return (
                      <li
                        key={i}
                        className={cn("relative border-b border-rule py-3 pl-9", state === "current" && "-mx-2 rounded-lg bg-ballpoint-soft px-2 pl-11")}
                      >
                        <span
                          className={cn(
                            "absolute top-3 flex size-6 items-center justify-center rounded-full text-[13px] font-bold",
                            state === "current" ? "left-2 bg-ballpoint text-white" : "left-0",
                            state === "done" && "bg-graphite text-white",
                            state === "later" && "border-[1.5px] border-rule text-pencil"
                          )}
                          aria-hidden
                        >
                          {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                        </span>
                        <p className={cn("font-bold", state === "later" ? "text-pencil" : "text-graphite")}>
                          {s.title}
                          <span className="sr-only">, {state === "current" ? "next step" : state}</span>
                        </p>
                        {state === "current" && (
                          <>
                            <p className="mt-0.5 text-graphite">{s.body}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button type="button" disabled={!!busy} onClick={() => run(s.action, "do", i)} className={btnPrimary}>
                                {busy === `do-${i}` ? "Working…" : s.action === "reset" ? "Start the story" : "Do it for me"}
                              </button>
                              {s.action !== "reset" && (
                                <button type="button" disabled={!!busy} onClick={() => run(s.action, "show", i)} className={btnOutline}>
                                  {busy === `show-${i}` ? "Opening…" : "Show me"}
                                </button>
                              )}
                            </div>
                            {s.action !== "reset" && (
                              <p className="mt-1.5 text-[13px] text-pencil">
                                &ldquo;Show me&rdquo; opens the page as {AS_WORD[s.as]} so you can do it yourself.{" "}
                                <button
                                  type="button"
                                  onClick={() => saveProgress({ scenario: scenario.id, done: i + 1 })}
                                  className="font-semibold text-ballpoint underline underline-offset-2"
                                >
                                  I did it, next step
                                </button>
                              </p>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ol>

                {progress!.done >= scenario.steps.length && (
                  <div className="mt-3 border-l-4 border-mint bg-mint-soft px-3 py-2 text-graphite">
                    <p className="font-bold">That&apos;s the whole story.</p>
                    <button type="button" onClick={() => saveProgress(null)} className="mt-1 font-semibold text-ballpoint underline underline-offset-4">
                      Pick another story
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* free play */}
            <div className="mt-5 border-t border-rule pt-3">
              <button
                type="button"
                onClick={() => setFreeOpen((v) => !v)}
                aria-expanded={freeOpen}
                className="flex min-h-11 w-full items-center justify-between font-extrabold text-graphite"
              >
                Free play
                <ChevronDown className={cn("size-5 transition-transform", freeOpen && "rotate-180")} aria-hidden />
              </button>
              {freeOpen && (
                <div className="space-y-4 pb-2">
                  <div>
                    <p className="font-bold text-graphite">Move the clock</p>
                    <p className="text-[13px] text-pencil">
                      Jumps go forward and the clock keeps running from there. Due jobs (attendance checks, results, wait periods) run
                      straight after each jump.
                    </p>

                    {/* jump to a moment of the next interview */}
                    <div className="mt-2 rounded-lg border-[1.5px] border-rule px-3 py-2">
                      <p className="text-[13px] font-bold text-pencil">Next interview</p>
                      {next && nextStartMs != null ? (
                        <>
                          <p className="font-bold text-graphite">
                            {toIST(next.startAt).toFormat("ccc d LLL, h:mm a")} IST
                            {appNowMs != null && nextStartMs > appNowMs && (
                              <span className="font-semibold text-pencil"> · in {spanWords((nextStartMs - appNowMs) / 1000)}</span>
                            )}
                          </p>
                          <p className="text-[13px] text-pencil">
                            {next.studentName} with {next.interviewerName}
                            {next.scope === "anyone" && me ? " (not yours: the earliest anyone has)" : ""}
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {INTERVIEW_MOMENTS.map((m) => {
                              const passed = appNowMs != null && nextStartMs + m.minutes * 60_000 < appNowMs - 1000;
                              return (
                                <button
                                  key={m.label}
                                  type="button"
                                  disabled={!!busy || passed}
                                  title={passed ? "Already past" : undefined}
                                  onClick={() => clock({ relativeToNextInterview: true, minutes: m.minutes }, m.label)}
                                  className="min-h-11 rounded-lg border-[1.5px] border-rule bg-white px-2 py-1 text-left leading-tight hover:border-graphite disabled:opacity-40"
                                >
                                  <span className="block font-bold text-graphite">{busy === m.label ? "Moving…" : m.label}</span>
                                  <span className="block text-[12px] text-pencil">{passed ? "already past" : m.hint}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <p className="text-[14px] text-graphite">No upcoming interview. Book one (or run a story) to jump straight to its moments.</p>
                      )}
                    </div>

                    {/* step forward */}
                    <p className="mt-3 text-[13px] font-bold text-pencil">Skip ahead by</p>
                    <div className="mt-1 grid grid-cols-3 gap-2">
                      {(
                        [
                          ["+5 min", 300],
                          ["+15 min", 900],
                          ["+1 hour", 3600],
                          ["+1 day", 86400],
                          ["+3 days", 259200],
                          ["+1 week", 604800],
                        ] as const
                      ).map(([label, secs]) => (
                        <button
                          key={label}
                          type="button"
                          disabled={!!busy}
                          onClick={() => clock({ advanceSeconds: secs }, label)}
                          className="min-h-11 rounded-lg border-[1.5px] border-rule bg-white px-2 font-bold text-graphite hover:border-graphite disabled:opacity-50"
                        >
                          {busy === label ? "…" : label}
                        </button>
                      ))}
                    </div>

                    {/* pick an exact moment */}
                    <form
                      className="mt-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (customAt) void clock({ set: customAt }, "custom");
                      }}
                    >
                      <label htmlFor="demo-jump-at" className="text-[13px] font-bold text-pencil">
                        Jump to an exact time (IST)
                      </label>
                      <div className="mt-1 flex gap-2">
                        <input
                          id="demo-jump-at"
                          type="datetime-local"
                          value={customAt}
                          min={appNowMs != null ? toIST(new Date(appNowMs).toISOString()).toFormat("yyyy-LL-dd'T'HH:mm") : undefined}
                          onChange={(e) => setCustomAt(e.target.value)}
                          className="min-h-11 min-w-0 flex-1 rounded-lg border-[1.5px] border-rule bg-white px-2 text-graphite"
                        />
                        <button
                          type="submit"
                          disabled={!!busy || !customAt}
                          className="min-h-11 shrink-0 rounded-lg border-[1.5px] border-graphite bg-white px-3 font-bold text-graphite disabled:opacity-50"
                        >
                          {busy === "custom" ? "…" : "Jump"}
                        </button>
                      </div>
                    </form>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => clock({ named: "after-deadline" }, "deadline")}
                        className="min-h-11 rounded-lg border-[1.5px] border-rule bg-white px-2 font-bold text-graphite hover:border-graphite disabled:opacity-50"
                      >
                        {busy === "deadline" ? "…" : "Past the season deadline"}
                      </button>
                      <button
                        type="button"
                        disabled={!!busy || !clockInfo?.shifted}
                        onClick={() => clock({ real: true }, "real")}
                        className="min-h-11 rounded-lg border-[1.5px] border-rule bg-white px-2 font-bold text-graphite hover:border-graphite disabled:opacity-50"
                      >
                        {busy === "real" ? "…" : clockInfo?.shifted ? "Back to real time" : "On real time"}
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={tick}
                      className="mt-2 min-h-11 rounded-lg border-[1.5px] border-rule bg-white px-3 font-bold text-graphite hover:border-graphite disabled:opacity-50"
                    >
                      {busy === "tick" ? "Running…" : "Run scheduled jobs now"}
                    </button>
                  </div>

                  <div>
                    <p className="font-bold text-graphite">Be someone else</p>
                    {ROLE_GROUPS.map((g) => {
                      const people = personas.filter((p) => g.test(p.roles));
                      if (!people.length) return null;
                      return (
                        <div key={g.label} className="mt-2">
                          <p className="text-[13px] text-pencil">{g.label}</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {people.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                disabled={!!busy}
                                onClick={() => go(p.id, homePathForRoles(p.roles))}
                                aria-current={p.id === me?.id ? "true" : undefined}
                                className={cn(
                                  "min-h-10 rounded-full border-[1.5px] px-3 text-[14px] font-bold",
                                  p.id === me?.id ? "border-graphite bg-graphite text-white" : "border-rule bg-white text-graphite hover:border-graphite"
                                )}
                              >
                                {p.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
