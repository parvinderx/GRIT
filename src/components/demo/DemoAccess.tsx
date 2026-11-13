"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { readDemoPasscode, saveDemoPasscode } from "@/lib/demoAccess";

type Ctx = { required: boolean; passcode: string; ready: boolean };
const DemoAccessContext = createContext<Ctx>({ required: false, passcode: "", ready: true });

export function useDemoAccess() {
  return useContext(DemoAccessContext);
}

/**
 * Wraps /start. When the deploy needs a demo passcode, it shows a clearly labelled
 * "Demo access" panel that prints the passcode and asks the visitor to enter it. The
 * passcode is public on purpose: this marks the deploy as a demo, it is not a login.
 */
export function DemoAccessProvider({
  required,
  passcodeHint,
  children,
}: {
  required: boolean;
  passcodeHint: string;
  children: React.ReactNode;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore what this tab already entered
    setValue(readDemoPasscode());
  }, []);

  function update(v: string) {
    setValue(v);
    saveDemoPasscode(v.trim());
  }

  const ready = !required || value.trim() === passcodeHint;

  return (
    <DemoAccessContext.Provider value={{ required, passcode: value.trim(), ready }}>
      {required && (
        <section
          aria-labelledby="demo-access-title"
          className="mb-8 rounded-xl border-2 border-dashed border-amber-500/60 bg-amber-50 px-5 py-4 text-ink"
        >
          <h2 id="demo-access-title" className="font-heading text-base font-semibold">
            Demo access
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            This is a demo of the GRIT interview scheduling feature, not a secure system. Enter the demo passcode
            shown here to try it as any person below. Don&apos;t enter real student data.
          </p>
          <p className="mt-3 text-sm">
            Demo passcode:{" "}
            <code className="rounded bg-white px-2 py-0.5 font-mono text-base font-semibold tracking-wide">
              {passcodeHint}
            </code>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="demo-passcode" className="text-sm font-medium">
              Enter passcode
            </label>
            <input
              id="demo-passcode"
              value={value}
              onChange={(e) => update(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-44 rounded-md border border-border bg-white px-3 py-1.5 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => update(passcodeHint)}
              className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium hover:border-cobalt/50"
            >
              Fill it in
            </button>
            <span role="status" className="text-sm text-ink-2">
              {ready ? "Ready. Pick a person below." : "Pick a person once the passcode matches."}
            </span>
          </div>
        </section>
      )}
      {children}
    </DemoAccessContext.Provider>
  );
}
