import { useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { PanelLeftRegular, SignOutRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../store/auth";
import { glassClass, useSelectionHighlight } from "../ios/core";
import { BrandLogo } from "./BrandLogo";
import { VersionBadge } from "./VersionBadge";
import { ProfileSheet, UserAvatar } from "./UserAvatar";
import { ANDROID_NAV, PRIMARY_NAV, SECONDARY_NAV, isActive, type NavItem } from "./nav";
import { AIRSIM_LINE_ID } from "../phone/airsim";
import { useCalls } from "../phone/CallProvider";
import { deviceStatusMeta, isVoWiFiInUse } from "../devices/shared";

const DOT: Record<string, string> = { success: "bg-sys-green", warning: "bg-sys-orange", danger: "bg-label-4" };

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
  const { pathname, search } = useLocation();
  const { lines, airsim } = useCalls();
  const openDevice = pathname.startsWith("/devices") ? new URLSearchParams(search).get("device") : null;
  const navRef = useRef<HTMLElement>(null);
  const [profile, setProfile] = useState(false);
  // The selection springs from row to row instead of jumping.
  const highlight = useSelectionHighlight(navRef, ".ios-sidebar-item.is-active", `${pathname}?${search}|${lines.length}|${extensions.length}`);

  const renderItem = (item: NavItem) => {
    const label = item.literal ? item.label : t(item.label);
    const selected = isActive(item, pathname);
    const Icon = selected && item.activeIcon ? item.activeIcon : item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
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
    <aside className={cx("ios-sidebar", glassClass("thick"))} aria-label={t("主导航")}>
      <div className="ios-sidebar-top flex h-[60px] shrink-0 items-center gap-2.5 px-4">
        <BrandLogo className="h-7 w-7 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="ios-headline leading-none text-label">Halo</div>
          <div className="mt-1 ios-caption-2 text-label-2">{t("基于 VoCat")}</div>
        </div>
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

      <nav ref={navRef} className="ios-sidebar-nav relative min-h-0 flex-1 overflow-y-auto pb-3">
        <span className="ios-select-highlight ios-sidebar-highlight" style={highlight} aria-hidden />
        {PRIMARY_NAV.map(renderItem)}
        {/* Like Finder's Locations: every module with its live state. */}
        <div className="ios-sidebar-heading">{t("设备")}</div>
        {lines.map((device) => {
              if (device.id === AIRSIM_LINE_ID) {
                const online = airsim?.state === "online";
                return (
                  <NavLink
                    key={device.id}
                    to={ANDROID_NAV.to}
                    className={cx("ios-sidebar-item", pathname === ANDROID_NAV.to && "is-active")}
                    title={`${device.name} · ${t(online ? "在线" : "离线")}`}
                  >
                    <span className="ios-sidebar-icon items-center justify-center">
                      <span className={cx("h-2 w-2 rounded-full", online ? "bg-sys-green" : "bg-label-4")} />
                    </span>
                    <span className="ios-sidebar-label min-w-0 flex-1 truncate">{device.name}</span>
                    <span className="ios-sidebar-label shrink-0 ios-caption text-label-3">{t("安卓")}</span>
                  </NavLink>
                );
              }
              const meta = deviceStatusMeta(device);
              return (
                <NavLink
                  key={device.id}
                  to={`/devices?device=${encodeURIComponent(device.id)}&tab=overview`}
                  className={cx("ios-sidebar-item", openDevice === device.id && "is-active")}
                  title={`${device.name || device.id} · ${meta.label}`}
                >
                  <span className="ios-sidebar-icon items-center justify-center">
                    <span className={cx("h-2 w-2 rounded-full", DOT[meta.tone] ?? "bg-label-4")} />
                  </span>
                  <span className="ios-sidebar-label min-w-0 flex-1 truncate">{device.name || device.id}</span>
                  <span className="ios-sidebar-label shrink-0 ios-caption text-label-3">
                    {isVoWiFiInUse(device) ? "Wi-Fi" : device.modem?.networkMode || ""}
                  </span>
                </NavLink>
              );
            })}
        {airsim?.paired ? null : renderItem(ANDROID_NAV)}
        <div className="ios-sidebar-heading">{t("网络与自动化")}</div>
        {SECONDARY_NAV.slice(0, 2).map(renderItem)}
        {extensions.length ? <div className="ios-sidebar-heading">{t("扩展")}</div> : null}
        {extensions.map(renderItem)}
        <div className="ios-sidebar-heading">{t("系统")}</div>
        {SECONDARY_NAV.slice(2).map(renderItem)}
      </nav>

      <div className="shrink-0 border-t border-separator/50 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" onClick={() => setProfile(true)} aria-label={t("个人资料")} className="ios-press shrink-0 rounded-full">
            <UserAvatar className="h-9 w-9 text-[15px]" />
          </button>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => setProfile(true)} className="ios-press block max-w-full truncate text-left ios-subhead font-semibold text-label">
              {user?.username || "Admin"}
            </button>
            <VersionBadge compact />
          </div>
          <button type="button" onClick={onLogout} aria-label={t("退出登录")} title={t("退出登录")} className="ios-press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-label-2 transition-colors hover:bg-sys-red/10 hover:text-sys-red">
            <SignOutRegular className="h-5 w-5" />
          </button>
        </div>
      </div>
      <ProfileSheet open={profile} onClose={() => setProfile(false)} />
    </aside>
  );
}
