import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRightRegular } from "@fluentui/react-icons";
import { api, apiMessage } from "../../api";
import type { DeviceListItem } from "../../types";
import { Button, Input, Select, Switch, message } from "../ui";
import { tl, useI18n } from "../../lib/i18n";
import { cx } from "../../lib/utils";

export interface CellBridgeConfig {
  sipEnabled: boolean;
  sipDeviceId: string;
  listenAddr: string;
  advertisedIp: string;
  rtpListenAddr: string;
  username: string;
  hasPassword: boolean;
  cellularEnabled: boolean;
  cellularDeviceId: string;
  captureDevice: string;
  playbackDevice: string;
  runtimeDir: string;
  adbPath: string;
  adbSocket: string;
  bootstrap: boolean;
}

interface BridgeStatus {
  phase: string;
  reason?: string;
  sip?: { running: boolean; registered: boolean; listenAddr?: string; rtpListenAddr?: string; advertisedIp?: string; username?: string; reason?: string };
  cellular?: { ready: boolean; deviceId?: string; reason?: string };
}
interface BridgeDocument { config: CellBridgeConfig; status: BridgeStatus }

const defaults: CellBridgeConfig = {
  sipEnabled: false, sipDeviceId: "", listenAddr: "0.0.0.0:5060", advertisedIp: "",
  rtpListenAddr: "0.0.0.0:40000", username: "halo", hasPassword: false,
  cellularEnabled: false, cellularDeviceId: "", captureDevice: "plughw:1,0",
  playbackDevice: "plughw:1,0", runtimeDir: "/opt/halo/qdc507", adbPath: "adb",
  adbSocket: "tcp:127.0.0.1:5038", bootstrap: false,
};

