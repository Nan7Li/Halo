import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../store/auth";
import { useI18n } from "../../lib/i18n";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { confirmDialog } from "../ui/MessageBox";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { ScrollContainerContext } from "../ios/core";
import { listPlugins, type InstalledPlugin } from "../../extensions";
import { api } from "../../api";
import type { SystemInfo } from "../../types";
import { Sidebar } from "./Sidebar";
import { TabBar, TopTabBar } from "./TabBar";
import { PRIMARY_NAV, SECONDARY_NAV, pluginNav } from "./nav";
import { cx } from "../../lib/utils";
import { ShellContext } from "./ShellContext";
import { CallProvider } from "../phone/CallProvider";
import { GlassFilters } from "../ios/GlassFilters";

const SIDEBAR_KEY = "halo.navigation";

type WideNavigation = "sidebar" | "tabbar";

function readWideNavigation(): WideNavigation {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "tabbar" ? "tabbar" : "sidebar";
  } catch {
    return "sidebar";
  }
}

/**
 * Signed-in frame. Phones get the floating glass tab bar; iPad-width and
 * larger screens get the floating glass sidebar. Content scrolls inside
 * one container that pages, navigation bars and the tab bar observe.
 */
export function AuthenticatedShell({ isDark, onToggleTheme }: { isDark: boolean; onToggleTheme: () => void }) {
  const wide = useMediaQuery("(min-width: 768px)");
  const [wideNav, setWideNav] = useState<WideNavigation>(readWideNavigation);
  // The navigation being switched away from stays mounted while it plays its
  // exit; the incoming one plays its entrance only after a switch.
  const [leaving, setLeaving] = useState<WideNavigation | null>(null);
  const [switched, setSwitched] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    // Fallback for when animationend never fires (hidden tab, motion off).
    const timer = window.setTimeout(() => setLeaving(null), 900);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [developer, setDeveloper] = useState(false);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const { logout } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api<SystemInfo>("/system/info")
        .then((info) => active && setDeveloper(!!info.developer))
        .catch(() => active && setDeveloper(false));
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = () =>
      listPlugins()
        .then((items) => active && setPlugins(items || []))
        .catch(() => undefined);
    void load();
    window.addEventListener("vocat:plugins-changed", load);
    return () => {
      active = false;
      window.removeEventListener("vocat:plugins-changed", load);
    };
  }, []);

  // New screens start at the top, like a pushed view controller.
  const section = location.pathname.split("/")[1] || "home";
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  const extensions = useMemo(() => pluginNav(plugins, lang), [plugins, lang]);

  async function onLogout() {
    const ok = await confirmDialog(t("确认退出登录？"), t("退出登录"), {
      confirmText: t("退出"),
      cancelText: t("取消"),
      type: "danger",
    });
    if (ok) {
      await logout();
      navigate("/login");
    }
  }

  // sidebarAdaptable: people switch between the sidebar and a top tab bar.
  function setNavigation(next: WideNavigation) {
    try {
      localStorage.setItem(SIDEBAR_KEY, next);
    } catch {
      /* ignore */
    }
    if (next === wideNav) return;
    const motion = document.documentElement.dataset.motion;
    const still = motion === "reduced" || motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setLeaving(still ? null : wideNav);
    setSwitched(!still);
    setWideNav(next);
  }
  const endLeave = (name: string) => (event: React.AnimationEvent) => {
    if (event.target === event.currentTarget && event.animationName === name) setLeaving(null);
  };

  const shell = useMemo(
    () => ({ developer, extensions, isDark, onToggleTheme, onLogout, setBadge: (path: string, count: number) => setBadges((current) => (current[path] === count ? current : { ...current, [path]: count })) }),
    // onLogout only closes over stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [developer, extensions, isDark, onToggleTheme],
  );

  return (
    <ShellContext.Provider value={shell}>
      <ScrollContainerContext.Provider value={scrollRef}>
        <CallProvider>
          <GlassFilters />
          <div className="ios-app">
            {wide && (wideNav === "sidebar" || leaving === "sidebar") ? (
              <Sidebar
                onHide={() => setNavigation("tabbar")}
                extensions={extensions}
                badges={badges}
                onLogout={onLogout}
                className={leaving === "sidebar" ? "is-leaving" : switched ? "is-entering" : undefined}
                onAnimationEnd={leaving === "sidebar" ? endLeave("ios-sidebar-out") : undefined}
              />
            ) : null}
            {wide && (wideNav === "tabbar" || leaving === "tabbar") ? (
              <TopTabBar
                items={[...PRIMARY_NAV, SECONDARY_NAV[0], SECONDARY_NAV[3]]}
                badges={badges}
                onShowSidebar={() => setNavigation("sidebar")}
                className={leaving === "tabbar" ? "is-leaving" : switched ? "is-entering" : undefined}
                onAnimationEnd={leaving === "tabbar" ? endLeave("ios-toptabs-out") : undefined}
              />
            ) : null}
            <main ref={scrollRef} className={cx("ios-scroll", wide && wideNav === "tabbar" && "has-top-tabbar")}>
              <ErrorBoundary title={t("页面渲染失败")}>
                <div key={section} className="min-h-full">
                  <Outlet />
                </div>
              </ErrorBoundary>
            </main>
            {!wide ? <TabBar badges={badges} /> : null}
          </div>
        </CallProvider>
      </ScrollContainerContext.Provider>
    </ShellContext.Provider>
  );
}
