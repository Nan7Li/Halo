import { useCallback, useEffect, useState } from "react";
import { AddRegular, DeleteRegular, EditRegular, MoreHorizontalRegular, ShieldLockRegular } from "@fluentui/react-icons";
import { ContextMenu, ListRow, ListSection } from "../components/ios";
import { api, apiMessage } from "../api";
import type { WireGuardSnapshot, WireGuardTunnel } from "../types";
import {
  Button,
  EmptyState,
  ListSkeleton,
  Input,
  Modal,
  PageFrame, PageHeader,
  Switch,
  Textarea,
  confirmDialog,
  message,
} from "../components/ui";
import { useI18n } from "../lib/i18n";

const EMPTY_FORM = {
  id: "",
  name: "",
  interface: "",
  config: "",
  autostart: true,
};

function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function WireGuardPage() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<WireGuardSnapshot>({ available: false, tunnels: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuTunnel = snapshot.tunnels.find((tunnel) => tunnel.id === menu?.id);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const data = await api<WireGuardSnapshot>("/wireguard-tunnels");
      setSnapshot({
        available: !!data.available,
        hint: data.hint,
        tunnels: Array.isArray(data.tunnels) ? data.tunnels : [],
      });
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

  function openCreate() {
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(tunnel: WireGuardTunnel) {
    setForm({
      id: tunnel.id,
      name: tunnel.name,
      interface: tunnel.interface,
      config: tunnel.config,
      autostart: tunnel.autostart,
    });
    setOpen(true);
  }

  async function onSave() {
    if (!form.name.trim() || !form.config.trim()) {
      message.error(t("请填写名称和配置"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        interface: form.interface.trim(),
        config: form.config,
        autostart: form.autostart,
      };
      if (form.id) {
        await api(`/wireguard-tunnels/${encodeURIComponent(form.id)}`, { method: "PUT", body: payload });
        message.success(t("隧道已保存"));
      } else {
        await api("/wireguard-tunnels", { method: "POST", body: payload });
        message.success(t("隧道已添加"));
      }
      setOpen(false);
      await load();
    } catch (err) {
      message.error(apiMessage(err) || t("保存隧道失败"));
    } finally {
      setSaving(false);
    }
  }

  async function onToggle(tunnel: WireGuardTunnel) {
    setBusy(tunnel.id);
    try {
      await api(`/wireguard-tunnels/${encodeURIComponent(tunnel.id)}/${tunnel.running ? "down" : "up"}`, { method: "POST" });
      message.success(tunnel.running ? t("隧道已关闭") : t("隧道已连接"));
      await load();
    } catch (err) {
      message.error(apiMessage(err) || t("切换隧道失败"));
    } finally {
      setBusy("");
    }
  }

  async function onDelete(tunnel: WireGuardTunnel) {
    const ok = await confirmDialog(
      t("删除后配置会从本机移除。若隧道正在运行，会先断开。"),
      t("删除 WG 隧道"),
      { confirmText: t("删除"), cancelText: t("取消"), type: "warning" },
    );
    if (!ok) return;
    setBusy(tunnel.id);
    try {
      await api(`/wireguard-tunnels/${encodeURIComponent(tunnel.id)}`, { method: "DELETE" });
      message.success(t("隧道已删除"));
      await load();
    } catch (err) {
      message.error(apiMessage(err) || t("删除隧道失败"));
    } finally {
      setBusy("");
    }
  }

  return (
    <PageFrame>
      <PageHeader
        title={t("WG 隧道")}
        subtitle={t("在本机用 wg-quick 管理 WireGuard 配置，可开机自动拉起")}
        actions={
          <Button variant="primary" icon={<AddRegular />} onClick={openCreate} className="!border-0">
            {t("添加隧道")}
          </Button>
        }
      />

      {!snapshot.available ? (
        <div className="mb-6 rounded-[var(--radius-lg)] bg-sys-orange/15 px-4 py-3 ios-subhead text-sys-orange">
          {snapshot.hint || t("当前主机未安装 WireGuard。Linux 上安装 kmod-wireguard、wg 和 ip 后即可连接。")}
        </div>
      ) : null}

      {loading ? (
        <ListSkeleton rows={2} />
      ) : error ? (
        <div className="rounded-[var(--radius-lg)] bg-sys-red/10 px-4 py-3 ios-subhead text-sys-red">{error}</div>
      ) : snapshot.tunnels.length === 0 ? (
        <EmptyState
          icon={<ShieldLockRegular className="text-[22px]" />}
          title={t("还没有 WG 隧道")}
          subtitle={t("粘贴一份标准 wg-quick 配置即可保存，之后可一键连接或开机自动启动。")}
        />
      ) : (
        <ListSection header={t("隧道")}>
          {snapshot.tunnels.map((tunnel) => (
            <ListRow
              key={tunnel.id}
              icon={<ShieldLockRegular />}
              iconColor={tunnel.running ? "green" : "gray"}
              chevron={false}
              multiline
              onClick={tunnel.external ? undefined : () => openEdit(tunnel)}
              swipeActions={tunnel.external ? undefined : [{ label: t("删除"), color: "rgb(var(--ios-red))", onAction: () => void onDelete(tunnel) }]}
              onContextMenu={tunnel.external ? undefined : (event) => { event.preventDefault(); setMenu({ id: tunnel.id, x: event.clientX, y: event.clientY }); }}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold">{tunnel.name}</span>
                  <span className="shrink-0 font-mono ios-footnote text-label-2">{tunnel.interface}</span>
                </span>
              }
              subtitle={
                <>
                  <span className={tunnel.running ? "text-sys-green" : undefined}>{tunnel.running ? t("已连接") : t("未连接")}</span>
                  {tunnel.external ? ` · ${t("系统隧道")}` : tunnel.autostart ? ` · ${t("开机启动")}` : ""}
                  {tunnel.endpoint ? <> · <span className="font-mono">{tunnel.endpoint}</span></> : null}
                  {tunnel.running ? (
                    <span className="block">
                      {t("流量")} {formatBytes(tunnel.transferRx)} ↓ / {formatBytes(tunnel.transferTx)} ↑{tunnel.peers ? ` · ${tunnel.peers} peer` : ""}
                    </span>
                  ) : null}
                  {tunnel.external ? <span className="block">{t("由路由器网络配置管理")}</span> : null}
                  {tunnel.error ? <span className="block text-sys-red">{tunnel.error}</span> : null}
                </>
              }
              accessory={tunnel.external ? undefined : (
                <span className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    aria-label={t("更多操作")}
                    title={t("更多操作")}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-accent hover:bg-fill-4 [&_svg]:h-5 [&_svg]:w-5"
                    onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ id: tunnel.id, x: rect.right, y: rect.bottom }); }}
                  >
                    <MoreHorizontalRegular />
                  </button>
                  <Switch
                    checked={tunnel.running}
                    loading={busy === tunnel.id}
                    disabled={!snapshot.available && !tunnel.running}
                    onChange={() => void onToggle(tunnel)}
                    ariaLabel={tunnel.running ? t("断开") : t("连接")}
                  />
                </span>
              )}
            />
          ))}
        </ListSection>
      )}
      <ContextMenu
        open={Boolean(menuTunnel)}
        anchor={menu}
        onClose={() => setMenu(null)}
        title={menuTunnel?.name}
        items={menuTunnel ? [
          { label: t("修改"), icon: <EditRegular />, onSelect: () => openEdit(menuTunnel) },
          { label: t("删除"), icon: <DeleteRegular />, destructive: true, onSelect: () => void onDelete(menuTunnel) },
        ] : []}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? t("修改 WG 隧道") : t("添加 WG 隧道")}
        width="max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("取消")}</Button>
            <Button variant="primary" loading={saving} onClick={() => void onSave()} className="!border-0">
              {t("保存")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500">{t("名称")}</label>
            <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Home" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500">{t("网卡名")}</label>
            <Input
              value={form.interface}
              onChange={(event) => setForm((prev) => ({ ...prev, interface: event.target.value }))}
              placeholder="halo0"
            />
            <p className="text-[12px] text-black/40 dark:text-white/45">{t("留空则自动分配 halo0、halo1…")}</p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-black/[0.03] px-3 py-2 dark:bg-white/5">
            <div>
              <div className="text-[13px] font-semibold">{t("开机自动连接")}</div>
              <p className="text-[12px] text-black/40 dark:text-white/45">{t("Halo 启动后会尝试 wg-quick up")}</p>
            </div>
            <Switch checked={form.autostart} onChange={(autostart) => setForm((prev) => ({ ...prev, autostart }))} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500">{t("配置")}</label>
            <Textarea
              rows={14}
              className="font-mono text-[13px]"
              value={form.config}
              onChange={(event) => setForm((prev) => ({ ...prev, config: event.target.value }))}
              placeholder={"[Interface]\nPrivateKey = ...\nAddress = 10.8.0.2/32\n\n[Peer]\nPublicKey = ...\nEndpoint = x.x.x.x:51820\nAllowedIPs = 0.0.0.0/0"}
            />
            <p className="text-[12px] text-black/40 dark:text-white/45">
              {t("使用标准 wg-quick 配置。私钥不会回显到页面；修改时保留 ******** 即可沿用原密钥。")}
            </p>
          </div>
        </div>
      </Modal>
    </PageFrame>
  );
}
