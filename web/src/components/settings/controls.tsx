import { useState, type ReactNode } from "react";
import { AddRegular, CheckmarkRegular, DeleteRegular, EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { tl, useI18n } from "../../lib/i18n";
import { cx } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Switch } from "../ui/Switch";
import { message } from "../ui/message";
import type { DeviceListItem } from "../../types";

const LABEL_CLASS = "text-xs font-bold text-gray-500 uppercase tracking-wider";

// 带可见性切换的密码输入框（对应参考里的 show-password）。
export function PasswordInput({
  value,
  onChange,
  disabled,
  placeholder,
  inputSize,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputSize?: "default" | "large";
  autoComplete?: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <Input
      type={visible ? "text" : "password"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      inputSize={inputSize}
      autoComplete={autoComplete}
      suffix={
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? t("隐藏密码") : t("显示密码")}
          onClick={() => setVisible((prev) => !prev)}
          className="pointer-events-auto flex items-center text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
        >
          {visible ? <EyeOffRegular className="h-4 w-4" /> : <EyeRegular className="h-4 w-4" />}
        </button>
      }
    />
  );
}

// 复制到剪贴板（对应参考里的 copy 工具）。
export async function copyText(value: unknown, tip?: string): Promise<boolean> {
  const tipText = tip ?? tl("已复制");
  const text = String(value ?? "").trim();
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      message.success(tipText);
      return true;
    }
  } catch {
    /* fallthrough */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "true");
    el.className = "fixed left-0 top-0 h-px w-px opacity-0 pointer-events-none";
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, el.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    if (ok) {
      message.success(tipText);
      return true;
    }
  } catch {
    /* fallthrough */
  }
  message.warning(tl("浏览器限制，复制失败，请手动复制"));
  return false;
}

// FieldRow：label 在左、值在右（等宽/可复制），对应参考里的 FieldRow 组件。
export function FieldRow({
  label,
  value,
  monospace,
  copyable,
  placeholder,
  children,
}: {
  label: ReactNode;
  value?: unknown;
  monospace?: boolean;
  copyable?: boolean;
  placeholder?: string;
  children?: ReactNode;
}) {
  const text = (value === null || value === undefined ? "" : String(value)).trim() || placeholder || "--";
  const canCopy = !!copyable && !!text && text !== "--" && text !== "---";
  const title = text === "--" || text === "---" ? "" : text;
  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <span className="shrink-0 whitespace-nowrap text-gray-500">{label}</span>
      {children ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
      ) : (
        <div
          className={cx(
            "block min-w-0 max-w-full flex-1 truncate text-right",
            monospace && "font-mono",
            canCopy && "cursor-pointer hover:underline",
          )}
          title={title}
          onClick={() => void (canCopy && copyText(text))}
        >
          {text}
        </div>
      )}
    </div>
  );
}

// Field: an iOS form row. The label sits on the leading side and the
// control fills the rest of the row, borderless, like Settings > Wi-Fi >
// Configure Proxy. Consecutive rows share hairline separators; multi-line
// controls (textarea, lists) stack under their label.
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("ios-form-row", className)}>
      <label className="ios-form-label">{label}</label>
      <div className="ios-form-control">
        {children}
        {hint ? <div className="ios-form-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

// 渠道头部：左侧标题，右侧可选操作 + 启用开关。
export function ChannelHeader({
  title,
  enabled,
  onToggle,
  actions,
  onClear,
}: {
  title: ReactNode;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  actions?: ReactNode;
  onClear?: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="font-bold text-gray-800 dark:text-gray-100">{title}</div>
      </div>
      <div className="flex items-center gap-2">
        {onClear ? <button type="button" onClick={onClear} className="px-2 ios-subhead font-medium text-sys-red hover:opacity-70">{tl("清空配置")}</button> : null}
        {actions}
        <Switch checked={enabled} onChange={onToggle} />
      </div>
    </div>
  );
}

// 空态虚线提示行。
export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/30 py-2 text-center text-xs text-gray-400 dark:border-white/10 dark:bg-white/5">
      {children}
    </div>
  );
}

