import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { EmbeddedPageContext } from "../components/ui/PageHeader";
import { Page, SegmentedControl } from "../components/ios";
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
  const sections: { value: Section; label: string }[] = [
    { value: "proxy", label: t("代理") },
    { value: "wireguard", label: "WireGuard" },
    ...(developer ? [{ value: "export" as const, label: t("导出代理") }] : []),
  ];
  if (!["proxy", "wireguard", "export"].includes(section)) return <Navigate to="/network/proxy" replace />;
  const active = section as Section;
  return (
    <Page
      title={t("网络")}
      accessory={
        <SegmentedControl<Section>
          pill
          value={active}
          onChange={(next) => navigate(`/network/${next}`)}
          options={sections}
          className="w-full sm:w-auto sm:min-w-[360px]"
        />
      }
    >
      <EmbeddedPageContext.Provider value>
        <div key={active}>
          {active === "proxy" ? <ProxyPage /> : active === "wireguard" ? <WireGuardPage /> : <ExportProxyPage />}
        </div>
      </EmbeddedPageContext.Provider>
    </Page>
  );
}
