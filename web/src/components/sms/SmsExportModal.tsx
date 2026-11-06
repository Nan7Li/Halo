import { useEffect, useRef, useState } from "react";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { api, apiMessage } from "../../api";
import type { DeviceListItem, DevicesResponse } from "../../types";
import { tf, useI18n } from "../../lib/i18n";
import { Button, Input, Modal, Select, message } from "../ui";
import { ListSection } from "../ios";
import { buildSMSExportQuery, readSMSExportDownload, type SMSExportFormat } from "./smsExport";

interface SmsExportModalProps {
  devices: DeviceListItem[];
  defaultDeviceId: string;
  onClose: () => void;
}

export function SmsExportModal({ devices, defaultDeviceId, onClose }: SmsExportModalProps) {
  const { t } = useI18n();
  const [deviceId, setDeviceId] = useState(defaultDeviceId || "all");
  const [format, setFormat] = useState<SMSExportFormat>("json");
  const [timeRange, setTimeRange] = useState<"all" | "range">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);

  const [exportDevices, setExportDevices] = useState(devices);

  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    // The SMS page lists running devices for sending. Archives must also
    // allow selecting configured devices that are offline or stopped.
    void api<DevicesResponse>("/devices", { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) setExportDevices(response.devices || []);
    }).catch(() => {
      if (!controller.signal.aborted) message.warning(t("设备列表加载失败，仍可按当前选择导出。"));
    });
    return () => controller.abort();
  }, []);

  const deviceOptions = [
    { value: "all", label: t("全部设备") },
    ...exportDevices.map((device) => ({ value: device.id, label: device.name ? `${device.name} (${device.id})` : device.id })),
  ];
  // Retain an explicit selection if a device disappears during polling. Never
  // silently turn a specific-device export into an all-device export.
  if (deviceId !== "all" && !exportDevices.some((device) => device.id === deviceId)) {
    deviceOptions.push({ value: deviceId, label: deviceId });
  }

  function close() {
    request.current?.abort();
    onClose();
  }

  async function download() {
    if (request.current) return;
    let query: URLSearchParams;
    try {
      query = buildSMSExportQuery({ deviceId, format, timeRange, startDate, endDate });
    } catch (e) {
      message.error(t(apiMessage(e)));
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const response = await api<Response>(`/sms/export?${query}`, { raw: true, signal: controller.signal, cache: "no-store" });
      const archive = await readSMSExportDownload(response, format);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = archive.filename;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        // Give the browser time to begin consuming the download before revoke.
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      if (archive.count === 0) {
        message.warning(t("所选范围没有短信，已生成空归档。"));
      } else {
        message.success(tf("已生成 {count} 条短信的导出文件，请在浏览器下载中确认保存。", { count: archive.count }));
      }
    } catch (e) {
      if (!controller.signal.aborted) message.error(t(apiMessage(e)));
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title={t("导出短信")}
      footer={<>
        <Button onClick={close}>{busy ? t("取消导出") : t("关闭")}</Button>
        <Button variant="primary" loading={busy} icon={<ArrowDownloadRegular />} onClick={() => void download()}>
          {busy ? t("正在生成导出文件") : t("下载")}
        </Button>
      </>}
    >
      <div className="pt-1">
        <ListSection
          footer={timeRange === "range" ? t("按浏览器本地时区筛选，包含开始和结束当天。") : undefined}
          bodyClassName="px-4"
        >
          <div className="ios-form-row"><label className="ios-form-label">{t("导出设备")}</label><div className="ios-form-control"><Select value={deviceId} disabled={busy} options={deviceOptions} onChange={(value) => { setDeviceId(value); }} /></div></div>
          <div className="ios-form-row"><label className="ios-form-label">{t("时间范围")}</label><div className="ios-form-control"><Select value={timeRange} disabled={busy} options={[{ value: "all", label: t("全部时间") }, { value: "range", label: t("指定日期范围") }]} onChange={(value) => { setTimeRange(value as "all" | "range"); }} /></div></div>
          {timeRange === "range" ? (
            <>
              <div className="ios-form-row"><label className="ios-form-label">{t("开始日期")}</label><div className="ios-form-control"><Input type="date" value={startDate} disabled={busy} max={endDate || undefined} onChange={(e) => { setStartDate(e.target.value); }} /></div></div>
              <div className="ios-form-row"><label className="ios-form-label">{t("结束日期")}</label><div className="ios-form-control"><Input type="date" value={endDate} disabled={busy} min={startDate || undefined} onChange={(e) => { setEndDate(e.target.value); }} /></div></div>
            </>
          ) : null}
        </ListSection>
        <ListSection footer={t("JSON 时间使用 UTC；HTML 按导出时的浏览器时区显示，并标注时区。")} bodyClassName="px-4">
          <div className="ios-form-row"><label className="ios-form-label">{t("文件格式")}</label><div className="ios-form-control"><Select value={format} disabled={busy} options={[{ value: "json", label: t("JSON（完整记录）") }, { value: "html", label: t("HTML（离线阅读）") }]} onChange={(value) => { setFormat(value as SMSExportFormat); }} /></div></div>
        </ListSection>
        <p className="rounded-[var(--radius-md)] bg-sys-orange/15 px-4 py-3 ios-subhead text-sys-orange">{t("文件包含短信正文、号码、设备和 SIM 标识，可能含验证码。不会脱敏或加密，请妥善保管。")}</p>
      </div>
    </Modal>
  );
}