// 分段式选项卡（对应参考里的 .settings-notify-tabs：圆角胶囊容器 + 高亮活动项）。
export function SegmentedTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: string; label: ReactNode }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-grouped p-1 dark:bg-white/5">
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cx(
              "h-[38px] shrink-0 whitespace-nowrap rounded-full px-5 text-sm font-medium outline-none",
              "transition-[background-color,color,box-shadow,transform] duration-[340ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
              "active:scale-[0.97]",
              active
                ? "bg-white font-semibold text-accent shadow-[0_4px_20px_rgba(0,0,0,0.08)] dark:bg-white/10"
                : "text-label-2 hover:text-label dark:text-gray-400",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function NotificationDeviceScope({ value, onChange, devices, failed, title, hint, className }: {
  value: string[] | null;
  onChange: (ids: string[] | null) => void;
  devices: Pick<DeviceListItem, "id" | "name">[] | null;
  failed: boolean;
  title?: string;
  hint?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const label = title ?? t("仅推送指定设备");
  const available = devices ?? [];
  // Unknown/offline IDs remain selectable; loading never rewrites the draft.
  const choices = [...available, ...(value ?? []).filter((id) => !available.some((device) => device.id === id))
    .map((id) => ({ id, name: "" }))];
  return (
    <div className={className ?? "mt-6 space-y-3 border-t border-gray-200 pt-4 text-sm dark:border-white/10"}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="break-all font-medium text-gray-800 dark:text-gray-100">{label}</div>
          <p className="mt-1 text-xs text-gray-500">{hint ?? t("关闭时推送全部设备的通知。")}</p>
        </div>
        <Switch checked={value !== null} onChange={enabled => onChange(enabled ? [] : null)} ariaLabel={label} />
      </div>
      {value !== null ? <>
        {failed ? <p className="text-xs text-amber-600 dark:text-amber-400">{t("设备列表加载失败，已保留适用设备范围。")}</p> : devices === null ? (
          <p className="text-xs text-gray-500">{t("正在加载设备…")}</p>
        ) : null}
        <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto p-1">
          {choices.map((device) => {
            const selected = value.includes(device.id);
            return (
              <Button key={device.id} size="small" plain variant={selected ? "primary" : "default"}
                className={cx("!rounded-md !shadow-none !transition-colors", !selected && "!px-5")} title={device.id} aria-pressed={selected}
                icon={selected ? <CheckmarkRegular className="h-3 w-3" /> : undefined}
                onClick={() => onChange(selected ? value.filter(id => id !== device.id) : [...value, device.id])}>
                {device.name || device.id}
              </Button>
            );
          })}
        </div>
      </> : null}
    </div>
  );
}

// URL 列表编辑器（Webhook / Bark 目标 URLs）。
export function UrlListEditor({
  urls,
  onChange,
  enabled,
  placeholder,
  emptyText,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  enabled: boolean;
  placeholder: string;
  emptyText: string;
}) {
  const { t } = useI18n();
  const add = () => onChange([...(urls || []), ""]);
  const remove = (index: number) => onChange((urls || []).filter((_, i) => i !== index));
  const update = (index: number, value: string) =>
    onChange((urls || []).map((item, i) => (i === index ? value : item)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className={LABEL_CLASS}>{t("目标 URLs")}</label>
        <Button size="small" variant="primary" plain onClick={add} disabled={!enabled} icon={<AddRegular />}>
          {t("添加 URL")}
        </Button>
      </div>
      {!urls || urls.length === 0 ? <EmptyLine>{emptyText}</EmptyLine> : null}
      {(urls || []).map((url, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={url}
            onChange={(e) => update(index, e.target.value)}
            disabled={!enabled}
            placeholder={placeholder}
            className="flex-1"
          />
          <Button variant="danger" plain onClick={() => remove(index)} disabled={!enabled} aria-label={t("删除")} icon={<DeleteRegular />} />
        </div>
      ))}
    </div>
  );
}
