import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { glassClass, useScrollContainer, useSlidingIndicator } from "../ios/core";
import { MORE_TAB, PRIMARY_NAV, isActive, type NavItem } from "./nav";

/**
 * iOS 27 floating tab bar. A glass capsule whose selection lens slides and
 * stretches between tabs; scrolling down minimizes it to the active tab,
 * scrolling up restores it.
 */
export function TabBar({ badges = {} }: { badges?: Record<string, number> }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const tabs: NavItem[] = [...PRIMARY_NAV, MORE_TAB];
  const active = tabs.findIndex((tab) => isActive(tab, pathname));
  const barRef = useRef<HTMLElement>(null);
  const lens = useSlidingIndicator(barRef, active);
  const minimized = useMinimizeOnScroll();

  return (
    <div className={cx("ios-tabbar-wrap", minimized && "is-minimized")}>
      <nav ref={barRef} aria-label={t("主导航")} className={cx("ios-tabbar", glassClass("regular"))}>
        <span className="ios-tab-lens" style={lens} aria-hidden />
        {tabs.map((tab, index) => {
          const selected = index === active;
          const Icon = selected && tab.activeIcon ? tab.activeIcon : tab.icon;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              data-indicator-item
              aria-current={selected ? "page" : undefined}
              className={cx("ios-tab", selected && "is-active")}
            >
              <Icon />
              <span>{t(tab.label)}</span>
              {badges[tab.to] ? <span className="ios-tab-badge">{badges[tab.to] > 99 ? "99+" : badges[tab.to]}</span> : null}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

function useMinimizeOnScroll() {
  const container = useScrollContainer();
  const { pathname } = useLocation();
  const [minimized, setMinimized] = useState(false);
  useEffect(() => setMinimized(false), [pathname]);
  useEffect(() => {
    const element = container?.current;
    if (!element) return;
    let last = element.scrollTop;
    const onScroll = () => {
      const top = element.scrollTop;
      const delta = top - last;
      if (Math.abs(delta) < 8) return;
      // Near the top, or at the bottom where the bar would hide content, stay expanded.
      const atEnd = top + element.clientHeight >= element.scrollHeight - 4;
      setMinimized(delta > 0 && top > 120 && !atEnd);
      last = top;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [container]);
  return minimized;
}
