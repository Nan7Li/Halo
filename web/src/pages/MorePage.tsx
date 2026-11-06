import {
  ArrowDownloadRegular,
  LocalLanguageRegular,
  SignOutRegular,
  WeatherMoonRegular,
} from "@fluentui/react-icons";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../store/auth";
import { IOSSwitch, ListRow, ListSection, Page } from "../components/ios";
import { useShell } from "../components/shell/ShellContext";
import { SECONDARY_NAV } from "../components/shell/nav";

/** Phone-only: the destinations that do not fit in the tab bar. */
export default function MorePage() {
  const { t, lang, setLanguage } = useI18n();
  const { user } = useAuth();
  const { extensions, isDark, onToggleTheme, onLogout } = useShell();
  return (
    <Page title={t("更多")}>
      <ListSection>
        <ListRow
          leading={<span className="ios-avatar h-[52px] w-[52px] text-[22px]">{(user?.username || "A").slice(0, 1).toUpperCase()}</span>}
          title={<span className="ios-title-3">{user?.username || "Admin"}</span>}
          subtitle={user?.role || t("管理员")}
          to="/settings/system"
        />
      </ListSection>
      <ListSection>
        {SECONDARY_NAV.map((item) => {
          const Icon = item.icon;
          return <ListRow key={item.to} to={item.to} icon={<Icon />} iconColor={item.tint} title={t(item.label)} />;
        })}
      </ListSection>
      {extensions.length ? (
        <ListSection header={t("扩展")}>
          {extensions.map((item) => {
            const Icon = item.icon;
            return <ListRow key={item.to} to={item.to} icon={<Icon />} iconColor={item.tint} title={item.label} />;
          })}
        </ListSection>
      ) : null}
      <ListSection>
        <ListRow icon={<WeatherMoonRegular />} iconColor="indigo" title={t("深色模式")} accessory={<IOSSwitch checked={isDark} onChange={onToggleTheme} ariaLabel={t("深色模式")} />} />
        <ListRow
          icon={<LocalLanguageRegular />}
          iconColor="blue"
          title={t("语言")}
          detail={lang === "zh" ? "简体中文" : "English"}
          onClick={() => setLanguage(lang === "zh" ? "en" : "zh")}
        />
        <ListRow
          icon={<ArrowDownloadRegular />}
          iconColor="teal"
          title={t("下载脱敏诊断包")}
          onClick={() => window.open("/api/system/diagnostics", "_blank", "noopener,noreferrer")}
        />
      </ListSection>
      <ListSection>
        <ListRow icon={<SignOutRegular />} iconColor="red" title={t("退出登录")} destructive onClick={onLogout} />
      </ListSection>
    </Page>
  );
}
