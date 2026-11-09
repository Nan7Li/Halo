import { useCallback, useEffect, useState } from "react";
import {
  CertificateRegular,
  DeleteRegular,
  KeyRegular,
  LinkRegular,
  PhoneLinkSetupRegular,
  SimRegular,
  Wifi1Regular,
} from "@fluentui/react-icons";
import { api, apiMessage } from "../api";
import { useI18n } from "../lib/i18n";
import { ContentUnavailable, IOSSwitch, ListRow, ListSection, Page, Sheet } from "../components/ios";
import { Button, Input } from "../components/ui";
import { message } from "../components/ui/message";
import { confirmDialog } from "../components/ui/MessageBox";
import { formatNumber, formatRecentTime } from "../components/phone/model";

interface AgentStatus {
  enabled: boolean;
  agentId: string;
  name: string;
  pairPort: number;
  controlPort: number;
  pcmPort: number;
  deviceIds?: string[] | null;
  tlsCert: string;
  tlsKey: string;
  tlsError?: string;
  error?: string;
  addresses: string[] | null;
  lines: { id: string; label: string; number: string }[] | null;
  clients: { id: string; createdAt: string; lastSeen?: string; localMode: boolean; cloudEnabled: boolean }[] | null;
  pairing?: { code: string; expiresAt: string };
  activeCall?: { number: string; state: string; direction: string };
}

/**
 * Halo as the phone for AirSIM's iPhone app: the iPhone pairs with Halo the
 * way it would with the AirSIM Android APK, and calls go out on Halo's own
 * lines.
 */
