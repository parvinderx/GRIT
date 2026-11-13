"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { homePathForRoles } from "@/lib/roleHome";
import { switchPersona } from "@/lib/demoAccess";
import { useDemoAccess } from "./DemoAccess";

export function PersonaButton({
  id,
  name,
  roles,
  sub,
  next,
}: {
  id: string;
  name: string;
  roles: string[];
  sub?: string;
  next?: string;
}) {
  const router = useRouter();
  const access = useDemoAccess();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    setBusy(true);
    setError(null);
    const err = await switchPersona(id, access.passcode);
    if (err) {
      setBusy(false);
      setError(err);
      return;
    }
    router.push(next || homePathForRoles(roles));
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={enter}
        disabled={busy || !access.ready}
        className="group flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-cobalt/40 hover:shadow-sm disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block truncate font-heading text-base font-medium text-ink">{name}</span>
          {sub && <span className="block truncate text-sm text-ink-2">{sub}</span>}
        </span>
        <ArrowRight className="size-4 shrink-0 text-ink-2 transition group-hover:translate-x-0.5 group-hover:text-cobalt" aria-hidden />
      </button>
      {error && (
        <p role="alert" className="mt-1 px-1 text-sm text-ink">
          {error}
        </p>
      )}
    </div>
  );
}
