import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useCallback } from "react";
import { useLocation, useNavigate, type To } from "react-router-dom";
import { ChevronLeftRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { useScrolledPast } from "./core";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { MAC_IDIOM_QUERY } from "../../lib/appearance";
import { directionFor, navTransition, type NavDirection } from "../../lib/motion";

/**
 * navigate() with the navigation-stack slide on compact width. The
 * direction follows path depth unless given (see lib/motion.ts).
 */
export function useStackNavigate() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (to: To | number, direction?: NavDirection | null) => {
      const target = typeof to === "number" ? null : typeof to === "string" ? to : to.pathname ?? location.pathname;
      const dir = direction !== undefined ? direction : typeof to === "number" ? (to < 0 ? "pop" : "push") : directionFor(location.pathname, target ?? "");
      navTransition(dir, () => (typeof to === "number" ? navigate(to) : navigate(to)));
    },
    [navigate, location.pathname],
  );
}

/** macOS idiom: fine pointer on a wide window (see styles/mac.css). */
export function useIsMac() {
  return useMediaQuery(MAC_IDIOM_QUERY);
}

/**
 * A screen: floating glass navigation bar, large title that collapses into
 * the bar on scroll, optional accessory row (search, segmented control).
 */
export function Page({
  title,
  subtitle,
  leading,
  trailing,
  accessory,
  children,
  largeTitle = true,
  wide = false,
  className,
  contentClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  largeTitle?: boolean;
  wide?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  // Titles sit in the bar: centered on iOS (as iOS 26 apps like Phone's
  // Keypad and Telegram do), at the leading edge of the macOS toolbar.
  // Large titles took a whole row and left screens feeling empty.
  void useIsMac();
  largeTitle = false;
  const scrolled = useScrolledPast(largeTitle ? 40 : 4);
  return (
    <div className={cx("ios-content ios-page", wide && "is-wide", className)}>
      <header className={cx("ios-navbar", scrolled && "is-scrolled", !largeTitle && "is-inline")}>
        <div className="ios-navbar-bg glass-chrome" aria-hidden />
        <div className="flex min-w-0 items-center justify-start gap-2">{leading}</div>
        <div className="ios-navbar-title" aria-hidden={largeTitle && !scrolled}>{title}</div>
        <div className="flex min-w-0 items-center justify-end gap-2">{trailing}</div>
      </header>
      {largeTitle ? (
        <div className="px-1 pb-3 pt-1">
          <h1 className="ios-large-title text-label">{title}</h1>
          {subtitle ? <p className="mt-1 ios-subhead text-label-2">{subtitle}</p> : null}
        </div>
      ) : subtitle ? (
        <p className="px-1 pb-3 ios-subhead text-label-2">{subtitle}</p>
      ) : null}
      {accessory ? <div className="pb-4">{accessory}</div> : null}
      <div className={contentClassName}>{children}</div>
    </div>
  );
}

type BarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  label?: ReactNode;
  accent?: boolean;
  prominent?: boolean;
};

/**
 * Floating glass toolbar button (symbol, label, or both). Symbols stay
 * monochrome; `prominent` tints the background with the accent color and
 * is reserved for the one primary action (HIG Toolbars, Liquid Glass color).
 */
export const BarButton = forwardRef<HTMLButtonElement, BarButtonProps>(function BarButton(
  { icon, label, accent, prominent, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "ios-bar-btn glass-interactive disabled:opacity-40",
        prominent ? "glass-tinted" : "glass",
        !label && "is-icon",
        className,
      )}
      {...rest}
    >
      {icon}
      {label ? <span>{label}</span> : null}
    </button>
  );
});

/** Standard Back: the chevron symbol only, no "Back" text (HIG Toolbars). */
export function BackButton({ to, label, onBack }: { to?: string; label?: ReactNode; onBack?: () => void }) {
  const navigate = useStackNavigate();
  const { t } = useI18n();
  return (
    <BarButton
      icon={<ChevronLeftRegular />}
      aria-label={typeof label === "string" ? `${t("返回")} ${label}` : t("返回")}
      onClick={() => (onBack ? navTransition("pop", onBack) : to ? navigate(to, "pop") : navigate(-1, "pop"))}
    />
  );
}

/** Adjacent symbol buttons share one glass capsule, like iOS 26 bar item groups. */
export function BarGroup({ children }: { children: ReactNode }) {
  return <div className="ios-bar-group glass">{children}</div>;
}

/** A symbol button inside a BarGroup (no glass of its own). */
export function GroupButton({ icon, className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode }) {
  return (
    <button type={type} className={cx("ios-bar-btn is-icon rounded-full transition-colors hover:bg-fill-4 active:bg-fill-3 disabled:opacity-40", className)} {...rest}>
      {icon}
    </button>
  );
}

/** Empty state in iOS style: large glyph, title, description, action. */
export function ContentUnavailable({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon ? <div className="mb-3 text-[48px] text-label-3 [&_svg]:h-12 [&_svg]:w-12">{icon}</div> : null}
      <div className="ios-title-3 text-label">{title}</div>
      {description ? <div className="mt-1.5 max-w-sm ios-subhead text-label-2">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
