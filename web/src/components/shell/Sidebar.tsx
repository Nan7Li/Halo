import { NavLink, useLocation } from "react-router-dom";
import { PanelLeftRegular, SignOutRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../store/auth";
import { glassClass } from "../ios/core";
import { BrandLogo } from "./BrandLogo";
import { VersionBadge } from "./VersionBadge";
import { PRIMARY_NAV, SECONDARY_NAV, isActive, type NavItem } from "./nav";

/**
 * iPadOS 27 floating glass sidebar (the regular, more opaque variant). Its
 * leading button converts it into the top tab bar (sidebarAdaptable).
 */
export function Sidebar({
  onHide,
  extensions,
  badges = {},
  onLogout,
}: {
  onHide: () => void;
  extensions: NavItem[];
  badges?: Record<string, number>;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const collapsed = false;

  const renderItem = (item: NavItem) => {
    const label = item.literal ? item.label : t(item.label);
    const selected = isActive(item, pathname);
    const Icon = selected && item.activeIcon ? item.activeIcon : item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        title={collapsed ? label : undefined}
        className={cx("ios-sidebar-item", selected && "is-active")}
      >
        <span className="ios-sidebar-icon">
          <Icon />
        </span>
        <span className="ios-sidebar-label min-w-0 flex-1 truncate">{label}</span>
        {badges[item.to] ? <span className="ios-sidebar-label ios-badge">{badges[item.to]}</span> : null}
      </NavLink>
    );
  };

  return (
    <aside className={cx("ios-sidebar", glassClass("thick"), collapsed && "is-collapsed")} aria-label={t("主导航")}>
      <div className={cx("flex h-[60px] shrink-0 items-center gap-2.5", collapsed ? "justify-center px-0" : "px-4")}>
        {!collapsed ? (
          <>
            <BrandLogo className="h-7 w-7 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="ios-headline leading-none text-label">Halo</div>
              <div className="mt-1 ios-caption-2 text-label-2">{t("基于 VoCat")}</div>
            </div>
          </>
        ) : null}
        <button
          type="button"
          onClick={onHide}
          aria-label={t("隐藏侧栏")}
          title={t("隐藏侧栏")}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-label-2 transition-colors hover:bg-fill-3 hover:text-label"
        >
          <PanelLeftRegular className="h-[22px] w-[22px]" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pb-3">
        {PRIMARY_NAV.map(renderItem)}
        <div className="ios-sidebar-heading">{t("网络与自动化")}</div>
        {SECONDARY_NAV.slice(0, 2).map(renderItem)}
        {extensions.length ? <div className="ios-sidebar-heading">{t("扩展")}</div> : null}
        {extensions.map(renderItem)}
        <div className="ios-sidebar-heading">{t("系统")}</div>
        {SECONDARY_NAV.slice(2).map(renderItem)}
      </nav>

      <div className={cx("shrink-0 border-t border-separator/50 p-3", collapsed && "flex justify-center")}>
        {collapsed ? (
          <button type="button" onClick={onLogout} aria-label={t("退出登录")} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-label-2 hover:bg-fill-3 hover:text-sys-red">
            <SignOutRegular className="h-5 w-5" />
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="ios-avatar h-9 w-9 text-[15px]">{(user?.username || "A").slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate ios-subhead font-semibold text-label">{user?.username || "Admin"}</div>
              <VersionBadge compact />
            </div>
            <button type="button" onClick={onLogout} aria-label={t("退出登录")} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-label-2 transition-colors hover:bg-sys-red/10 hover:text-sys-red">
              <SignOutRegular className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
