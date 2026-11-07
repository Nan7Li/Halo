import { useCallback, useEffect, useState } from "react";
import {
  APPEARANCE_KEY,
  appearanceAttributes,
  parseStoredAppearance,
  type Appearance,
} from "./appearanceModel";

export * from "./appearanceModel";

const CHANGE_EVENT = "halo:appearance";

/** Fine pointer on a wide window: lay out with macOS metrics. Mirrors theme-init.js. */
export const MAC_IDIOM_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 1024px)";

function systemReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function readAppearance(): Appearance {
  try {
    return parseStoredAppearance(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return parseStoredAppearance(null);
  }
}

export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  const attrs = appearanceAttributes(appearance, systemReducedMotion());
  root.style.setProperty("--glass-clarity", attrs.clarity);
  root.dataset.motion = attrs.motion;
  root.dataset.highlight = attrs.highlight;
  root.dataset.contrast = attrs.contrast;
  root.dataset.bold = attrs.bold;
  root.dataset.wallpaper = attrs.wallpaper;
  root.dataset.refraction = attrs.refraction;
}

export function writeAppearance(appearance: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    /* private mode: the change still applies for this page */
  }
  applyAppearance(appearance);
  window.dispatchEvent(new CustomEvent<Appearance>(CHANGE_EVENT, { detail: appearance }));
}

export function useAppearance() {
  const [appearance, setState] = useState<Appearance>(readAppearance);
  useEffect(() => {
    const sync = (event: Event) => setState((event as CustomEvent<Appearance>).detail);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  const update = useCallback((patch: Partial<Appearance>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      writeAppearance(next);
      return next;
    });
  }, []);
  return { appearance, update };
}

/** Whether animations should move (false for "reduced" and "off"). */
export function motionAllowed() {
  return document.documentElement.dataset.motion === "full";
}

// Only small glass controls follow the pointer. --mx/--my are inherited, so
// setting them on the sidebar or a sheet restyled and repainted the whole
// panel (and everything in it) on every mouse move.
const GLASS_SELECTOR = ".glass-interactive";

/**
 * Starts global listeners: the OS reduced-motion setting, and the
 * pointer-following specular highlight. Returns a cleanup function.
 */
export function installAppearanceRuntime() {
  applyAppearance(readAppearance());
  // Only Chromium runs SVG filters inside backdrop-filter (refraction).
  const nav = navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } };
  // userAgentData needs a secure context; plain-HTTP NAS access falls back to the UA string.
  const chromium = nav.userAgentData?.brands
    ? nav.userAgentData.brands.some((entry) => /Chromium/i.test(entry.brand))
    : /\bChrome\/\d+/.test(navigator.userAgent) && !/\b(CriOS|FxiOS|EdgiOS)\b/.test(navigator.userAgent);
  document.documentElement.dataset.engine = chromium ? "chromium" : "other";
  const idiom = window.matchMedia?.(MAC_IDIOM_QUERY);
  const onIdiom = () => {
    document.documentElement.dataset.idiom = idiom?.matches ? "mac" : "ios";
  };
  onIdiom();
  idiom?.addEventListener?.("change", onIdiom);
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const onMotion = () => applyAppearance(readAppearance());
  media?.addEventListener?.("change", onMotion);

  let frame = 0;
  let pending: PointerEvent | null = null;
  let lit: HTMLElement | null = null;
  const flush = () => {
    frame = 0;
    const event = pending;
    pending = null;
    if (!event || document.documentElement.dataset.highlight !== "dynamic") return;
    const target = (event.target as Element | null)?.closest?.(GLASS_SELECTOR) as HTMLElement | null;
    if (lit && lit !== target) {
      lit.style.removeProperty("--mx");
      lit.style.removeProperty("--my");
    }
    lit = target;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    target.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };
  const onPointer = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    pending = event;
    if (!frame) frame = requestAnimationFrame(flush);
  };
  document.addEventListener("pointermove", onPointer, { passive: true });

  // Interactive glass "illuminates from within as a form of feedback.
  // Starting right under your fingertips, the glow spreads throughout the
  // element" (WWDC25, Meet Liquid Glass). Light the spot where the press
  // landed; CSS swells touch-driven glass (glass.css .is-touched).
  let touched: HTMLElement | null = null;
  const release = () => {
    touched?.classList.remove("is-touched");
    touched = null;
  };
  const onDown = (event: PointerEvent) => {
    release();
    const target = (event.target as Element | null)?.closest?.(".glass-interactive") as HTMLElement | null;
    if (!target || (target as HTMLButtonElement).disabled) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    target.style.setProperty("--my", `${event.clientY - rect.top}px`);
    target.classList.add("is-touched");
    touched = target;
  };
  document.addEventListener("pointerdown", onDown, { passive: true });
  document.addEventListener("pointerup", release, { passive: true });
  document.addEventListener("pointercancel", release, { passive: true });
  // iOS Safari only applies :active when a touch listener exists.
  document.addEventListener("touchstart", () => {}, { passive: true });
  return () => {
    document.removeEventListener("pointerdown", onDown);
    document.removeEventListener("pointerup", release);
    document.removeEventListener("pointercancel", release);
    media?.removeEventListener?.("change", onMotion);
    idiom?.removeEventListener?.("change", onIdiom);
    document.removeEventListener("pointermove", onPointer);
    if (frame) cancelAnimationFrame(frame);
  };
}
