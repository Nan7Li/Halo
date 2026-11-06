import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { cx } from "../../lib/utils";

export type GlassVariant = "regular" | "thick" | "chrome" | "tinted";

const GLASS_CLASS: Record<GlassVariant, string> = {
  regular: "glass",
  thick: "glass-thick",
  chrome: "glass-chrome",
  tinted: "glass-tinted",
};

export function glassClass(variant: GlassVariant = "regular", interactive = false) {
  return cx(GLASS_CLASS[variant], interactive && "glass-interactive");
}

type GlassProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  variant?: GlassVariant;
  interactive?: boolean;
  [key: string]: unknown;
};

/** A Liquid Glass surface. Use only for controls and navigation chrome. */
export function Glass({ as: Tag = "div", variant = "regular", interactive = false, className, ...rest }: GlassProps) {
  return <Tag className={cx(glassClass(variant, interactive), className)} {...rest} />;
}

/** Settings-style rounded square icon. `color` is an iOS system color name or CSS color. */
export function IconTile({ color = "blue", children, size = 30, className }: { color?: string; children: ReactNode; size?: number; className?: string }) {
  const background = /^(#|rgb|var|hsl)/.test(color) ? color : `rgb(var(--ios-${color}))`;
  return (
    <span className={cx("ios-row-icon", className)} style={size === 30 ? { backgroundColor: background } : { backgroundColor: background, width: size, height: size, borderRadius: size * 0.24 }}>
      {children}
    </span>
  );
}

export function Badge({ count, className }: { count: number; className?: string }) {
  if (!count) return null;
  return <span className={cx("ios-badge", className)}>{count > 99 ? "99+" : count}</span>;
}

/* ---- Scroll container shared by the shell, navigation bars and the tab bar ---- */

export const ScrollContainerContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useScrollContainer() {
  return useContext(ScrollContainerContext);
}

/** True once the shell's scroll container has scrolled past `threshold`. */
export function useScrolledPast(threshold = 24) {
  const container = useScrollContainer();
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    // Listen in the capture phase at the document so it works no matter
    // when the scroll container mounts (lazy routes, Suspense reveals).
    const read = (element: Element | null) => setScrolled(Boolean(element && element.scrollTop > threshold));
    read(container?.current ?? document.querySelector(".ios-scroll"));
    const onScroll = (event: Event) => {
      const target = event.target as Element | null;
      if (target instanceof Element && target.classList.contains("ios-scroll")) read(target);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [container, threshold]);
  return scrolled;
}

/**
 * Positions a sliding indicator under the active child of `containerRef`.
 * Children marked with data-indicator-item are measured; the indicator
 * animates between them with the CSS spring on transform/width.
 */
export function useSlidingIndicator(containerRef: RefObject<HTMLElement | null>, activeIndex: number) {
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  const first = useRef(true);
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = container.querySelectorAll<HTMLElement>("[data-indicator-item]");
    const target = items[activeIndex];
    if (!target) {
      setStyle({ opacity: 0 });
      return;
    }
    const next: CSSProperties = {
      width: target.offsetWidth,
      transform: `translateX(${target.offsetLeft}px)`,
      opacity: 1,
    };
    if (first.current) {
      // No slide on first paint.
      next.transition = "none";
      first.current = false;
      requestAnimationFrame(() => setStyle((current) => ({ ...current, transition: undefined })));
    }
    setStyle(next);
  }, [containerRef, activeIndex]);
  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure, containerRef]);
  return style;
}

/** Long press (touch) or context menu (mouse) handler. */
export function useLongPress(onLongPress: (event: { clientX: number; clientY: number }) => void, delay = 480) {
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);
  const clear = () => window.clearTimeout(timer.current);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") return;
      fired.current = false;
      const { clientX, clientY } = event;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(8);
        onLongPress({ clientX, clientY });
      }, delay);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onPointerMove: (event: React.PointerEvent) => {
      if (Math.abs(event.movementX) + Math.abs(event.movementY) > 6) clear();
    },
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      clear();
      onLongPress({ clientX: event.clientX, clientY: event.clientY });
    },
    /** True if the click that follows was part of a long press and should be ignored. */
    consumeClick: () => {
      const value = fired.current;
      fired.current = false;
      return value;
    },
  };
}
