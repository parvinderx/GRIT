import type { KeyboardEvent } from "react";

const KEYS = new Set(["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]);

/**
 * Arrow-key handler for a role="radiogroup" container (WAI-ARIA radio pattern):
 * moves focus to the previous/next enabled role="radio" descendant, wrapping, and
 * selects it. Pair with a roving tabIndex (0 on the checked radio, or the first
 * enabled one when none is checked; -1 on the rest).
 */
export function onRadioGroupKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (!KEYS.has(e.key)) return;
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'));
  if (radios.length === 0) return;
  const i = radios.indexOf(document.activeElement as HTMLElement);
  let n: number;
  if (e.key === "Home") n = 0;
  else if (e.key === "End") n = radios.length - 1;
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") n = i < 0 ? 0 : (i + 1) % radios.length;
  else n = i < 0 ? radios.length - 1 : (i - 1 + radios.length) % radios.length;
  e.preventDefault();
  radios[n].focus();
  radios[n].click();
}
