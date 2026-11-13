"use client";

import { useCallback, useEffect, useState } from "react";
import { switchPersona } from "@/lib/demoAccess";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, Clapperboard, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { homePathForRoles } from "@/lib/roleHome";
import { toIST } from "@/lib/time";
import { SCENARIOS, type Scenario, type StoryAction, type StoryFacts } from "@/lib/demoStorySteps";

type Persona = { id: string; name: string; roles: string[] };
type Me = { id: string; name: string; roles: string[] } | null;
type Progress = { scenario: string; done: number } | null;

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
  const [clockInfo, setClockInfo] = useState<{ mode: "SIM" | "REAL"; nowIso: string } | null>(null);

  const load = useCallback(async () => {
    const [list, who, story, clk] = await Promise.all([
      fetch("/api/v1/dev/switch-user"),
      fetch("/api/v1/me"),
      fetch("/api/v1/dev/story"),
      fetch("/api/v1/dev/clock"),
    ]);
    if (list.status === 404) return setAvailable(false);
    const cj = await clk.json().catch(() => ({}));
    if (cj.clock) setClockInfo({ mode: cj.clock.mode, nowIso: cj.server_time });
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

  if (!available) return null;

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
    const { ok, json } = await postJson("/api/v1/dev/clock", { ...body, runJobs: true });
    setBusy(null);
    if (!ok) return setMessage({ text: json.message ?? "Couldn't move the clock.", error: true });
    store(
      MSG_KEY,
      JSON.stringify({
        text: body.real
          ? `Back to real time (${toIST(json.now).toFormat("ccc d LLL, h:mm a")} IST). Scheduled jobs ran.`
          : `Clock moved to ${toIST(json.now).toFormat("ccc d LLL, h:mm a")} IST (simulated time). Scheduled jobs ran.`,
      })
    );
    window.location.reload();
  }

  async function tick() {
    setBusy("tick");
    const { ok, json } = await postJson("/api/v1/dev/tick", {});
    setBusy(null);
    if (!ok) return setMessage({ text: json.message ?? "Couldn't run the jobs.", error: true });
    const changed = (json.jobs ?? [])
      .filter((j: { affected: number }) => j.affected > 0)
      .map((j: { job: string; affected: number }) => `${j.job} (${j.affected})`);
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
              <p className="text-[13px] font-bold text-pencil">Simulated time</p>
              <p className="font-display text-xl font-extrabold leading-tight text-graphite">
                {facts ? `${toIST(facts.clockIso).toFormat("ccc d LLL, h:mm a")} IST` : "…"}
              </p>
              <p className="mt-0.5 text-pencil">
                Viewing as <span className="font-bold text-graphite">{me ? `${me.name} (${roleWord(me.roles)})` : "nobody yet"}</span>
              </p>
            </div>
            <button type="button" onClick={() => toggle(false)} aria-label="Close demo stories" className="flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-rule-soft">
              <X className="size-5" aria-hidden />
            </button>
          </div>

          <div className="overflow-y-auto px-4 pb-4">
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
                    {clockInfo && (
                      <p className="text-[13px] font-bold text-graphite">
                        {clockInfo.mode === "REAL"
                          ? "Now: real time"
                          : `Now: simulated time, ${toIST(clockInfo.nowIso).toFormat("ccc d LLL, h:mm a")} IST`}
                      </p>
                    )}
                    <p className="text-[13px] text-pencil">Scheduled jobs run after each jump: attendance checks, result publishing, cooldowns.</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(
                        [
                          ["+10 minutes", { advanceSeconds: 600 }],
                          ["+1 hour", { advanceSeconds: 3600 }],
                          ["+1 day", { advanceSeconds: 86400 }],
                          ["Past the season deadline", { named: "after-deadline" }],
                          ["Back to real time", { real: true }],
                        ] as const
                      ).map(([label, body]) => (
                        <button
                          key={label}
                          type="button"
                          disabled={!!busy}
                          onClick={() => clock(body, label)}
                          className="min-h-11 rounded-lg border-[1.5px] border-rule bg-white px-2 font-bold text-graphite hover:border-graphite disabled:opacity-50"
                        >
                          {busy === label ? "…" : label}
                        </button>
                      ))}
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
