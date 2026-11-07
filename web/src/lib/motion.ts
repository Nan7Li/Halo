import { flushSync } from "react-dom";

export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  const pref = document.documentElement.dataset.motion;
  if (pref === "reduced" || pref === "off") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function motionOff() {
  return typeof document !== "undefined" && document.documentElement.dataset.motion === "off";
}

/**
 * Appearance changes (theme, accent, language). The system swaps these
 * with a short dissolve, never a slide.
 */
export function withViewTransition(update: () => void) {
  const start = document.startViewTransition?.bind(document);
  if (!start || motionOff()) {
    update();
    return;
  }
  start(() => {
    flushSync(update);
  });
}

/* ---------------------------------------------------------------------
 * Navigation stack transitions (UINavigationController push / pop).
 *
 * The incoming page slides in from the trailing edge over the outgoing
 * one, which moves a third of the way out (parallax) and dims. Pop is
 * the reverse. Only compact width has a navigation stack: on iPad and
 * Mac the same links switch the detail column of a split view, which
 * the system does without a slide. Reduce Motion turns the slide into a
 * dissolve, as the system does.
 * ------------------------------------------------------------------- */

export type NavDirection = "push" | "pop";

export const COMPACT_QUERY = "(max-width: 767px)";

function isCompact() {
  return typeof window !== "undefined" && window.matchMedia(COMPACT_QUERY).matches;
}

function depth(path: string) {
  return path.split("?")[0].split("#")[0].split("/").filter(Boolean).length;
}

/** push when `to` is deeper than `from`, pop when shallower, else none. */
export function directionFor(from: string, to: string): NavDirection | null {
  const a = depth(from);
  const b = depth(to);
  if (b > a) return "push";
  if (b < a) return "pop";
  return null;
}

/** Resolves after React has committed the update the caller just started. */
function nextCommit(timeout = 450) {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
      // Rendering (and so requestAnimationFrame) is paused while the
      // update callback runs; a task is enough for layout effects.
      window.setTimeout(resolve, 0);
    };
    const observer = new MutationObserver(finish);
    observer.observe(document.querySelector(".ios-scroll") ?? document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(finish, timeout);
  });
}

let running: ViewTransition | null = null;

export function navTransition(direction: NavDirection | null, update: () => void) {
  const start = document.startViewTransition?.bind(document);
  if (!direction || !start || motionOff() || !isCompact()) {
    update();
    return;
  }
  // A new navigation interrupts the one in flight instead of queueing,
  // so rapid back taps stay responsive.
  running?.skipTransition();
  const root = document.documentElement;
  root.dataset.nav = prefersReducedMotion() ? "fade" : direction;
  const transition = start(async () => {
    update();
    await nextCommit();
  });
  running = transition;
  transition.finished.finally(() => {
    if (running === transition) {
      running = null;
      delete root.dataset.nav;
    }
  });
}

if (typeof document !== "undefined" && "startViewTransition" in document) {
  document.documentElement.dataset.vt = "on";
}
