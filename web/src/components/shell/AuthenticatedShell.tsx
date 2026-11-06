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
import { TabBar } from "./TabBar";
import { pluginNav } from "./nav";
import { ShellContext } from "./ShellContext";
import { CallProvider } from "../phone/CallProvider";

const SIDEBAR_KEY = "halo.sidebar.collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Signed-in frame. Phones get the floating glass tab bar; iPad-width and
 * larger screens get the floating glass sidebar. Content scrolls inside
 * one container that pages, navigation bars and the tab bar observe.
 */
export function AuthenticatedShell({ isDark, onToggleTheme }: { isDark: boolean; onToggleTheme: () => void }) {
  const wide = useMediaQuery("(min-width: 768px)");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [developer, setDeveloper] = useState(false);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [tabBarHidden, setTabBarHidden] = useState(false);
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

  function toggleSidebar() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, value ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !value;
    });
  }

  const shell = useMemo(
    () => ({ developer, extensions, isDark, onToggleTheme, onLogout, setBadge: (path: string, count: number) => setBadges((current) => (current[path] === count ? current : { ...current, [path]: count })), setTabBarHidden }),
    // onLogout only closes over stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [developer, extensions, isDark, onToggleTheme],
  );

  return (
    <ShellContext.Provider value={shell}>
      <ScrollContainerContext.Provider value={scrollRef}>
        <CallProvider>
          <div className="ios-app">
            {wide ? <Sidebar collapsed={collapsed} onToggle={toggleSidebar} extensions={extensions} badges={badges} onLogout={onLogout} /> : null}
            <main ref={scrollRef} className="ios-scroll">
              <ErrorBoundary title={t("页面渲染失败")}>
                <div key={section} className="min-h-full">
                  <Outlet />
                </div>
              </ErrorBoundary>
            </main>
            {!wide && !tabBarHidden ? <TabBar badges={badges} /> : null}
          </div>
        </CallProvider>
      </ScrollContainerContext.Provider>
    </ShellContext.Provider>
  );
}
