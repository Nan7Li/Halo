import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DismissRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

const CLOSE_MS = 260;

/**
 * iOS sheet: slides up from the bottom on phones (drag the grabber or the
 * header down to dismiss) and scales in as a centered card on wider screens.
 */
export function Sheet({
  open,
  onClose,
  title,
  leading,
  trailing,
  children,
  footer,
  width = "md:max-w-[560px]",
  dismissible = true,
  solid = false,
  className,
  bodyClassName,
  showClose = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  dismissible?: boolean;
  solid?: boolean;
  className?: string;
  bodyClassName?: string;
  showClose?: boolean;
}) {
  const { t } = useI18n();
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      setDrag(0);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  const requestClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, requestClose]);

  useEffect(() => {
    if (open) sheetRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!mounted) return null;

  const onDragStart = (event: React.PointerEvent) => {
    if (!dismissible || window.matchMedia("(min-width: 768px)").matches) return;
    dragStart.current = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: React.PointerEvent) => {
    if (dragStart.current === null) return;
    const delta = event.clientY - dragStart.current;
    setDrag(delta > 0 ? delta : delta * 0.15);
  };
  const onDragEnd = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (drag > 110) onClose();
    else setDrag(0);
  };

  const hasHeader = title || leading || trailing || showClose;
  return createPortal(
    <div className={cx("ios-sheet-root", closing && "is-closing")} role="presentation">
      <button type="button" aria-label={t("关闭")} className="ios-sheet-scrim glass-scrim" onClick={requestClose} tabIndex={-1} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cx("ios-sheet outline-none", solid ? "is-solid" : "glass-thick", width, className)}
        style={drag ? { transform: `translate3d(0, ${drag}px, 0)`, transition: dragStart.current === null ? "transform 300ms var(--spring-snappy)" : "none" } : undefined}
      >
        <div onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} className="shrink-0 touch-none">
          <div className="ios-sheet-grabber" />
          {hasHeader ? (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pb-2 pt-3">
              <div className="flex min-w-0 justify-start">{leading}</div>
              <div className="min-w-0 truncate text-center ios-headline">{title}</div>
              <div className="flex min-w-0 justify-end">
                {trailing ??
                  (showClose ? (
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label={t("关闭")}
                      className="glass glass-interactive inline-flex h-9 w-9 items-center justify-center rounded-full text-label-2"
                    >
                      <DismissRegular className="h-[18px] w-[18px]" />
                    </button>
                  ) : null)}
              </div>
            </div>
          ) : null}
        </div>
        <div className={cx("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5", !hasHeader && "pt-5", bodyClassName)}>{children}</div>
        {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 px-5 pb-5 pt-1">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** Context menu anchored at a point (long press / right click) or an element. */
export function ContextMenu({
  open,
  onClose,
  anchor,
  items,
  title,
}: {
  open: boolean;
  onClose: () => void;
  anchor: { x: number; y: number } | null;
  items: MenuItem[];
  title?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, anchor.x - rect.width + 24), window.innerWidth - rect.width - 8);
    const top = anchor.y + rect.height + 8 > window.innerHeight ? Math.max(8, anchor.y - rect.height - 8) : anchor.y + 8;
    setPosition({ left, top });
  }, [open, anchor]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !anchor) return null;
  return createPortal(
    <div className="fixed inset-0 z-[4100]" onPointerDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }}>
      <div
        ref={ref}
        role="menu"
        className="ios-menu glass-thick fixed"
        style={position ?? { left: anchor.x, top: anchor.y, visibility: "hidden" }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {title ? <div className="px-4 pb-1.5 pt-2.5 ios-footnote text-label-2">{title}</div> : null}
        {items.map((item, index) => (
          <button
            key={index}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={cx("ios-menu-item", item.destructive && "is-destructive", item.disabled && "opacity-40")}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.icon ? <span className="inline-flex text-[18px]">{item.icon}</span> : null}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
