import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRightRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { IconTile } from "./core";

/** Inset grouped section: header, rounded group, footer. */
export function ListSection({
  header,
  footer,
  prominent = false,
  children,
  className,
  bodyClassName,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  prominent?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("mb-7", className)}>
      {header ? <div className={cx("ios-list-header", prominent && "is-prominent")}>{header}</div> : null}
      <div className={cx("ios-list", bodyClassName)}>{children}</div>
      {footer ? <div className="ios-list-footer">{footer}</div> : null}
    </section>
  );
}

export interface SwipeAction {
  label: ReactNode;
  color?: string;
  onAction: () => void;
}

export interface ListRowProps {
  icon?: ReactNode;
  iconColor?: string;
  /** A custom leading element (avatar etc.) in place of an icon tile. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  detail?: ReactNode;
  accessory?: ReactNode;
  chevron?: boolean;
  to?: string;
  onClick?: () => void;
  destructive?: boolean;
  accent?: boolean;
  disabled?: boolean;
  swipeActions?: SwipeAction[];
  className?: string;
  titleClassName?: string;
  multiline?: boolean;
  [key: `data-${string}`]: string | undefined;
  onContextMenu?: React.MouseEventHandler;
  onPointerDown?: React.PointerEventHandler;
  onPointerUp?: React.PointerEventHandler;
  onPointerLeave?: React.PointerEventHandler;
  onPointerCancel?: React.PointerEventHandler;
  onPointerMove?: React.PointerEventHandler;
}

export function ListRow({
  icon,
  iconColor,
  leading,
  title,
  subtitle,
  detail,
  accessory,
  chevron,
  to,
  onClick,
  destructive,
  accent,
  disabled,
  swipeActions,
  className,
  titleClassName,
  multiline,
  ...events
}: ListRowProps) {
  const interactive = Boolean(to || onClick) && !disabled;
  const showChevron = chevron ?? Boolean(to);
  const content = (
    <>
      {leading ?? (icon ? <IconTile color={iconColor}>{icon}</IconTile> : null)}
      <span className="ios-row-body">
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              "block ios-body",
              !multiline && "truncate",
              destructive && "text-sys-red",
              accent && "text-accent",
              titleClassName,
            )}
          >
            {title}
          </span>
          {subtitle ? <span className={cx("mt-0.5 block ios-footnote text-label-2", !multiline && "truncate")}>{subtitle}</span> : null}
        </span>
        {detail !== undefined && detail !== null ? (
          <span className="max-w-[55%] shrink-0 truncate text-right ios-body text-label-2">{detail}</span>
        ) : null}
        {accessory}
        {showChevron ? <ChevronRightRegular className="ios-chevron" /> : null}
      </span>
    </>
  );
  const rowClass = cx("ios-row", interactive && "is-button", disabled && "opacity-50", className);
  let row: ReactNode;
  if (to && !disabled) {
    row = (
      <Link to={to} className={rowClass} {...events}>
        {content}
      </Link>
    );
  } else if (onClick && !disabled) {
    row = (
      <button type="button" onClick={onClick} className={rowClass} {...events}>
        {content}
      </button>
    );
  } else {
    row = (
      <div className={rowClass} {...events}>
        {content}
      </div>
    );
  }
  if (!swipeActions?.length) return row;
  return <SwipeRow actions={swipeActions}>{row}</SwipeRow>;
}

/** Trailing swipe actions, revealed by dragging left (touch or mouse). */
export function SwipeRow({ actions, children, background = "rgb(var(--ios-grouped-2))" }: { actions: SwipeAction[]; children: ReactNode; background?: string }) {
  const width = actions.length * 80;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; locked: boolean | null } | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    start.current = { x: event.clientX, y: event.clientY, base: offset, locked: null };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const origin = start.current;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (origin.locked === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      origin.locked = Math.abs(dx) > Math.abs(dy);
      if (origin.locked) {
        setDragging(true);
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }
    }
    if (!origin.locked) return;
    let next = origin.base + dx;
    // Rubber band past the actions.
    if (next < -width) next = -width + (next + width) * 0.25;
    if (next > 0) next *= 0.25;
    setOffset(next);
  };
  const onPointerUp = () => {
    const origin = start.current;
    start.current = null;
    if (!origin?.locked) return;
    setDragging(false);
    setOffset((current) => (current < -width / 2 ? -width : 0));
  };
  const close = () => setOffset(0);

  return (
    <div className="ios-row-wrap">
      <div className="ios-swipe-actions" style={{ width }} aria-hidden={offset === 0}>
        {actions.map((action, index) => (
          <button
            key={index}
            type="button"
            tabIndex={offset === 0 ? -1 : 0}
            className="ios-swipe-action flex-1"
            style={{ background: action.color ? `rgb(var(--ios-${action.color}))` : "rgb(var(--ios-red))" }}
            onClick={() => {
              close();
              action.onAction();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(event) => {
          if (offset !== 0) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        style={{
          transform: `translate3d(${offset}px, 0, 0)`,
          transition: dragging ? "none" : "transform var(--dur-spring-snappy) var(--spring-snappy)",
          touchAction: "pan-y",
          position: "relative",
          background,
        }}
      >
        {children}
      </div>
    </div>
  );
}
