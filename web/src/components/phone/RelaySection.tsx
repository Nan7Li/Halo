import { useCallback, useEffect, useState } from "react";
import { AddRegular, CloudRegular, CodeRegular, DeleteRegular, PhoneRegular } from "@fluentui/react-icons";
import { api, apiMessage } from "../../api";
import { useI18n } from "../../lib/i18n";
import { ListRow, ListSection, Sheet } from "../ios";
import { Button, Input } from "../ui";
import { message } from "../ui/message";
import { confirmDialog } from "../ui/MessageBox";
import { copyText } from "../devices/shared";

interface RelayStatus {
  configured: boolean;
  available: boolean;
  host?: string;
  port: number;
  subnet: string;
  nasAddress?: string;
  vpsAddress?: string;
  vpsPublicKey?: string;
  running: boolean;
  connected: boolean;
  latestHandshake?: string;
  error?: string;
  peers: { id: string; name: string; address: string; createdAt: string }[] | null;
}

const BASE = "/airsim-agent/relay";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * VPS relay: Halo keeps a WireGuard tunnel to a VPS so the iPhone can reach
 * it without a public IP at home, through a proxy node on the VPS or a
 * WireGuard peer.
 */
export function RelaySection({ pairPort }: { pairPort: number }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<{ title: string; file: string; body: string; hint: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<RelayStatus>(BASE));
    } catch (error) {
      message.error(apiMessage(error));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Until the VPS answers, watch for the first handshake.
  useEffect(() => {
    if (!status?.configured || status.connected) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [status?.configured, status?.connected, load]);

  const run = async (work: () => Promise<RelayStatus>) => {
    setBusy(true);
    try {
      const next = await work();
      setStatus(next);
      return next;
    } catch (error) {
      message.error(apiMessage(error));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const showScript = async () => {
    try {
      const { message: body } = await api<{ message: string }>(`${BASE}/script`);
      setText({
        title: t("VPS 安装脚本"),
        file: "halo-relay.sh",
        body,
        hint: t("用 root 在 VPS 上运行：保存为 halo-relay.sh 后执行 bash halo-relay.sh。可以重复运行；添加或删除设备后需要再运行一次。脚本里有私钥，不要发给别人。"),
      });
    } catch (error) {
      message.error(apiMessage(error));
    }
  };

  const showPeer = async (peer: { id: string; name: string }) => {
    try {
      const { message: body } = await api<{ message: string }>(`${BASE}/peers/${encodeURIComponent(peer.id)}/config`);
      setText({
        title: peer.name,
        file: `${peer.name.replace(/[^\w-]+/g, "_") || "halo"}.conf`,
        body,
        hint: t("导入 WireGuard App，或在小火箭里添加 WireGuard 节点照着填。只有隧道网段走这条隧道。"),
      });
    } catch (error) {
      message.error(apiMessage(error));
    }
  };

  const addPeer = async () => {
    const next = await run(() => api<RelayStatus>(`${BASE}/peers`, { method: "POST", body: { name: "iPhone" } }));
    if (next) message.success(t("已添加。请在 VPS 上重新运行安装脚本。"));
  };

  const removePeer = async (peer: { id: string; name: string }) => {
    const ok = await confirmDialog(t("删除后请在 VPS 上重新运行安装脚本。"), `${t("删除")} ${peer.name}`, {
      confirmText: t("删除"),
      confirmVariant: "danger",
      type: "danger",
    });
    if (ok) await run(() => api<RelayStatus>(`${BASE}/peers/${encodeURIComponent(peer.id)}`, { method: "DELETE" }));
  };

  const remove = async () => {
    const ok = await confirmDialog(t("Halo 会关闭到 VPS 的隧道并删除密钥。VPS 上的配置需要自己删除（/etc/wireguard/halo.conf）。"), t("移除 VPS 中继"), {
      confirmText: t("移除"),
      confirmVariant: "danger",
      type: "danger",
    });
    if (ok) await run(() => api<RelayStatus>(BASE, { method: "DELETE" }));
  };

  if (!status) return null;
  const peers = status.peers ?? [];
  const state = status.connected
    ? { label: t("已连接"), color: "text-sys-green" }
    : status.running
      ? { label: t("等待 VPS"), color: "text-sys-orange" }
      : { label: t("未运行"), color: "text-sys-red" };

  return (
    <>
      <ListSection
        header={t("远程连接（VPS 中继）")}
        footer={
          status.error ? (
            <span className="text-sys-red">{status.error}</span>
          ) : status.configured ? (
            <>
              {t("AirSIM 选「私网 IP」，填")} <b>{status.nasAddress}</b> {t("和端口")} {pairPort}
              {t("。在小火箭里加规则")} <code>IP-CIDR,{status.subnet},{t("你的 VPS 节点")}</code>
              {t("，并从 skip-proxy 和 tun-excluded-routes 里去掉 10.0.0.0/8。VPS 上的代理服务端不能屏蔽私网地址。")}
            </>
          ) : !status.available ? (
            t("这台 NAS 没有安装 WireGuard（wg、ip），无法建立隧道。")
          ) : (
            t("家里没有公网 IP 时，Halo 主动连到你的 VPS，iPhone 通过 VPS 上的代理节点或 WireGuard 连回 Halo。")
          )
        }
      >
        {status.configured ? (
          <>
            <ListRow
              icon={<CloudRegular />}
              iconColor="blue"
              title="VPS"
              subtitle={`${status.host}:${status.port}`}
              detail={<span className={state.color}>{state.label}</span>}
              onClick={() => setEditing(true)}
            />
            <ListRow title={t("NAS 隧道地址")} detail={status.nasAddress} onClick={() => void copyText(status.nasAddress)} />
            <ListRow icon={<CodeRegular />} iconColor="gray" title={t("VPS 安装脚本")} onClick={() => void showScript()} />
          </>
        ) : (
          <ListRow
            icon={<CloudRegular />}
            iconColor="blue"
            title={t("设置 VPS 中继")}
            disabled={!status.available}
            onClick={status.available ? () => setEditing(true) : undefined}
          />
        )}
      </ListSection>

      {status.configured ? (
        <ListSection
          header={t("WireGuard 设备")}
          footer={t("用代理节点连接时不需要添加。只有 iPhone 直接用 WireGuard（App 或小火箭的 WireGuard 节点）时才添加。")}
        >
          {peers.map((peer) => (
            <ListRow
              key={peer.id}
              icon={<PhoneRegular />}
              iconColor="indigo"
              title={peer.name}
              subtitle={peer.address}
              onClick={() => void showPeer(peer)}
              swipeActions={[{ label: t("删除"), color: "rgb(var(--ios-red))", onAction: () => void removePeer(peer) }]}
              accessory={
                <button type="button" className="ios-press p-1 text-sys-red" aria-label={t("删除")} onClick={(event) => { event.stopPropagation(); void removePeer(peer); }}>
                  <DeleteRegular className="h-5 w-5" />
                </button>
              }
            />
          ))}
          <ListRow icon={<AddRegular />} iconColor="green" title={t("添加设备")} onClick={busy ? undefined : () => void addPeer()} />
        </ListSection>
      ) : null}

      {status.configured ? (
        <ListSection>
          <ListRow title={t("移除 VPS 中继")} destructive onClick={busy ? undefined : () => void remove()} />
        </ListSection>
      ) : null}

      <RelaySheet
        open={editing}
        status={status}
        busy={busy}
        onClose={() => setEditing(false)}
        onSave={async (body) => {
          const next = await run(() => api<RelayStatus>(BASE, { method: "PUT", body }));
          if (!next) return;
          setEditing(false);
          if (next.error) message.error(next.error);
          else if (!status.configured) void showScript();
        }}
      />

      <Sheet
        open={!!text}
        onClose={() => setText(null)}
        title={text?.title ?? ""}
        footer={
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => text && void copyText(text.body)}>{t("复制")}</Button>
            <Button variant="primary" className="flex-1" onClick={() => text && download(text.file, text.body)}>{t("下载")}</Button>
          </div>
        }
      >
        <p className="ios-footnote text-label-2 px-1 pb-2">{text?.hint}</p>
        <pre className="max-h-[50vh] overflow-auto rounded-xl bg-fill-3 p-3 font-mono text-[12px] leading-snug text-label whitespace-pre select-all">{text?.body}</pre>
      </Sheet>
    </>
  );
}

function RelaySheet({
  open,
  status,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  status: RelayStatus;
  busy: boolean;
  onClose: () => void;
  onSave: (body: { host: string; port: number; subnet: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [subnet, setSubnet] = useState("");
  useEffect(() => {
    if (!open) return;
    setHost(status.host ?? "");
    setPort(String(status.port || 51820));
    setSubnet(status.subnet || "10.8.0.0/24");
  }, [open, status]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("VPS 中继")}
      footer={
        <Button variant="primary" className="w-full" loading={busy} disabled={busy || !host.trim()} onClick={() => void onSave({ host: host.trim(), port: Number(port), subnet: subnet.trim() })}>
          {status.configured ? t("保存") : t("连接并生成脚本")}
        </Button>
      }
    >
      <div className="ios-form-row"><label className="ios-form-label">{t("VPS 地址")}</label><div className="ios-form-control"><Input value={host} placeholder="203.0.113.10 / vps.example.com" autoComplete="off" onChange={(event) => setHost(event.target.value)} /></div></div>
      <div className="ios-form-row"><label className="ios-form-label">{t("UDP 端口")}</label><div className="ios-form-control"><Input value={port} inputMode="numeric" onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))} /></div></div>
      <div className="ios-form-row"><label className="ios-form-label">{t("隧道网段")}</label><div className="ios-form-control"><Input value={subnet} autoComplete="off" onChange={(event) => setSubnet(event.target.value)} /></div></div>
      <p className="ios-form-hint ios-footnote text-label-2">
        {t("Halo 会生成密钥并马上连接 VPS，然后给你一个在 VPS 上运行的安装脚本。网段不要和家里或 VPS 的局域网重叠：VPS 用 .1，NAS 用 .2。云服务商的安全组要放行这个 UDP 端口。")}
      </p>
    </Sheet>
  );
}
