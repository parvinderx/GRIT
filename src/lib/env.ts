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
  /**
   * Clock, stories and job tick. This app is a feature demo, so they are on everywhere
   * (including the deploy) unless DEV_TOOLS_ENABLED=false.
   */
  devTools: (process.env.DEV_TOOLS_ENABLED ?? "true") === "true",
  /**
   * Optional demo passcode for the persona switcher. Unset = no passcode (the default:
   * the deploy is a demo, there is no login). If set, /start prints it openly.
   */
  demoPasscode,
  /** Persona switching is always on: it is the only way in (there is no SSO). */
  personaSwitch: true,
  /** Passcode must accompany a persona switch (production with a passcode set). */
  passcodeRequired: isProd && demoPasscode.length > 0,
  /** Bearer secret for the job tick and integration endpoints. */
  cronSecret: (process.env.CRON_SECRET ?? "").trim(),
  isProd,
};

export const IST = "Asia/Kolkata";
