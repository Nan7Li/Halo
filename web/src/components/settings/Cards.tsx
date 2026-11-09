import type { ReactNode } from "react";
import {
  AlertRegular,
  CheckmarkRegular,
  KeyRegular,
} from "@fluentui/react-icons";
import type { AutoUpdateSettings, SystemInfo, UpstreamVocatStatus } from "../../types";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { Select } from "../ui/Select";
import { Field, PasswordInput, copyText } from "./controls";
import { ListSection } from "../ios";
import { cx } from "../../lib/utils";

export interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface UpdateInfo {
  hasUpdate?: boolean;
  latestVersion?: string;
  releaseNote?: string;
  isDocker?: boolean;
}

function CardDecor() {
  return null;
}

function updateChannelLabel(channel: string | undefined, t: (value: string) => string) {
  if (channel === "cellbridge") return `${t("融合版")} · cellbridge`;
  if (channel === "stable") return `${t("稳定版")} · stable`;
  return channel || "";
}

function waitingForCall(message: string) {
  return message.includes("已推迟安装") || message.toLowerCase().includes("postponed until the call ends");
}

function CardIcon({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <div
      className={
        small
          ? "ios-card-icon is-small"
          : "ios-card-icon"
      }
    >
      {children}
    </div>
  );
}

function CardTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-[17px] font-semibold tracking-tight text-black dark:text-white">{title}</h3>
      <p className="text-[13px] text-black/40 dark:text-white/45">{subtitle}</p>
    </div>
  );
}


