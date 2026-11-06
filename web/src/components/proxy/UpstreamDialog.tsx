import { Button, Input, Modal } from "../ui";
import { Field, SectionHeader, ToggleRow } from "./formUi";
import { ipv6Hint, type UpstreamForm, type UpstreamProbeResult } from "./shared";
import { tl, useI18n } from "../../lib/i18n";

export interface UpstreamDialogProps {
  open: boolean;
  editing: boolean;
  form: UpstreamForm;
  testing: boolean;
  probe: UpstreamProbeResult | null;
  onPatch: (patch: Partial<UpstreamForm>) => void;
  onTest: () => void;
  onClose: () => void;
  onSubmit: () => void;
}

type ProbeState = "ok" | "fail" | "pending";

function ProbeRow({ state, label, detail }: { state: ProbeState; label: string; detail?: string }) {
  const dot = state === "ok" ? "bg-sys-green" : state === "fail" ? "bg-sys-red" : "bg-label-3";
  const text = state === "ok" ? "text-sys-green" : state === "fail" ? "text-sys-red" : "text-label-3";
  return (
    <div className="ios-form-row items-center">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 ios-body text-label">{label}</span>
      {detail ? <span className={`shrink-0 truncate ios-subhead ${text}`}>{detail}</span> : null}
    </div>
  );
}

function authMethodLabel(method?: string): string {
  if (method === "none") return tl("免鉴权");
  if (method === "username_password") return tl("用户名密码");
  return method || "";
}

function ProbeResultPanel({ probe }: { probe: UpstreamProbeResult }) {
  const { t } = useI18n();
  const reachable = !!probe.reachable;
  const handshakeOk = !!probe.handshakeOk;
  const associateOk = !!probe.udpAssociateOk;
  const udpOk = !!probe.udpExchangeOk;
  const handshakeState: ProbeState = !reachable ? "pending" : handshakeOk ? "ok" : "fail";
  const associateState: ProbeState = !handshakeOk ? "pending" : associateOk ? "ok" : "fail";
  const udpState: ProbeState = !associateOk ? "pending" : udpOk ? "ok" : "fail";
  return (
    <div className="rounded-[var(--radius-lg)] bg-grouped-2 px-4 pb-2">
      <ProbeRow state={reachable ? "ok" : "fail"} label={t("TCP 连接")} detail={reachable ? t("可连通") : t("无法连接")} />
      <ProbeRow state={handshakeState} label={t("SOCKS5 握手")} detail={handshakeOk ? authMethodLabel(probe.authMethod) : undefined} />
      <ProbeRow
        state={associateState}
        label={t("UDP Associate（VoWiFi 依赖）")}
        detail={associateState === "pending" ? undefined : associateOk ? t("已建立") : t("不支持")}
      />
      <ProbeRow
        state={udpState}
        label={t("真实 UDP DNS 往返")}
        detail={udpState === "pending" ? undefined : udpOk ? `${probe.roundTripMs || 0} ms` : t("无返回")}
      />
      {probe.relayAddr ? (
        <div className="pt-2 ios-footnote text-label-2">
          {t("UDP 中继地址：")}<span className="font-mono">{probe.relayAddr}</span>
        </div>
      ) : null}
      {probe.dnsName && probe.dnsServer ? (
        <div className="pt-1 ios-footnote text-label-2">
          {t("UDP 测试：")}<span className="font-mono">{probe.dnsName} @ {probe.dnsServer}</span>
        </div>
      ) : null}
      {probe.hint ? <div className="pt-1 ios-footnote text-label-2">{probe.hint}</div> : null}
      {probe.error ? <div className="break-all pt-1 ios-footnote text-sys-red">{probe.error}</div> : null}
    </div>
  );
}

export function UpstreamDialog({ open, editing, form, testing, probe, onPatch, onTest, onClose, onSubmit }: UpstreamDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t("编辑前置代理") : t("新增前置代理")}
      footer={
        <>
          <Button className="mr-auto" onClick={onTest} loading={testing} disabled={testing || !form.addr.trim()}>
            {t("检测连通性")}
          </Button>
          <Button onClick={onClose}>{t("取消")}</Button>
          <Button variant="primary" onClick={onSubmit} loading={testing} disabled={testing}>
            {editing ? t("更新") : t("创建")}
          </Button>
        </>
      }
    >
      <div className="space-y-6 pb-6">
        <div className="space-y-4">
          <SectionHeader tone="indigo" title={t("代理信息")} />
          <div className="space-y-4">
            <Field label={t("代理 ID")}>
              <Input value={form.id} disabled={editing} placeholder={t("唯一标识，如 jp-proxy-01")} onChange={(e) => onPatch({ id: e.target.value })} />
            </Field>
            <Field label={t("名称")}>
              <Input value={form.name} placeholder={t("例如：日本代理")} onChange={(e) => onPatch({ name: e.target.value })} />
            </Field>
          </div>
          <Field label={t("Socks5 地址")}>
            <Input
              value={form.addr}
              placeholder={t("host:port，例如 1.2.3.4:1080 或 [2001:db8::1]:1080")}
              onChange={(e) => onPatch({ addr: e.target.value })}
            />
            <div className="ios-form-hint">
              {t("VoWiFi 通过此 Socks5 代理连接运营商，实现跨区域本地 VoWiFi。")}
              {ipv6Hint()}
              {t("。点下方「检测连通性」可在保存前验证 Socks5 握手与 UDP Associate。")}
            </div>
          </Field>
          <ToggleRow
            title={t("启用代理")}
            subtitle={t("禁用后，已绑定 Profile 的 VoWiFi 将停止使用该线路，不会泄漏到直连")}
            checked={form.enabled}
            onChange={(v) => onPatch({ enabled: v })}
          />
        </div>
        <div className="space-y-4">
          <SectionHeader tone="amber" title={t("鉴权设置（可选）")} />
          <div className="space-y-4">
            <Field label={t("用户名")}>
              <Input value={form.username} placeholder={t("留空则免鉴权")} onChange={(e) => onPatch({ username: e.target.value })} />
            </Field>
            <Field label={t("密码")}>
              <Input type="password" value={form.password} placeholder={t("留空则免鉴权")} onChange={(e) => onPatch({ password: e.target.value })} />
              <div className="ios-form-hint">{t("编辑已有代理时留空会保持原密码不变。")}</div>
            </Field>
          </div>
        </div>
        {probe ? (
          <div className="space-y-3">
            <SectionHeader tone={probe.udpExchangeOk ? "green" : "amber"} title={t("连通性检测结果")} />
            <ProbeResultPanel probe={probe} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
