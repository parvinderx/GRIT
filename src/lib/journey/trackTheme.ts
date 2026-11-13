/**
 * One colour per track for badge medals, track dots and progress. Deliberately NOT the
 * brand purple (that's the UI's action colour), so an earned badge stands out on the
 * page. Jewel tones that sit well with the gold rim on dark and light surfaces.
 * Keyed by tracks.code.
 */
export interface TrackTheme {
  /** Solid hue (medal core, ribbons, progress arc, track dot). */
  hue: string;
  /** Pale tint for an unearned medal's centre (mixed with the page surface). */
  soft: string;
}

const tint = (hex: string) => `color-mix(in srgb, ${hex} 22%, var(--color-cream))`;

const THEMES: Record<string, TrackTheme> = {
  "ai-product": { hue: "#2f6bff", soft: tint("#2f6bff") }, // sapphire
  "ai-systems": { hue: "#12b886", soft: tint("#12b886") }, // emerald
  "ai-models": { hue: "#e0458f", soft: tint("#e0458f") }, // magenta
};

export function trackTheme(code: string | null | undefined): TrackTheme {
  return (code && THEMES[code]) || THEMES["ai-product"];
}
