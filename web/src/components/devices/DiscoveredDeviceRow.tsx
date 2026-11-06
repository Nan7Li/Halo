import { cx } from "../../lib/utils";
import { CheckmarkRegular } from "@fluentui/react-icons";
import type { DiscoveredDevice } from "../../types";
import { useI18n } from "../../lib/i18n";

export function DiscoveredDeviceRow({
  device,
  selected,
  modeLabel,
  isQmi,
  onSelect,
}: {
  device: DiscoveredDevice;
  selected: boolean;
  modeLabel: string;
  isQmi: boolean;
  onSelect: (d: DiscoveredDevice) => void;
}) {
  const { t } = useI18n();
  const degraded = !!device.degraded;
  const displayName = device.readerName || device.driverName || device.netInterface || device.controlPath || t("未知设备");
  const discoveryMessage = device.discoveryIssue === "pcsc_service_unavailable"
    ? t("系统已发现 USB 读卡器，但 PC/SC 服务未运行；请安装并启动 pcscd 后重新扫描。")
    : device.discoveryIssue === "pcsc_driver_missing"
      ? t("系统已发现 USB 读卡器，但 PC/SC 驱动未加载；请安装 libccid 或厂商驱动后重新扫描。")
      : device.discoveryIssue === "at_probe_pending"
        ? t("设备识别尚未完成，请稍后重新扫描。")
      : device.discoveryIssue === "at_port_missing"
        ? t(
            device.vendorId === 0x19d2
              ? "已发现该模组，但未找到 AT 串口：通常是 usbserial 通用驱动未绑定该 PID。可执行 `echo 19d2 <pid> | sudo tee /sys/bus/usb-serial/drivers/generic/new_id` 后重新扫描。"
              : "已发现该模组，但未找到 AT 串口：通常是 option 驱动未认该 PID 或模组处于 MBIM/RNDIS 组态。可 `echo 2c7c <pid> | sudo tee /sys/bus/usb-serial/drivers/option1/new_id` 后重扫，或用 AT+QCFG 切到 QMI+AT 组态。",
          )
        : "";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={degraded}
      onClick={() => onSelect(device)}
      className={cx("ios-select-row flex w-full items-center gap-3 px-4 text-left", degraded && "cursor-not-allowed")}
    >
      <span className="ios-select-row-body flex min-w-0 flex-1 items-center gap-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cx("truncate ios-body font-medium", degraded ? "text-label-2" : "text-label")}>{displayName}</span>
            <span className={cx("shrink-0 ios-footnote", isQmi ? "text-sys-green" : "text-sys-orange")}>{modeLabel}</span>
          </span>
          <span className="mt-0.5 block truncate font-mono ios-footnote text-label-2">
            {device.hardwareKind === "pcsc"
              ? `USB ${device.usbPath || "--"} · VID:PID ${device.vendorId.toString(16).padStart(4, "0")}:${device.productId.toString(16).padStart(4, "0")}`
              : `${device.controlPath} · AT ${device.atPort || "--"} · IMEI ${device.imei || "--"} · USB ${device.usbPath || "--"}`}
          </span>
          {degraded ? <span className="mt-1 block ios-footnote text-sys-orange">{discoveryMessage || t("未找到可用的 AT 端口（串口可能仍在枚举），系统会自动重试；也可点击重新扫描。")}</span> : null}
        </span>
        <span className="flex w-5 shrink-0 justify-center text-accent [&_svg]:h-5 [&_svg]:w-5">{selected && !degraded ? <CheckmarkRegular /> : null}</span>
      </span>
    </button>
  );
}
