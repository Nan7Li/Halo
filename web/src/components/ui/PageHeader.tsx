import { createContext, useContext, type ReactNode } from "react";
import { cx } from "../../lib/utils";
import { useScrolledPast } from "../ios/core";

/** True when a page is rendered inside another page (Network's segments). */
export const EmbeddedPageContext = createContext(false);

/** Root of a screen built from <PageHeader>; a plain block when embedded. */
export function PageFrame({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  const embedded = useContext(EmbeddedPageContext);
  if (embedded) return <div className={cx("ios-push", className)}>{children}</div>;
  return <div className={cx("ios-content ios-page", wide && "is-wide", className)}>{children}</div>;
}

/**
 * Navigation bar + large title for screens composed with <PageFrame>.
 * The large title collapses into the glass bar while scrolling; actions
 * sit beside the title on wide screens and under it on phones.
 */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  const embedded = useContext(EmbeddedPageContext);
  const scrolled = useScrolledPast(40);
  if (embedded) {
    if (!subtitle && !actions) return null;
    return (
      <div className="mb-5 flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
        {subtitle ? <p className="min-w-0 ios-subhead text-label-2">{subtitle}</p> : <span />}
        {actions ? <div className="min-w-0 shrink-0">{actions}</div> : null}
      </div>
    );
  }
  return (
    <>
      <header className={cx("ios-navbar", scrolled && "is-scrolled")}>
        <div className="ios-navbar-bg glass-chrome" aria-hidden />
        <span />
        <div className="ios-navbar-title" aria-hidden={!scrolled}>{title}</div>
        <span />
      </header>
      <div className="mb-5 flex flex-col gap-3 px-1 pt-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="ios-large-title text-label">{title}</h1>
          {subtitle ? <p className="mt-1 ios-subhead text-label-2">{subtitle}</p> : null}
        </div>
        {actions ? <div className="min-w-0 shrink-0">{actions}</div> : null}
      </div>
    </>
  );
}