export function CellBridgeSettings({ devices }: { devices: DeviceListItem[] }) {
  const { t } = useI18n();
  const prefix = useId();
  const [advanced, setAdvanced] = useState(false);
  const [config, setConfig] = useState<CellBridgeConfig | null>(null);
  const [status, setStatus] = useState<BridgeStatus>({ phase: "loading" });
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const current = config ?? defaults;
  const options = devices.map(device => ({ value: device.id, label: device.name || device.id }));
  const cellularOptions = devices.filter(device => device.deviceType === "dji_4g")
    .map(device => ({ value: device.id, label: device.name || device.id }));
  const liveIP = status.sip?.advertisedIp || current.advertisedIp;
  const livePort = (status.sip?.listenAddr || current.listenAddr).match(/:(\d+)$/)?.[1] || "5060";
  const clientAddress = `${liveIP.includes(":") ? `[${liveIP}]` : liveIP}:${livePort}`;

  const load = useCallback(async () => {
    try {
      const result = await api<BridgeDocument>("/settings/cellbridge");
      if (!result.config || !result.status) throw new Error(tl("通话桥配置不可用"));
      setConfig(previous => previous
        ? { ...previous, hasPassword: result.config.hasPassword }
        : { ...defaults, ...result.config });
      setStatus(result.status);
      setLoadError("");
    } catch (error) { setLoadError(apiMessage(error)); }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  function change<K extends keyof CellBridgeConfig>(key: K, value: CellBridgeConfig[K]) {
    setConfig(previous => ({ ...(previous ?? defaults), [key]: value }));
  }
  async function save() {
    setSaving(true);
    try {
      const { hasPassword: _hasPassword, ...editable } = current;
      const result = await api<BridgeDocument>("/settings/cellbridge", {
        method: "PUT", body: { ...editable, password },
      });
      setConfig({ ...defaults, ...result.config });
      setStatus(result.status);
      setPassword("");
      message.success(tl("通话桥配置已保存"));
    } catch (error) { message.error(apiMessage(error)); }
    finally { setSaving(false); }
  }
  function field(key: keyof CellBridgeConfig, label: string, placeholder = "") {
    return (
      <div className="ios-form-row">
        <label className="ios-form-label" htmlFor={`${prefix}-${key}`}>{label}</label>
        <div className="ios-form-control">
          <Input id={`${prefix}-${key}`} value={String(current[key])} placeholder={placeholder}
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            disabled={!config || saving} onChange={event => change(key, event.target.value)} />
        </div>
      </div>
    );
  }
  function toggle(label: string, checked: boolean, onChange: (value: boolean) => void) {
    return (
      <div className="ios-form-row items-center">
        <span className="min-w-0 flex-1 ios-body text-label">{label}</span>
        <Switch ariaLabel={label} checked={checked} disabled={!config || saving} onChange={onChange} />
      </div>
    );
  }
  function statusRow(label: string, value: string, tone: string, detail?: string) {
    return (
      <div className="ios-form-row items-center">
        <span className="min-w-0 flex-1">
          <span className="block ios-body text-label">{label}</span>
          {detail ? <span className="mt-0.5 block break-words ios-footnote text-label-2">{detail}</span> : null}
        </span>
        <span className={cx("shrink-0 ios-body", tone)}>{value}</span>
      </div>
    );
  }

  const phaseLabel = status.phase === "ready" ? t("已运行") : status.phase === "applying" ? t("正在应用") : status.phase === "disabled" ? t("已关闭") : status.phase === "loading" ? t("加载中") : t("未就绪");
  const phaseTone = status.phase === "failed" ? "text-sys-red" : status.phase === "ready" ? "text-sys-green" : "text-label-2";

  return (
    <div className="space-y-7" aria-label={t("CellBridge 通话桥")}>
      <Group
        header={t("状态")}
        action={<button type="button" className="ios-subhead font-medium text-accent" onClick={() => void load()}>{t("刷新状态")}</button>}
        footer={
          <>
            {(loadError || status.reason) ? <span className="block break-words text-sys-orange" role="status">{loadError || status.reason}</span> : null}
            {status.sip?.running && status.phase !== "applying" ? (
              <span className="block break-all">{t("客户端连接")}：<span className="font-mono">{clientAddress}</span> · {t("账号")} {status.sip.username || current.username} · UDP / PCMU</span>
            ) : null}
            <span className="block">{t("大疆模块可使用浏览器音频；SIP 客户端可选择大疆或 SIM 读卡器的通话线路。")}</span>
          </>
        }
      >
        {statusRow("CellBridge", phaseLabel, phaseTone)}
        {statusRow("SIP", status.sip?.registered ? t("客户端已注册") : status.sip?.running ? t("等待客户端注册") : t("已停止"), status.sip?.registered ? "text-sys-green" : "text-label-2", status.sip?.reason)}
        {statusRow(t("大疆音频"), status.cellular?.ready ? t("已就绪") : t("未就绪"), status.cellular?.ready ? "text-sys-green" : "text-label-2", status.cellular?.reason)}
      </Group>

      <Group header="SIP">
        {toggle(t("启用 SIP 服务"), current.sipEnabled, value => change("sipEnabled", value))}
        <div className="ios-form-row">
          <label className="ios-form-label">{t("通话线路")}</label>
          <div className="ios-form-control">
            <Select value={current.sipDeviceId} options={options} onChange={value => change("sipDeviceId", value)} placeholder={t("请选择设备")} />
          </div>
        </div>
        {field("advertisedIp", t("Halo 连接地址"), t("局域网、WireGuard 或 Tailscale IP"))}
        {field("username", t("SIP 账号"))}
        <div className="ios-form-row">
          <label className="ios-form-label" htmlFor={`${prefix}-password`}>{t("SIP 密码")}</label>
          <div className="ios-form-control">
            <Input id={`${prefix}-password`} type="password" autoComplete="new-password" value={password}
              placeholder={current.hasPassword ? t("已设置，留空保留") : t("设置 SIP 密码")} disabled={!config || saving}
              onChange={event => setPassword(event.target.value)} />
          </div>
        </div>
        {field("listenAddr", t("SIP 监听地址"))}
        {field("rtpListenAddr", t("音频 UDP 监听地址"))}
      </Group>

      <Group header={t("大疆通话音频")} footer={t("读卡器的音频通过现有 VoWiFi 提供，需要 IMS 注册成功。")}>
        {toggle(t("启用大疆通话音频"), current.cellularEnabled, value => change("cellularEnabled", value))}
        <div className="ios-form-row">
          <label className="ios-form-label">{t("蜂窝音频设备")}</label>
          <div className="ios-form-control">
            <Select value={current.cellularDeviceId} options={cellularOptions} onChange={value => change("cellularDeviceId", value)} placeholder={t("请选择大疆模块")} />
          </div>
        </div>
      </Group>

      <Group
        header={t("大疆音频高级设置")}
        footer={advanced ? (
          <>
            <span className="block">{t("按 NAS 检查工具列出的模块声卡填写录音和播放设备，声卡编号可能变化。")}</span>
            <span className="block">{t("NAS 安装器将通过校验的三个运行文件放在此目录。文件齐全后仍需确认模块 UAC、ADB 和双向通话。")}</span>
          </>
        ) : undefined}
      >
        <button type="button" className="ios-form-row w-full items-center text-left" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>
          <span className="min-w-0 flex-1 ios-body text-label">{advanced ? t("收起") : t("显示高级设置")}</span>
          <ChevronRightRegular className={cx("h-4 w-4 shrink-0 text-label-3 transition-transform duration-200", advanced && "rotate-90")} />
        </button>
        {advanced ? (
          <>
            {field("captureDevice", t("ALSA 录音设备"))}
            {field("playbackDevice", t("ALSA 播放设备"))}
            {field("runtimeDir", t("模块运行文件目录"), "/opt/halo/qdc507")}
            {field("adbPath", t("ADB 程序"), "adb")}
            {field("adbSocket", t("ADB 服务地址"))}
            {toggle(t("允许初始化匹配的 QDC507 音频"), current.bootstrap, value => change("bootstrap", value))}
          </>
        ) : null}
      </Group>

      <Button variant="primary" className="w-full !border-0" loading={saving} disabled={!config} onClick={() => void save()}>
        {t("保存通话桥设置")}
      </Button>
    </div>
  );
}

/** An inset-grouped section: uppercase header (+ trailing action), card, footnote. */
function Group({ header, action, footer, children }: { header: ReactNode; action?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="flex items-end justify-between gap-3 px-4 pb-1.5">
        <h3 className="ios-footnote font-medium uppercase text-label-2">{header}</h3>
        {action}
      </div>
      <div className="rounded-[var(--radius-lg)] bg-grouped-2 px-4">{children}</div>
      {footer ? <div className="mt-1.5 space-y-1 px-4 ios-footnote text-label-2">{footer}</div> : null}
    </section>
  );
}
