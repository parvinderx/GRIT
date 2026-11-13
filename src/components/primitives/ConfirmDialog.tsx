"use client";

import { useId, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "cn";

/**
 * One confirmation pattern for every destructive or bulk action.
 * - Title says what will happen; `impact` lists the consequences.
 * - Optional reason field (with min length) is passed to onConfirm.
 * - Cancel / Esc / backdrop never runs the action.
 * - onConfirm returning `false` keeps the dialog open (e.g. server error).
 * - Uncontrolled (pass `trigger`) or controlled (pass `open` + `onOpenChange`), e.g.
 *   when something other than a button opens it.
 */
export function ConfirmDialog({
  trigger,
  title,
  impact,
  confirmLabel,
  tone = "default",
  reason,
  onConfirm,
  open: openProp,
  onOpenChange,
}: {
  /** Render prop for the opening control (uncontrolled mode). */
  trigger?: (open: () => void) => ReactNode;
  /** Controlled mode: whether the dialog is open. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  impact?: ReactNode;
  confirmLabel: string;
  /** student = the dark GRIT portal look; notebook = the light interviewer look. */
  tone?: "default" | "destructive" | "student" | "notebook";
  reason?: { label: string; placeholder?: string; minLength?: number; required?: boolean };
  onConfirm: (reason: string) => Promise<boolean | void> | boolean | void;
}) {
  const [openState, setOpenInner] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (o: boolean) => {
    if (!controlled) setOpenInner(o);
    onOpenChange?.(o);
  };
  const themed = tone === "student" || tone === "notebook";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const reasonId = useId();

  function setOpenState(o: boolean) {
    if (busy) return;
    setOpen(o);
    if (!o) setText("");
  }

  const min = reason?.minLength ?? 0;
  const needs = reason?.required || min > 0;
  const trimmed = text.trim();
  const reasonOk = !reason || !needs || trimmed.length >= Math.max(min, 1);

  async function confirm() {
    if (!reasonOk || busy) return;
    setBusy(true);
    try {
      const keepOpen = (await onConfirm(trimmed)) === false;
      if (!keepOpen) {
        setOpen(false);
        setText("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {trigger?.(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpenState}>
        <DialogContent className={cn("sm:max-w-md", themed && tone)}>
          <DialogHeader>
            <DialogTitle className={cn("text-lg font-semibold", themed ? "text-graphite" : "text-ink")}>{title}</DialogTitle>
            {impact && <DialogDescription render={<div />} className="space-y-1 text-sm text-ink-2">{impact}</DialogDescription>}
          </DialogHeader>

          {reason && (
            <div>
              <label htmlFor={reasonId} className="mb-1 block text-sm font-medium text-ink">
                {reason.label}
                {!needs && <span className="font-normal text-ink-2"> (optional)</span>}
              </label>
              <textarea
                id={reasonId}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={reason.placeholder}
                rows={3}
                className="w-full rounded-lg border border-border bg-card p-2 text-sm text-ink"
              />
              {min > 0 && (
                <p className={cn("mt-1 text-xs", trimmed.length >= min ? "text-go" : "text-ink-2")}>
                  {trimmed.length} / {min} characters minimum
                </p>
              )}
            </div>
          )}

          <DialogFooter className={cn(themed && "border-rule bg-rule-soft")}>
            <button
              type="button"
              onClick={() => setOpenState(false)}
              disabled={busy}
              className={cn(
                "min-h-11 rounded-xl border px-4 text-sm font-medium disabled:opacity-50",
                themed ? "border-rule bg-cream text-graphite" : "border-border bg-card text-ink"
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!reasonOk || busy}
              className={cn(
                "min-h-11 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50",
                tone === "destructive" ? "bg-alert" : tone === "student" ? "bg-grit-purple" : tone === "notebook" ? "bg-graphite" : "bg-cobalt"
              )}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
