import { useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { PanelLeftRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { glassClass, useLift, useSlidingIndicator } from "../ios/core";
import { MORE_TAB, PRIMARY_NAV, isActive, type NavItem } from "./nav";

/**
 * iOS 27 floating tab bar: a Liquid Glass capsule at the bottom that stays
 * visible on every screen. The selection lens slides between tabs. It does
 * not minimize: HIG ties minimizing to a bottom accessory, which Halo has
 * none of.
 */
export function TabBar({ badges = {} }: { badges?: Record<string, number> }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const tabs: NavItem[] = [...PRIMARY_NAV, MORE_TAB];
  const active = tabs.findIndex((tab) => isActive(tab, pathname));
  const barRef = useRef<HTMLElement>(null);
  const lens = useSlidingIndicator(barRef, active);
  const moving = useLift(active, 360);
  return (
    <div className="ios-tabbar-wrap">
      <nav ref={barRef} aria-label={t("主导航")} className={cx("ios-tabbar", glassClass("regular"))}>
        <span className={cx("ios-tab-lens", moving && "is-moving")} style={lens} aria-hidden />
        {tabs.map((tab, index) => {
          const selected = index === active;
          // HIG: prefer filled symbols in tab bars.
          const Icon = tab.tabIcon ?? tab.activeIcon ?? tab.icon;
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

/**
 * iPadOS 26/27 tab bar near the top of the window (regular width), with
 * symbols and labels side by side and a leading button that converts it
 * back into the sidebar (sidebarAdaptable).
 */
export function TopTabBar({ items, onShowSidebar, badges = {} }: { items: NavItem[]; onShowSidebar: () => void; badges?: Record<string, number> }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const active = items.findIndex((tab) => isActive(tab, pathname));
  const barRef = useRef<HTMLElement>(null);
  const lens = useSlidingIndicator(barRef, active);
  const moving = useLift(active, 360);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-3">
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onShowSidebar}
          aria-label={t("显示侧栏")}
          title={t("显示侧栏")}
          className={cx("ios-bar-btn is-icon glass-interactive", glassClass("regular"))}
        >
          <PanelLeftRegular />
        </button>
        <nav ref={barRef} aria-label={t("主导航")} className={cx("relative flex h-11 items-center rounded-full p-1", glassClass("regular"))}>
          <span className={cx("ios-tab-lens !top-1 !bottom-1", moving && "is-moving")} style={lens} aria-hidden />
          {items.map((tab, index) => {
            const selected = index === active;
            const Icon = tab.activeIcon ?? tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                data-indicator-item
                aria-current={selected ? "page" : undefined}
                className={cx(
                  "relative z-[1] flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-semibold tracking-[-0.016em] transition-colors",
                  selected ? "text-accent" : "text-label",
                )}
              >
                <Icon className="h-[19px] w-[19px]" />
                <span>{tab.literal ? tab.label : t(tab.label)}</span>
                {badges[tab.to] ? <span className="ios-badge ml-0.5 !h-[18px] !min-w-[18px] !text-[11px]">{badges[tab.to]}</span> : null}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
