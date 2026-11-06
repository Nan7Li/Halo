import { useEffect, type ReactNode } from "react";
import { ArrowSyncRegular, SaveRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { Button, Input, Modal, Select, Spinner } from "../ui";
import { ListSection } from "../ios";
import { isQmiControl } from "./shared";
import { DiscoveredDeviceRow } from "./DiscoveredDeviceRow";
import type { DiscoveredDevice } from "../../types";
import type { AddDeviceForm } from "./types";
import { useI18n } from "../../lib/i18n";
import { DEVICE_TYPES, deviceTypeImage } from "../../lib/deviceTypes";

export interface DeviceAddDialogProps {
  open: boolean;
  discovering: boolean;
  unconfiguredDiscovered: DiscoveredDevice[];
  addSelected: DiscoveredDevice | null;
  addConfig: AddDeviceForm;
  addSaving: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSelectDevice: (d: DiscoveredDevice) => void;
  onConfigChange: (next: AddDeviceForm) => void;
  onSave: () => void;
}

function discoveryKey(d?: DiscoveredDevice | null): string {
  return d ? String(d.discoveryKey || `${d.usbPath || ""}|${d.atPort || ""}`) : "";
}
function isQmiMode(d?: DiscoveredDevice | null): boolean {
  return String(d?.mode || "").toLowerCase() === "qmi";
}
function modeLabel(d?: DiscoveredDevice | null): string {
  const mode = String(d?.mode || "").toUpperCase();
  if (mode === "PCSC") return "PC/SC";
  return ["AT", "QMI", "MBIM", "ECM", "RNDIS", "NCM"].includes(mode) ? mode : "UNKNOWN";
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ios-form-row">
      <label className="ios-form-label">{label}</label>
      <div className="ios-form-control">{children}</div>
    </div>
  );
}