export function SecurityCard({
  value,
  onChange,
  loading,
  onSubmit,
}: {
  value: PasswordForm;
  onChange: (patch: Partial<PasswordForm>) => void;
  loading: boolean;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="ui-card group relative overflow-hidden p-8">
      <CardDecor />
      <div className="relative z-10 mb-6 flex items-center gap-3">
        <CardIcon>
          <KeyRegular className="text-[24px]" />
        </CardIcon>
        <CardTitle title={t("安全")} subtitle={t("更新访问凭证")} />
      </div>
      <div className="relative z-10">
        <Field label={t("当前密码")}>
          <PasswordInput
            placeholder={t("必填")}
            autoComplete="current-password"
            value={value.oldPassword}
            onChange={(oldPassword) => onChange({ oldPassword })}
          />
        </Field>
        <Field label={t("新密码")}>
          <PasswordInput
            placeholder={t("必填")}
            autoComplete="new-password"
            value={value.newPassword}
            onChange={(newPassword) => onChange({ newPassword })}
          />
        </Field>
        <Field label={t("确认新密码")}>
          <PasswordInput
            placeholder={t("再次输入")}
            autoComplete="new-password"
            value={value.confirmPassword}
            onChange={(confirmPassword) => onChange({ confirmPassword })}
          />
        </Field>
        <div className="pt-4">
          <Button variant="primary" loading={loading} onClick={onSubmit} className="w-full !border-0" icon={<CheckmarkRegular />}>
            {t("更新凭证")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SystemInfoCard({
  info,
  updateInfo,
  checkingUpdate,
  applyingUpdate,
  autoUpdate,
  savingAutoUpdate,
  onCheckUpdate,
  onApplyUpdate,
  onAutoUpdateChange,
  upstream,
  checkingUpstream,
  markingUpstream,
  onCheckUpstream,
  onMarkUpstreamSynced,
}: {
  info: SystemInfo;
  updateInfo: UpdateInfo | null;
  checkingUpdate: boolean;
  applyingUpdate: boolean;
  autoUpdate: AutoUpdateSettings | null;
  savingAutoUpdate: boolean;
  onCheckUpdate: () => void;
  onApplyUpdate: () => void;
  onAutoUpdateChange: (patch: Partial<AutoUpdateSettings>) => void;
  upstream: UpstreamVocatStatus | null;
  checkingUpstream: boolean;
  markingUpstream: boolean;
  onCheckUpstream: () => void;
  onMarkUpstreamSynced: () => void;
}) {
  const { t } = useI18n();
  const valueRow = (label: ReactNode, value: unknown, opts: { mono?: boolean; copy?: boolean } = {}) => {
    const text = (value === null || value === undefined ? "" : String(value)).trim() || "—";
    const canCopy = !!opts.copy && text !== "—";
    return (
      <div className="ios-form-row items-center">
        <span className="shrink-0 ios-body text-label">{label}</span>
        <span
          className={cx("min-w-0 flex-1 truncate text-right ios-body text-label-2", opts.mono && "font-mono ios-subhead", canCopy && "cursor-pointer")}
          title={canCopy ? `${text} · ${t("点击复制")}` : text}
          onClick={() => void (canCopy && copyText(text))}
        >
          {text}
        </span>
      </div>
    );
  };
  const switchRow = (title: string, subtitle: string, checked: boolean, disabled: boolean, onChange: (value: boolean) => void) => (
    <div className="ios-form-row items-center">
      <span className="min-w-0 flex-1 py-1">
        <span className="block ios-body text-label">{title}</span>
        <span className="mt-0.5 block ios-footnote text-label-2">{subtitle}</span>
      </span>
      <Switch checked={checked} disabled={disabled} loading={savingAutoUpdate} onChange={onChange} />
    </div>
  );
  const lastCheck = autoUpdate?.lastCheckAt
    ? `${t("上次检查")} ${autoUpdate.lastCheckAt.replace("T", " ").replace("Z", " UTC")}${
        autoUpdate.lastError
          ? ` · ${waitingForCall(autoUpdate.lastError) ? `${t("等待通话结束")} · ` : ""}${autoUpdate.lastError}`
          : autoUpdate.lastAvailable
            ? ` · ${t("发现新版本:")} ${autoUpdate.lastVersion || ""}`
            : ` · ${t("当前已是最新版本")}`
      }`
    : "";

  return (
    <div>
      <ListSection
        header={t("软件更新")}
        footer={updateInfo && !updateInfo.hasUpdate ? t("当前已是最新版本") : undefined}
        bodyClassName="px-4"
      >
        <div className="ios-form-row items-center">
          <span className="shrink-0 ios-body text-label">{t("版本")}</span>
          <span className="min-w-0 flex-1 truncate text-right font-mono ios-subhead text-label-2">{info.version || "Unknown"}</span>
          <button type="button" className="shrink-0 ios-body text-accent disabled:opacity-40" disabled={checkingUpdate} onClick={onCheckUpdate}>
            {checkingUpdate ? t("正在检查更新") : t("检查更新")}
          </button>
        </div>
        {valueRow(t("更新通道"), updateChannelLabel(autoUpdate?.channel, t), { mono: true })}
        {valueRow(t("可用版本"), autoUpdate?.lastVersion || updateInfo?.latestVersion, { mono: true })}
        {updateInfo?.hasUpdate ? (
          <div className="ios-form-row flex-col !items-stretch gap-2 py-3">
            <div className="flex items-center gap-2 ios-body font-semibold text-sys-orange">
              <AlertRegular /> {t("发现新版本:")} {updateInfo.latestVersion}
            </div>
            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap ios-footnote text-label-2">
              {updateInfo.releaseNote || t("暂无更新说明")}
            </div>
            <Button variant="primary" loading={applyingUpdate} onClick={onApplyUpdate} className="w-full !border-0">
              {applyingUpdate ? t("正在更新...") : t("立即更新并重启")}
            </Button>
          </div>
        ) : null}
      </ListSection>

      <ListSection
        header={t("自动更新")}
        footer={
          <>
            {lastCheck ? <span className="block">{lastCheck}</span> : autoUpdate?.lastError ? (
              <span className="block text-sys-orange">{waitingForCall(autoUpdate.lastError) ? `${t("等待通话结束")} · ` : ""}{autoUpdate.lastError}</span>
            ) : null}
            {autoUpdate?.repository ? <span className="block font-mono">{autoUpdate.repository}</span> : null}
          </>
        }
        bodyClassName="px-4"
      >
        {switchRow(t("自动检查更新"), t("后台定期查询 Halo 发行版"), !!autoUpdate?.enabled, !autoUpdate || savingAutoUpdate, (enabled) => onAutoUpdateChange({ enabled }))}
        {switchRow(t("自动安装并重启"), t("发现新版本后下载校验并替换本机程序"), !!autoUpdate?.apply, !autoUpdate || savingAutoUpdate || !!autoUpdate?.isDocker, (apply) => onAutoUpdateChange({ apply }))}
        <div className="ios-form-row">
          <label className="ios-form-label">{t("检查间隔")}</label>
          <div className="ios-form-control">
            <Select
              value={String(autoUpdate?.intervalHours || 6)}
              disabled={!autoUpdate || savingAutoUpdate}
              onChange={(value) => onAutoUpdateChange({ intervalHours: Number(value) })}
              options={[
                { value: "1", label: t("每 1 小时") },
                { value: "6", label: t("每 6 小时") },
                { value: "12", label: t("每 12 小时") },
                { value: "24", label: t("每 24 小时") },
              ]}
            />
          </div>
        </div>
      </ListSection>

      <ListSection header={t("关于")} bodyClassName="px-4">
        {valueRow(t("构建时间"), info.buildTime, { mono: true })}
        {valueRow(t("配置路径"), info.config, { mono: true, copy: true })}
        {valueRow(t("运行时长"), info.uptime)}
        {valueRow("OS", info.os)}
        {valueRow(t("架构"), info.architecture, { mono: true })}
      </ListSection>

      <ListSection
        header={t("VoCat 上游")}
        footer={
          <>
            {upstream?.lastError ? <span className="block text-sys-red">{upstream.lastError}</span> : null}
            {!upstream?.available && upstream?.lastCheckAt ? <span className="block">{t("官方 VoCat 暂无更新于已同步版本之后")}</span> : null}
            <span className="block">{t("跟踪官方 VoCat 的新功能和说明。GitHub 每 4 小时尝试把官方新版本合进 Halo 并自动编译发布；冲突会开 Issue 而不会覆盖 Halo 自己的改动。本机程序仍从 Nan7Li/VoCat Releases 安装。")}</span>
          </>
        }
        bodyClassName="px-4"
      >
        {valueRow(t("已同步"), upstream?.syncedVersion || "0.2.12", { mono: true })}
        {upstream?.latestVersion ? valueRow(t("官方最新"), upstream.latestVersion, { mono: true }) : null}
        {upstream?.available ? (
          <div className="ios-form-row flex-col !items-stretch gap-2 py-3">
            <div className="ios-body font-semibold text-sys-orange">{t("官方 VoCat 有新内容:")} {upstream.latestVersion}</div>
            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap ios-footnote text-label-2">{upstream.releaseNotes || t("暂无更新说明")}</div>
            {upstream.htmlUrl ? (
              <a className="ios-footnote text-accent" href={upstream.htmlUrl} target="_blank" rel="noreferrer">{upstream.repository}</a>
            ) : null}
            <Button loading={markingUpstream} onClick={onMarkUpstreamSynced} className="w-full">{t("已合并进 Halo")}</Button>
          </div>
        ) : null}
        <button type="button" className="ios-form-row w-full items-center text-left ios-body text-accent disabled:opacity-40" disabled={checkingUpstream} onClick={onCheckUpstream}>
          {checkingUpstream ? t("正在检查…") : t("检查 VoCat")}
        </button>
      </ListSection>

      <p className="px-4 ios-footnote text-label-2">
        {t("Halo 由 Nan7Li 开发。模组、IMS、WiFi Calling、短信、eSIM 和代理核心来自 VoCat，原作者 Vocat Project Authors。")}{" "}
        <a className="text-accent" href="https://github.com/MengMengCode/VoCat" target="_blank" rel="noreferrer">MengMengCode/VoCat</a>
      </p>
    </div>
  );
}

export { CardDecor, CardIcon, CardTitle };
