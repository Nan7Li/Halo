import { ArrowSyncRegular, PowerRegular, ChatRegular, Cellular4GRegular, Wifi1Regular, AirplaneRegular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { Spinner } from "../ui";
import type { DeviceDetail } from "./types";
import { useI18n } from "../../lib/i18n";
import { deviceTypeImage } from "../../lib/deviceTypes";
import { isVoWiFiInUse, radioMode } from "./shared";
import { cx } from "../../lib/utils";

export interface DeviceDetailHeaderProps {
  device: DeviceDetail;
  dataToggling: boolean;
  dataToggleTarget?: boolean | null;
  modemRebooting?: boolean;
  rebooting: boolean;
  reconnectingVoWiFi: boolean;
  onCopyText: (text: string) => void;
  onToggleRoamingData: (enabled: boolean) => void;
  onReconnectVowifi: () => void;
  onRebootModem: () => void;
  onOpenSms: () => void;
  onToggleAirplane: (enabled: boolean) => void;
  onToggleVoWiFi: (enabled: boolean) => void;
  airplaneToggling: boolean;
  vowifiToggling: boolean;
  wifiCallingOnly?: boolean;
  modemControlOnly?: boolean;
}

/**
 * One control tile, like the action buttons under a contact card: a symbol
 * over a short label. Toggles fill with their color when on (Control
 * Center style); actions stay neutral. Each RF toggle flips exactly one
 * backend switch, so 4G / airplane / VoWiFi are never re-bound in the UI.
 */
function ControlTile({
  active,
  locked,
  loading,
  disabled,
  onClick,
  icon,
  label,
  title,
  color,
  destructive,
}: {
  active?: boolean;
  locked?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title?: string;
  color?: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      title={title}
      aria-pressed={active === undefined ? undefined : active}
      className={cx(
        "ios-control-tile ios-press",
        active ? "is-on" : destructive ? "text-sys-red" : "text-accent",
        locked && "cursor-not-allowed",
        disabled && !loading && "opacity-40",
      )}
      style={active && color ? { background: `rgb(var(--ios-${color}))` } : undefined}
    >
      <span className="ios-control-tile-icon">{loading ? <Spinner className="h-5 w-5" /> : icon}</span>
      <span className="ios-control-tile-label">{label}</span>
    </button>
  );
}

export function DeviceDetailHeader(props: DeviceDetailHeaderProps) {
  const { t } = useI18n();
  const { device } = props;
  const vowifiInUse = isVoWiFiInUse(device);
  const mode = radioMode(device);
  const modeLabel = mode === "vowifi" ? t("VoWiFi") : mode === "cellular" ? t("4G 数据") : mode === "airplane" ? t("飞行模式") : mode === "transition" ? t("切换中") : t("离线");

  const networkEnabled = !!device.networkEnabled;
  // While VoWiFi is enabled the IMS stack keeps the radio in airplane mode;
  // the backend refuses a flight toggle with 409. Show that lock explicitly.
  const airplaneLocked = vowifiInUse;
  const airplaneActive = airplaneLocked || !!device.flightMode;
  const simLabel = device.modem?.operator || device.activeEsimProfileName || t("SIM");
  const cellularLabel = props.modemRebooting
    ? t("重启中")
    : props.dataToggling && props.dataToggleTarget !== null && props.dataToggleTarget !== undefined
      ? props.dataToggleTarget ? t("开启中") : t("关闭中")
      : t("蜂窝数据");

  return (
    <div className="mb-6">
      <div className="flex flex-col items-center gap-3 px-2 pb-5 pt-1 text-center md:flex-row md:items-center md:text-left">
        <span className="ios-device-hero">
          <img src={deviceTypeImage(device.deviceType)} alt="" />
        </span>
        <div className="min-w-0">
          <div className="truncate ios-title-2 text-label">{device.name || device.id}</div>
          <button type="button" onClick={() => props.onCopyText(device.id)} title={t("复制")} className="mt-0.5 max-w-full truncate ios-subhead text-label-2">
            {simLabel} · {modeLabel} · <span className="font-mono">{device.id}</span>
          </button>
        </div>
      </div>

      <div className="ios-control-grid">
        <ControlTile
          active={networkEnabled}
          color="green"
          loading={props.dataToggling}
          disabled={!device.interface}
          onClick={() => void props.onToggleRoamingData(!networkEnabled)}
          icon={<Cellular4GRegular />}
          label={cellularLabel}
          title={t("蜂窝数据开关（漫游数据，仅供受保护路由使用）")}
        />
        <ControlTile
          active={vowifiInUse}
          color="blue"
          loading={props.vowifiToggling}
          disabled={props.wifiCallingOnly}
          onClick={() => void props.onToggleVoWiFi(!vowifiInUse)}
          icon={<Wifi1Regular />}
          label="VoWiFi"
          title={t("VoWiFi 开关（独立于飞行模式）")}
        />
        <ControlTile
          active={airplaneActive}
          color="orange"
          locked={airplaneLocked}
          loading={props.airplaneToggling}
          disabled={props.wifiCallingOnly}
          onClick={() => void props.onToggleAirplane(!airplaneActive)}
          icon={<AirplaneRegular />}
          label={airplaneLocked ? t("飞行·锁") : t("飞行")}
          title={airplaneLocked ? t("VoWiFi 需要射频关闭，飞行模式由系统锁定；关闭 VoWiFi 后可手动切换。") : t("飞行模式开关（独立于 VoWiFi，不会联动）")}
        />
        {vowifiInUse ? (
          <ControlTile loading={props.reconnectingVoWiFi} onClick={props.onReconnectVowifi} icon={<ArrowSyncRegular />} label={t("重连 VoWiFi")} />
        ) : null}
        {!props.modemControlOnly ? <ControlTile onClick={props.onOpenSms} icon={<ChatRegular />} label={t("短信")} /> : null}
        {!props.wifiCallingOnly && !props.modemControlOnly ? (
          <ControlTile destructive loading={props.rebooting} onClick={props.onRebootModem} icon={<PowerRegular />} label={t("重启模组")} />
        ) : null}
      </div>
    </div>
  );
}
