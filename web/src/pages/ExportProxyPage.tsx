import { useCallback, useEffect, useMemo, useState } from "react";
import { AddRegular, DeleteRegular, EditRegular, GlobeRegular, MoreHorizontalRegular } from "@fluentui/react-icons";
import { api, apiMessage } from "../api";
import type { DeviceListItem, DevicesResponse } from "../types";
import { Button, Input, ListSkeleton, Modal, PageFrame, PageHeader, Select, Switch, confirmDialog, message } from "../components/ui";
import { ContentUnavailable, ContextMenu, ListRow, ListSection } from "../components/ios";
import { Field, ToggleRow } from "../components/proxy/formUi";
import { useI18n } from "../lib/i18n";

interface ExportProxyConfig {
  id: string;
  name: string;
  deviceId: string;
  interface: string;
  mode: "http" | "socks5";
  listenHost: string;
  listenPort: number;
  enabled: boolean;
  authEnabled: boolean;
  username: string;
  password: string;
}

interface ExportProxyStatus {
  id: string;
  running: boolean;
  listen?: string;
  error?: string;
}

const emptyConfig = (): ExportProxyConfig => ({
  id: "",
  name: "",
  deviceId: "",
  interface: "",
  mode: "socks5",
  listenHost: "0.0.0.0",
  listenPort: 1080,
  enabled: true,
  authEnabled: false,
  username: "",
  password: "",
});

