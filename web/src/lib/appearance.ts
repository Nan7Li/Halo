import { useCallback, useEffect, useState } from "react";
import {
  APPEARANCE_KEY,
  appearanceAttributes,
  parseStoredAppearance,
  type Appearance,
} from "./appearanceModel";

export * from "./appearanceModel";

const CHANGE_EVENT = "halo:appearance";

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

const GLASS_SELECTOR = ".glass, .glass-thick, .glass-tinted";

/**
 * Starts global listeners: the OS reduced-motion setting, and the
 * pointer-following specular highlight. Returns a cleanup function.
 */
export function installAppearanceRuntime() {
  applyAppearance(readAppearance());
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
  return () => {
    media?.removeEventListener?.("change", onMotion);
    document.removeEventListener("pointermove", onPointer);
    if (frame) cancelAnimationFrame(frame);
  };
}
