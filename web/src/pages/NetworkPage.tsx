import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { EmbeddedPageContext } from "../components/ui/PageHeader";
import { BackButton, Page, SegmentedControl } from "../components/ios";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useShell } from "../components/shell/ShellContext";
import ProxyPage from "./ProxyPage";
import WireGuardPage from "./WireGuardPage";
import ExportProxyPage from "./ExportProxyPage";

type Section = "proxy" | "wireguard" | "export";

/** Proxy routing, WireGuard tunnels and (developer) export proxies in one screen. */
export default function NetworkPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { section = "proxy" } = useParams();
  const { developer } = useShell();
  const phone = !useMediaQuery("(min-width: 768px)");
  const sections: { value: Section; label: string }[] = [
    { value: "proxy", label: t("代理") },
    { value: "wireguard", label: "WireGuard" },
    ...(developer ? [{ value: "export" as const, label: t("导出代理") }] : []),
  ];
  if (!["proxy", "wireguard", "export"].includes(section)) return <Navigate to="/network/proxy" replace />;
  const active = section as Section;
  const segments = (
    <SegmentedControl<Section>
      value={active}
      onChange={(next) => navigate(`/network/${next}`)}
      options={sections}
      className={phone ? "w-[220px]" : "min-w-[320px]"}
    />
  );
  // iPhone: the section picker is the bar title (like Phone's All/Missed).
  return (
    <Page
      title={phone ? segments : t("网络")}
      leading={phone ? <BackButton to="/more" label={t("更多")} /> : null}
      accessory={phone ? undefined : segments}
    >
      <EmbeddedPageContext.Provider value>
        <div key={active}>
          {active === "proxy" ? <ProxyPage /> : active === "wireguard" ? <WireGuardPage /> : <ExportProxyPage />}
        </div>
      </EmbeddedPageContext.Provider>
    </Page>
  );
}