export default function IPhonePage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<AgentStatus>("/airsim-agent"));
    } catch (error) {
      message.error(apiMessage(error));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // While a pairing window is open, watch for the iPhone to claim it.
  useEffect(() => {
    if (!status?.pairing) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [status?.pairing, load]);

  const save = async (body: Partial<AgentStatus>) => {
    setBusy(true);
    try {
      setStatus(await api<AgentStatus>("/airsim-agent", { method: "PUT", body }));
      return true;
    } catch (error) {
      message.error(apiMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pair = async () => {
    setBusy(true);
    try {
      setStatus(await api<AgentStatus>("/airsim-agent/pair", { method: "POST" }));
    } catch (error) {
      message.error(apiMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const forget = async (id: string) => {
    const ok = await confirmDialog(t("这台 iPhone 将无法再通过 Halo 打电话，需要重新配对。"), t("移除 iPhone"), {
      confirmText: t("移除"),
      confirmVariant: "danger",
      type: "danger",
    });
    if (!ok) return;
    try {
      setStatus(await api<AgentStatus>(`/airsim-agent/clients/${encodeURIComponent(id)}`, { method: "DELETE" }));
    } catch (error) {
      message.error(apiMessage(error));
    }
  };

  if (!status) {
    return (
      <Page title={t("iPhone 听筒")}>
        <div className="py-16 text-center ios-subhead text-label-2">{t("正在读取…")}</div>
      </Page>
    );
  }

  const clients = status.clients ?? [];
  const lines = status.lines ?? [];
  const addresses = status.addresses ?? [];
  const pairing = status.pairing;
  const secondsLeft = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - Date.now()) / 1000)) : 0;

  return (
    <Page title={t("iPhone 听筒")}>
      {!status.enabled && !clients.length ? (
        <ContentUnavailable
          icon={<PhoneLinkSetupRegular />}
          title={t("用 AirSIM 的 iPhone App 打 Halo 的电话")}
          description={t("Halo 会扮演 AirSIM 的安卓手机。iPhone 配对后，拨号、接听和短信都走 Halo 上的蜂窝模块或 VoWiFi，不需要另一台安卓手机。")}
        />
      ) : null}

      <ListSection footer={status.error ? <span className="text-sys-red">{status.error}</span> : t("开启后 Halo 会监听下面三个端口。局域网和 Tailscale 直接连接；公网需要配置受信任的证书。")}>
        <ListRow
          icon={<PhoneLinkSetupRegular />}
          iconColor="green"
          title={t("允许 iPhone 连接")}
          accessory={<IOSSwitch checked={status.enabled} disabled={busy} onChange={(value) => void save({ enabled: value })} ariaLabel={t("允许 iPhone 连接")} />}
        />
        {status.enabled ? (
          <>
            <ListRow title={t("配对 / 控制 / 音频端口")} detail={`${status.pairPort} / ${status.controlPort} / ${status.pcmPort}`} onClick={() => setSettings(true)} />
            {status.activeCall ? (
              <ListRow title={t("当前通话")} detail={`${formatNumber(status.activeCall.number)} · ${status.activeCall.state}`} />
            ) : null}
          </>
        ) : null}
      </ListSection>

      {status.enabled ? (
        <ListSection
          header={t("配对")}
          footer={t("在 iPhone 的 AirSIM 里打开「配对安卓手机 → 私网 IP」，填 NAS 的地址、配对端口和配对码。配对码两分钟内有效，输错 5 次作废。")}
        >
          {pairing ? (
            <>
              <ListRow title={t("配对码")} detail={<span className="ios-title-2 tabular-nums tracking-[0.2em] text-label">{pairing.code}</span>} />
              <ListRow title={t("配对端口")} detail={String(status.pairPort)} />
              {addresses.map((address) => (
                <ListRow key={address} icon={<Wifi1Regular />} iconColor="indigo" title={t("NAS 地址")} detail={address} />
              ))}
              <ListRow title={t("剩余时间")} detail={`${secondsLeft} s`} />
            </>
          ) : (
            <ListRow icon={<LinkRegular />} iconColor="blue" title={t("开始配对 iPhone")} onClick={busy ? undefined : () => void pair()} />
          )}
        </ListSection>
      ) : null}

      {clients.length ? (
        <ListSection header={t("已配对的 iPhone")}>
          {clients.map((client) => (
            <ListRow
              key={client.id}
              icon={<KeyRegular />}
              iconColor="gray"
              title={`iPhone · ${client.id.slice(0, 6)}`}
              subtitle={[
                client.localMode ? t("本地模式") : client.cloudEnabled ? t("云端模式") : t("直连"),
                client.lastSeen ? `${t("最后连接")} ${formatRecentTime(client.lastSeen)}` : t("尚未连接"),
              ].join(" · ")}
              accessory={
                <button type="button" className="ios-press p-1 text-sys-red" aria-label={t("移除")} onClick={() => void forget(client.id)}>
                  <DeleteRegular className="h-5 w-5" />
                </button>
              }
            />
          ))}
        </ListSection>
      ) : null}

      {status.enabled ? (
        <ListSection header={t("线路")} footer={t("iPhone 上显示为 SIM 卡，第一条是默认线路。只列出现在能通话并有音频的线路。")}>
          {lines.length ? (
            lines.map((line, index) => (
              <ListRow
                key={line.id}
                icon={<SimRegular />}
                iconColor={index === 0 ? "green" : "gray"}
                title={line.label}
                subtitle={line.number ? formatNumber(line.number) : undefined}
                detail={index === 0 ? t("默认") : undefined}
              />
            ))
          ) : (
            <ListRow multiline title={<span className="text-label-2">{t("没有可通话的线路。请在设备页确认模块的通话音频或 VoWiFi 已就绪。")}</span>} />
          )}
        </ListSection>
      ) : null}

      {status.enabled ? (
        <ListSection
          header={t("公网连接")}
          footer={
            status.tlsError ? (
              <span className="text-sys-red">{status.tlsError}</span>
            ) : (
              t("AirSIM 的「公网域名」模式只接受系统信任的证书，Halo 自带的自签证书不行。可以指定 acme.sh 等签发的证书文件；或者让 iPhone 装 Tailscale，用私网 IP 模式连接。")
            )
          }
        >
          <ListRow
            icon={<CertificateRegular />}
            iconColor="orange"
            title={t("证书")}
            detail={status.tlsCert ? status.tlsCert.split("/").pop() : t("未设置")}
            onClick={() => setSettings(true)}
          />
        </ListSection>
      ) : null}

      <SettingsSheet open={settings} status={status} busy={busy} onClose={() => setSettings(false)} onSave={save} />
    </Page>
  );
}

function SettingsSheet({
  open,
  status,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  status: AgentStatus;
  busy: boolean;
  onClose: () => void;
  onSave: (body: Partial<AgentStatus>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [pairPort, setPairPort] = useState("");
  const [controlPort, setControlPort] = useState("");
  const [pcmPort, setPcmPort] = useState("");
  const [cert, setCert] = useState("");
  const [key, setKey] = useState("");
  useEffect(() => {
    if (!open) return;
    setPairPort(String(status.pairPort));
    setControlPort(String(status.controlPort));
    setPcmPort(String(status.pcmPort));
    setCert(status.tlsCert);
    setKey(status.tlsKey);
  }, [open, status]);

  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 5);
  const submit = async () => {
    const ok = await onSave({
      pairPort: Number(pairPort),
      controlPort: Number(controlPort),
      pcmPort: Number(pcmPort),
      tlsCert: cert.trim(),
      tlsKey: key.trim(),
    });
    if (ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("连接设置")}
      footer={
        <Button variant="primary" className="w-full" loading={busy} disabled={busy} onClick={submit}>
          {t("保存")}
        </Button>
      }
    >
      <div className="ios-form-row"><label className="ios-form-label">{t("配对端口")}</label><div className="ios-form-control"><Input value={pairPort} inputMode="numeric" onChange={(event) => setPairPort(digits(event.target.value))} /></div></div>
      <div className="ios-form-row"><label className="ios-form-label">{t("控制端口")}</label><div className="ios-form-control"><Input value={controlPort} inputMode="numeric" onChange={(event) => setControlPort(digits(event.target.value))} /></div></div>
      <div className="ios-form-row"><label className="ios-form-label">{t("音频端口")}</label><div className="ios-form-control"><Input value={pcmPort} inputMode="numeric" onChange={(event) => setPcmPort(digits(event.target.value))} /></div></div>
      <p className="ios-form-hint ios-footnote text-label-2">{t("公网使用时，在路由器把这三个 TCP 端口映射到 NAS，iPhone 填路由器对外的端口。")}</p>
      <div className="ios-form-row"><label className="ios-form-label">{t("证书文件")}</label><div className="ios-form-control"><Input value={cert} placeholder="/etc/ssl/phone.example.com/fullchain.pem" autoComplete="off" onChange={(event) => setCert(event.target.value)} /></div></div>
      <div className="ios-form-row"><label className="ios-form-label">{t("私钥文件")}</label><div className="ios-form-control"><Input value={key} placeholder="/etc/ssl/phone.example.com/privkey.pem" autoComplete="off" onChange={(event) => setKey(event.target.value)} /></div></div>
      <p className="ios-form-hint ios-footnote text-label-2">{t("NAS 上的 PEM 文件路径。证书续期后 Halo 会自动重新读取。留空则只接受局域网和 Tailscale。")}</p>
    </Sheet>
  );
}
