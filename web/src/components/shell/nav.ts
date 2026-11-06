import {
  BoardRegular,
  BoardFilled,
  CallRegular,
  CallFilled,
  ChatRegular,
  ChatFilled,
  DocumentTextRegular,
  GlobeRegular,
  MoreHorizontalRegular,
  MoreHorizontalFilled,
  PuzzlePieceRegular,
  RouterRegular,
  RouterFilled,
  SendClockRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import type { FluentIcon } from "@fluentui/react-icons";
import type { InstalledPlugin } from "../../extensions";

export interface NavItem {
  to: string;
  label: string;
  /** Label already localized (plugins provide both languages). */
  literal?: boolean;
  icon: FluentIcon;
  activeIcon?: FluentIcon;
  /** iOS system color for the Settings-style icon tile. */
  tint: string;
  end?: boolean;
  /** Path prefixes that also select this item. */
  match?: string[];
}

export const PRIMARY_NAV: NavItem[] = [
  { to: "/", label: "概览", icon: BoardRegular, activeIcon: BoardFilled, tint: "blue", end: true },
  { to: "/phone", label: "电话", icon: CallRegular, activeIcon: CallFilled, tint: "green" },
  { to: "/sms", label: "信息", icon: ChatRegular, activeIcon: ChatFilled, tint: "green" },
  { to: "/devices", label: "设备", icon: RouterRegular, activeIcon: RouterFilled, tint: "gray" },
];

export const SECONDARY_NAV: NavItem[] = [
  { to: "/network", label: "网络", icon: GlobeRegular, tint: "blue", match: ["/network"] },
  { to: "/automatic-tasks", label: "自动任务", icon: SendClockRegular, tint: "orange" },
  { to: "/logs", label: "实时日志", icon: DocumentTextRegular, tint: "gray" },
  { to: "/settings", label: "设置", icon: SettingsRegular, tint: "gray", match: ["/settings"] },
];

export const MORE_TAB: NavItem = {
  to: "/more",
  label: "更多",
  icon: MoreHorizontalRegular,
  activeIcon: MoreHorizontalFilled,
  tint: "gray",
  match: ["/more", "/network", "/automatic-tasks", "/logs", "/settings", "/extensions"],
};

/** Sidebar contributions from enabled plugins. */
export function pluginNav(plugins: InstalledPlugin[], lang: string): NavItem[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      plugin.contributions
        .filter((contribution) => contribution.location === "sidebar")
        .map((contribution) => ({
          to: `/extensions/${encodeURIComponent(plugin.id)}/${encodeURIComponent(contribution.id)}`,
          label: lang === "zh" && contribution.labelZh ? contribution.labelZh : contribution.label,
          literal: true,
          icon: PuzzlePieceRegular,
          tint: "purple",
        })),
    );
}

export function isActive(item: NavItem, pathname: string) {
  if (item.end) return pathname === item.to;
  const prefixes = item.match ?? [item.to];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