export default function ExportProxyPage() {
  const { t } = useI18n();
  const [configs, setConfigs] = useState<ExportProxyConfig[]>([]);
  const [statuses, setStatuses] = useState<ExportProxyStatus[]>([]);
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ExportProxyConfig>(emptyConfig);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const [configData, statusData, deviceData] = await Promise.all([
        api<{ configs?: ExportProxyConfig[] }>("/export-proxies"),
        api<{ configs?: ExportProxyStatus[] }>("/export-proxies/status"),
        api<DevicesResponse>("/devices"),
      ]);
      setConfigs(configData.configs || []);
      setStatuses(statusData.configs || []);
      setDevices((deviceData.devices || []).filter((device) => !!device.interface));
      setError("");
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const statusByID = useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses]);
  const deviceByID = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuConfig = configs.find((config) => config.id === menu?.id);

  const edit = (config?: ExportProxyConfig) => {
    if (config) {
      setForm({ ...config, password: "" });
    } else {
      const first = devices[0];
      setForm({ ...emptyConfig(), deviceId: first?.id || "", interface: first?.interface || "" });
    }
    setOpen(true);
  };

  const chooseDevice = (deviceId: string) => {
    const device = deviceByID.get(deviceId);
    setForm((current) => ({ ...current, deviceId, interface: device?.interface || "" }));
  };

  const save = async () => {
    if (!form.deviceId) return message.warning(t("请选择设备"));
    if (!form.listenPort || form.listenPort < 1 || form.listenPort > 65535) return message.warning(t("请输入有效端口"));
    if (form.authEnabled && !form.username.trim()) return message.warning(t("启用认证后必须填写用户名"));
    setSaving(true);
    try {
      if (form.id) {
        await api(`/export-proxies/${encodeURIComponent(form.id)}`, { method: "PUT", body: form });
        message.success(t("导出代理已更新"));
      } else {
        await api("/export-proxies", { method: "POST", body: form });
        message.success(t("导出代理已创建"));
      }
      setOpen(false);
      await load();
    } catch (err) {
      message.error(apiMessage(err) || t("保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (config: ExportProxyConfig) => {
    setBusy(config.id);
    try {
      await api(`/export-proxies/${encodeURIComponent(config.id)}`, {
        method: "PUT",
        body: { ...config, enabled: !config.enabled },
      });
      await load();
    } catch (err) {
      message.error(apiMessage(err));
    } finally {
      setBusy("");
    }
  };

  const remove = async (config: ExportProxyConfig) => {
    if (!await confirmDialog(t("确定删除这个导出代理配置吗？"), t("确认删除"), { type: "warning", confirmText: t("删除"), cancelText: t("取消") })) return;
    setBusy(config.id);
    try {
      await api(`/export-proxies/${encodeURIComponent(config.id)}`, { method: "DELETE" });
      message.success(t("导出代理已删除"));
      await load();
    } catch (err) {
      message.error(apiMessage(err));
    } finally {
      setBusy("");
    }
  };

  return (
    <PageFrame>
      <PageHeader
        title={t("导出代理")}
        subtitle={t("将模块漫游数据导出为主机 HTTP 或 SOCKS5 代理")}
        actions={<Button variant="primary" icon={<AddRegular />} onClick={() => edit()} disabled={!devices.length}>{t("添加代理")}</Button>}
      />

      {error ? (
        <div className="mb-4 rounded-[var(--radius-lg)] bg-sys-red/10 px-4 py-3 ios-subhead text-sys-red">{error}</div>
      ) : null}
      {loading && !configs.length ? (
        <ListSkeleton rows={2} />
      ) : !configs.length ? (
        <ContentUnavailable
          icon={<GlobeRegular />}
          title={t("暂无导出代理配置")}
          description={t("先在设备页面开启漫游数据，再创建代理")}
        />
      ) : (
        <ListSection header={t("导出代理")}>
          {configs.map((config) => {
            const status = statusByID.get(config.id);
            const device = deviceByID.get(config.deviceId);
            const state = status?.running ? t("运行中") : status?.error ? t("错误") : t("已停用");
            const tone = status?.running ? "text-sys-green" : status?.error ? "text-sys-red" : "text-label-3";
            return (
              <ListRow
                key={config.id}
                icon={<GlobeRegular />}
                iconColor={status?.running ? "green" : status?.error ? "red" : "gray"}
                onClick={() => edit(config)}
                chevron={false}
                multiline
                swipeActions={[{ label: t("删除"), color: "rgb(var(--ios-red))", onAction: () => void remove(config) }]}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ id: config.id, x: event.clientX, y: event.clientY });
                }}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold">{config.name}</span>
                    <span className="shrink-0 rounded-full bg-accent/15 px-2 py-px ios-caption font-semibold text-accent">{config.mode.toUpperCase()}</span>
                  </span>
                }
                subtitle={
                  <>
                    <span className="font-mono">{status?.listen || `${config.listenHost}:${config.listenPort}`}</span>
                    {" · "}
                    {device?.name || config.deviceId} · <span className="font-mono">{config.interface}</span>
                    <br />
                    <span className={tone}>{state}</span>
                    {config.authEnabled ? <> · {t("认证")} {config.username}</> : null}
                    {status?.error ? <span className="block text-sys-red">{status.error}</span> : null}
                  </>
                }
                accessory={
                  <span className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      aria-label={t("更多操作")}
                      title={t("更多操作")}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-accent hover:bg-fill-4 [&_svg]:h-5 [&_svg]:w-5"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setMenu({ id: config.id, x: rect.right, y: rect.bottom });
                      }}
                    >
                      <MoreHorizontalRegular />
                    </button>
                    <Switch checked={config.enabled} loading={busy === config.id} onChange={() => void toggle(config)} />
                  </span>
                }
              />
            );
          })}
        </ListSection>
      )}
      <ContextMenu
        open={Boolean(menuConfig)}
        anchor={menu}
        onClose={() => setMenu(null)}
        title={menuConfig?.name}
        items={menuConfig ? [
          { label: t("编辑"), icon: <EditRegular />, onSelect: () => edit(menuConfig) },
          { label: t("删除"), icon: <DeleteRegular />, destructive: true, onSelect: () => void remove(menuConfig) },
        ] : []}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? t("编辑导出代理") : t("添加导出代理")}
        footer={<><Button onClick={() => setOpen(false)}>{t("取消")}</Button><Button variant="primary" loading={saving} onClick={() => void save()}>{t("保存")}</Button></>}
      >
        <div className="space-y-4">
          <Field label={t("名称")}><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={t("例如：EC20 漫游出口")} /></Field>
          <Field label={t("目标设备")}><Select value={form.deviceId} onChange={chooseDevice} options={devices.map((device) => ({ value: device.id, label: `${device.name || device.id} · ${device.interface}` }))} /></Field>
          <Field label={t("网络接口")}><Input value={form.interface} readOnly disabled /></Field>
          <Field label={t("协议")}><Select value={form.mode} onChange={(value) => setForm({ ...form, mode: value as "http" | "socks5" })} options={[{ value: "socks5", label: "SOCKS5" }, { value: "http", label: "HTTP" }]} /></Field>
          <Field label={t("监听地址")}><Input value={form.listenHost} onChange={(event) => setForm({ ...form, listenHost: event.target.value })} /></Field>
          <Field label={t("端口")}><Input type="number" min={1} max={65535} value={form.listenPort} onChange={(event) => setForm({ ...form, listenPort: Number(event.target.value) })} /></Field>
        </div>
        <div className="mt-6 space-y-4">
          <ToggleRow title={t("代理认证")} subtitle={t("连接代理时需要用户名和密码")} checked={form.authEnabled} onChange={(authEnabled) => setForm({ ...form, authEnabled })} />
          {form.authEnabled ? <>
            <Field label={t("用户名")}><Input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="off" /></Field>
            <Field label={t("密码")}><Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" placeholder={form.id ? t("留空则保留原密码") : t("必填")} /></Field>
          </> : null}
        </div>
        <div className="mt-6 space-y-4">
          <ToggleRow title={t("保存后立即启用")} subtitle={t("关闭后只保存配置，不开始监听")} checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} />
        </div>
      </Modal>
    </PageFrame>
  );
}
