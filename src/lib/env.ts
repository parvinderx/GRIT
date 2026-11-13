const isProd = process.env.NODE_ENV === "production";
const DEV_FALLBACK_SECRET = "dev_session_secret_change_me_at_least_32_chars_long";

/**
 * Session signing secret. Outside production a fixed dev value is fine; in production
 * a missing or short secret is a hard error. Read lazily (not at import) so
 * `next build`, which runs with NODE_ENV=production, doesn't need runtime secrets.
 */
export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (isProd) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters in production.");
  }
  return s || DEV_FALLBACK_SECRET;
}

const demoPasscode = (process.env.DEMO_PASSCODE ?? "").trim();

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  appTz: process.env.APP_TZ ?? "Asia/Kolkata",
  /** Clock, stories and job tick. On in development, off in production unless explicitly enabled. */
  devTools: (process.env.DEV_TOOLS_ENABLED ?? (isProd ? "false" : "true")) === "true",
  /**
   * Demo passcode for the persona switcher. In production it is the only way to sign in
   * (there is no SSO yet) and /start prints it openly: it marks the deploy as a demo,
   * it is not access control.
   */
  demoPasscode,
  /** Persona switching: always in development; in production only when a demo passcode is set. */
  personaSwitch: !isProd || demoPasscode.length > 0,
  /** Passcode must accompany a persona switch (production with a passcode). */
  passcodeRequired: isProd && demoPasscode.length > 0,
  /** Bearer secret for the job tick and integration endpoints. */
  cronSecret: (process.env.CRON_SECRET ?? "").trim(),
  isProd,
};

export const IST = "Asia/Kolkata";
