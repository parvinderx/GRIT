/**
 * Client-side memory of the demo passcode (per browser tab). The passcode is printed
 * on /start, so this is a demo opt-in, not a credential.
 */
const KEY = "grit_demo_passcode";

export function readDemoPasscode(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveDemoPasscode(v: string) {
  try {
    if (v) sessionStorage.setItem(KEY, v);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the user will be asked again */
  }
}

/** Switch persona. Returns an error message, or null on success. */
export async function switchPersona(userId: string, passcode = readDemoPasscode()): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/dev/switch-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, passcode }),
    });
    if (res.ok) return null;
    const j = await res.json().catch(() => ({}));
    return (j as { message?: string }).message ?? "Couldn't switch to that person.";
  } catch {
    return "Couldn't reach the server. Check your connection and try again.";
  }
}