export function DeviceAddDialog(props: DeviceAddDialogProps) {
  const { t } = useI18n();
  const { addSelected, addConfig } = props;
  const fixedQmi = isQmiControl(addSelected?.controlPath || addConfig?.controlDevice);
  const isMbim = String(addSelected?.mode || "").toLowerCase() === "mbim";
	const isReader = addSelected?.hardwareKind === "pcsc" || String(addSelected?.mode || "").toLowerCase() === "pcsc";

  useEffect(() => {
    if (fixedQmi && addConfig.deviceBackend !== "qmi") props.onConfigChange({ ...addConfig, deviceBackend: "qmi" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedQmi]);
  useEffect(() => {
    if (isMbim && addConfig.deviceBackend !== "mbim") props.onConfigChange({ ...addConfig, deviceBackend: "mbim" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMbim]);

  const backendOptions = isReader ? [{ value: "pcsc", label: "PC/SC" }] : [
    ...(isMbim
      ? []
      : [
          { value: "at", label: "AT", disabled: fixedQmi },
          { value: "qmi", label: "QMI", disabled: !addConfig.controlDevice },
        ]),
    ...(isMbim ? [{ value: "mbim", label: "MBIM" }] : []),
  ];
  const set = (patch: Partial<AddDeviceForm>) => props.onConfigChange({ ...addConfig, ...patch });

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={t("添加设备配置")}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={props.onClose}>{t("取消")}</Button>
          <Button variant="primary" loading={props.addSaving} onClick={props.onSave} className="!border-0" icon={<SaveRegular />}>
            {t("保存")}
          </Button>
        </div>
      }
    >
      <ListSection
        header={
          <span className="flex items-end justify-between gap-3">
            <span>{t("发现的设备")}</span>
            <button type="button" className="inline-flex items-center gap-1 ios-subhead font-medium text-accent disabled:opacity-40" onClick={props.onRefresh} disabled={props.discovering}>
              <ArrowSyncRegular className={cx("h-4 w-4", props.discovering && "animate-spin")} />
              {t("刷新设备")}
            </button>
          </span>
        }
        footer={t("选择一个“未配置”的设备，系统将自动填充 AT 端口与识别信息。")}
        bodyClassName="max-h-[300px] overflow-auto"
      >
        {props.discovering ? (
          <div className="flex items-center justify-center gap-2 py-6 ios-subhead text-label-2">
            <Spinner className="h-4 w-4" />
            {t("正在探测设备...")}
          </div>
        ) : props.unconfiguredDiscovered.length === 0 ? (
          <div className="px-4 py-4 text-center ios-subhead text-label-2">{t("暂无可添加设备（或系统未发现新的模组）")}</div>
        ) : (
          props.unconfiguredDiscovered.map((d) => (
            <DiscoveredDeviceRow
              key={discoveryKey(d)}
              device={d}
              selected={discoveryKey(addSelected) === discoveryKey(d)}
              modeLabel={modeLabel(d)}
              isQmi={isQmiMode(d)}
              onSelect={props.onSelectDevice}
            />
          ))
        )}
      </ListSection>

      <ListSection
        header={t("设备")}
        footer={fixedQmi ? t("此类 WWAN QMI 设备运行后端固定为 QMI；AT 口仍会保留给 AT 终端。") : undefined}
        bodyClassName="px-4"
      >
        <div className="ios-form-row items-center">
          <span className="ios-row-thumb shrink-0">
            {addConfig.deviceType ? <img src={deviceTypeImage(addConfig.deviceType)} alt="" /> : null}
          </span>
          <div className="ios-form-control">
            <Select
              value={addConfig.deviceType}
              onChange={(v) => set({ deviceType: v as AddDeviceForm["deviceType"] })}
              placeholder={t("请选择设备类型")}
              options={DEVICE_TYPES.map((item) => ({ value: item.value, label: t(item.label) }))}
            />
          </div>
        </div>
        <Field label="ID">
          <Input value={addConfig.id} onChange={(e) => set({ id: e.target.value })} placeholder={t("例如 ec20_3")} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <Field label={t("名称")}>
          <Input value={addConfig.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("可选")} />
        </Field>
        {isReader ? (
          <Field label="SIM PIN">
            <Input type="password" value={addConfig.simPin} onChange={(e) => set({ simPin: e.target.value })} maxLength={8} inputMode="numeric" placeholder={t("仅在 SIM 启用 PIN 时填写")} />
          </Field>
        ) : null}
        <Field label={t("设备后端模式")}>
          <Select
            value={addConfig.deviceBackend}
            onChange={(v) => set({ deviceBackend: v })}
            placeholder="AT"
            disabled={fixedQmi || isMbim || isReader}
            options={backendOptions}
          />
        </Field>
      </ListSection>

      <ListSection
        header={t("自动识别")}
        footer={fixedQmi ? t("固定 QMI，AT 口仅用于终端") : isMbim ? t("固定 MBIM，AT 口仅用于终端") : t("AT=串口 / QMI=纯 QMI")}
        bodyClassName="px-4"
        className="!mb-1"
      >
        {addSelected ? (
          <div className="ios-form-row items-center">
            <span className="ios-form-label !pt-0">{t("模式")}</span>
            <span className="ios-form-control ios-body text-label-2">
              {modeLabel(addSelected)}
              {fixedQmi ? ` · ${t("仅 QMI 后端")}` : ""}
              {isMbim ? ` · ${t("仅 MBIM 后端")}` : ""}
            </span>
          </div>
        ) : null}
        {([
          [t("IMEI 绑定"), addConfig.modemImei],
          [t("硬件路径"), addConfig.usbPath],
          [t("网卡接口"), addConfig.interface],
          [t("AT 端口"), addConfig.atPort],
          [t("控制设备"), addConfig.controlDevice],
        ] as const).map(([label, value]) => (
          <div key={label} className="ios-form-row items-center">
            <span className="ios-form-label !pt-0">{label}</span>
            <span className="ios-form-control truncate font-mono ios-subhead text-label-2">{value || "—"}</span>
          </div>
        ))}
      </ListSection>
    </Modal>
  );
}
