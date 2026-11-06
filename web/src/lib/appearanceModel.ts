// Pure appearance model, shared by the React hook, the pre-paint script's
// tests and the Settings > Appearance page. No DOM or React imports.

export const APPEARANCE_KEY = "halo.appearance";

export type MotionPreference = "system" | "full" | "reduced" | "off";
export type ResolvedMotion = "full" | "reduced" | "off";

export interface Appearance {
  /** Liquid Glass look: 0 = ultra clear, 1 = fully tinted. */
  clarity: number;
  motion: MotionPreference;
  /** Specular highlight follows the pointer. */
  dynamicHighlight: boolean;
  /** Increase Contrast: more opaque glass, darker secondary text. */
  increaseContrast: boolean;
  /** Bold Text: every text style uses its emphasized weight (HIG Typography). */
  boldText: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  clarity: 0.35,
  motion: "system",
  dynamicHighlight: true,
  increaseContrast: false,
  boldText: false,
};

/** Named stops shown under the clarity slider. */
export const CLARITY_STOPS = [
  { value: 0, label: "超透明" },
  { value: 0.35, label: "默认" },
  { value: 0.7, label: "磨砂" },
  { value: 1, label: "着色" },
] as const;

const MOTIONS: readonly MotionPreference[] = ["system", "full", "reduced", "off"];

export function clampClarity(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_APPEARANCE.clarity;
  return Math.round(Math.min(1, Math.max(0, number)) * 100) / 100;
}

/** Accepts anything read from storage and returns a complete, valid value. */
export function normalizeAppearance(raw: unknown): Appearance {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_APPEARANCE };
  const value = raw as Partial<Record<keyof Appearance, unknown>>;
  return {
    clarity: value.clarity === undefined ? DEFAULT_APPEARANCE.clarity : clampClarity(value.clarity),
    motion: MOTIONS.includes(value.motion as MotionPreference) ? (value.motion as MotionPreference) : DEFAULT_APPEARANCE.motion,
    dynamicHighlight: typeof value.dynamicHighlight === "boolean" ? value.dynamicHighlight : DEFAULT_APPEARANCE.dynamicHighlight,
    increaseContrast: typeof value.increaseContrast === "boolean" ? value.increaseContrast : DEFAULT_APPEARANCE.increaseContrast,
    boldText: typeof value.boldText === "boolean" ? value.boldText : DEFAULT_APPEARANCE.boldText,
  };
}

export function parseStoredAppearance(text: string | null | undefined): Appearance {
  if (!text) return { ...DEFAULT_APPEARANCE };
  try {
    return normalizeAppearance(JSON.parse(text));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function resolveMotion(preference: MotionPreference, systemReduced: boolean): ResolvedMotion {
  if (preference === "system") return systemReduced ? "reduced" : "full";
  return preference;
}

/** Attributes and custom properties applied to <html>. */
export function appearanceAttributes(appearance: Appearance, systemReduced: boolean) {
  return {
    clarity: String(clampClarity(appearance.clarity)),
    motion: resolveMotion(appearance.motion, systemReduced),
    highlight: appearance.dynamicHighlight ? "dynamic" : "static",
    contrast: appearance.increaseContrast ? "high" : "normal",
    bold: appearance.boldText ? "on" : "off",
  };
}

/** Human description of a clarity value for the slider's value label. */
export function clarityLabel(clarity: number): string {
  const value = clampClarity(clarity);
  if (value <= 0.15) return "超透明";
  if (value <= 0.5) return "透明";
  if (value <= 0.85) return "磨砂";
  return "着色";
}
