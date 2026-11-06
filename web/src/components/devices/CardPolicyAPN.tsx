import { useCallback, useEffect, useMemo, useState } from "react";
import { apiMessage } from "../../api";
import type { CardPolicy } from "../../types";
import { CheckmarkRegular, DeleteRegular, EditRegular, MoreHorizontalRegular } from "@fluentui/react-icons";
import { Button, Input, Modal, Select, Spinner, confirmDialog, message } from "../ui";
import { ContextMenu } from "../ios";
import { Field, ToggleRow } from "../proxy/formUi";
import { useI18n } from "../../lib/i18n";
import {
  createCardAPN,
  deleteCardAPN,
  getCardAPNs,
  getDeviceAPNs,
  updateCardAPN,
  updateCardPolicy,
  type CardAPNProfile,
  type ModemAPNProfile,
} from "./deviceActions";

interface CardPolicyAPNProps {
  deviceId: string;
  iccid: string;
  policy: CardPolicy | null;
  deviceOnline: boolean;
  onSaved: (policy: CardPolicy) => void;
}

interface APNRow {
  key: string;
  apn: string;
  ipVersion: "IP" | "IPV6" | "IPV4V6";
  source: "automatic" | "modem" | "custom";
  cid?: number;
  customID?: number;
  username?: string;
  hasPassword?: boolean;
  proxy?: string;
  mcc?: string;
  mnc?: string;
  roamingIPVersion?: "IP" | "IPV6" | "IPV4V6";
  authType?: "NONE" | "PAP" | "CHAP" | "PAP_OR_CHAP";
}

const APN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

export function CardPolicyAPN({ deviceId, iccid, policy, deviceOnline, onSaved }: CardPolicyAPNProps) {
  const { t } = useI18n();
  const [modemProfiles, setModemProfiles] = useState<ModemAPNProfile[]>([]);
  const [customProfiles, setCustomProfiles] = useState<CardAPNProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<CardAPNProfile | null>(null);
  const [newAPN, setNewAPN] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newProxy, setNewProxy] = useState("");
  const [newMCC, setNewMCC] = useState("");
  const [newMNC, setNewMNC] = useState("");
  const [newIPVersion, setNewIPVersion] = useState<"IP" | "IPV6" | "IPV4V6">("IPV4V6");
  const [newRoamingIPVersion, setNewRoamingIPVersion] = useState<"IP" | "IPV6" | "IPV4V6">("IP");
  const [newAuthType, setNewAuthType] = useState<"NONE" | "PAP" | "CHAP" | "PAP_OR_CHAP">("NONE");
  const [clearPassword, setClearPassword] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pendingKey, setPendingKey] = useState("");
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [customResult, modemResult] = await Promise.allSettled([
      getCardAPNs(iccid),
      deviceOnline ? getDeviceAPNs(deviceId) : Promise.resolve({ items: [] as ModemAPNProfile[] }),
    ]);
    setCustomProfiles(customResult.status === "fulfilled" ? customResult.value.items || [] : []);
    setModemProfiles(modemResult.status === "fulfilled" ? modemResult.value.items || [] : []);
    setLoading(false);
  }, [deviceId, deviceOnline, iccid]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo<APNRow[]>(() => {
    const result: APNRow[] = [
      { key: "automatic", apn: "", ipVersion: "IPV4V6", source: "automatic" },
    ];
    for (const item of modemProfiles) {
      result.push({
        key: `modem:${item.cid}:${item.apn}:${item.ipVersion}`,
        apn: item.apn,
        ipVersion: item.ipVersion,
        source: "modem",
        cid: item.cid,
      });
    }
    for (const item of customProfiles) {
      result.push({
        key: `custom:${item.id}`,
        apn: item.apn,
        ipVersion: item.ipVersion,
        source: "custom",
        customID: item.id,
        username: item.username,
        hasPassword: item.hasPassword,
        proxy: item.proxy,
        mcc: item.mcc,
        mnc: item.mnc,
        roamingIPVersion: item.roamingIpVersion,
        authType: item.authType,
      });
    }
    return result;
  }, [customProfiles, modemProfiles]);

  function isActive(row: APNRow) {
    const activeAPN = policy?.apn || "";
    const activeIP = policy?.ipVersion || "IPV4V6";
    if (row.source === "automatic") return activeAPN === "";
    if (row.apn !== activeAPN || row.ipVersion !== activeIP) return false;
    const activeCustom = customProfiles.some((item) => item.apn === activeAPN && item.ipVersion === activeIP);
    return row.source === "custom" || !activeCustom;
  }

  async function enable(row: APNRow) {
    setPendingKey(row.key);
    try {
      const saved = await updateCardPolicy(iccid, { apn: row.apn, ipVersion: row.ipVersion });
      onSaved(saved);
      message.success(row.source === "automatic" ? t("已使用运营商自动 APN 配置") : t("APN 已启用"));
    } catch (error) {
      message.error(apiMessage(error) || t("启用 APN 失败"));
    } finally {
      setPendingKey("");
    }
  }

  function openEditor(profile?: CardAPNProfile) {
    setEditingProfile(profile || null);
    setNewAPN(profile?.apn || "");
    setNewUsername(profile?.username || "");
    setNewPassword("");
    setNewProxy(profile?.proxy || "");
    setNewMCC(profile?.mcc || "");
    setNewMNC(profile?.mnc || "");
    setNewIPVersion(profile?.ipVersion || "IPV4V6");
    setNewRoamingIPVersion(profile?.roamingIpVersion || "IP");
    setNewAuthType(profile?.authType || "NONE");
    setClearPassword(false);
    setEditorOpen(true);
  }

  async function saveEditor() {
    const cleanAPN = newAPN.trim();
    if (!cleanAPN || !APN_PATTERN.test(cleanAPN)) {
      message.warning(t("APN 只能包含字母、数字、点、下划线或连字符，且最长 100 个字符"));
      return;
    }
    if (newMCC && !/^\d{3}$/.test(newMCC)) {
      message.warning(t("MCC 必须是 3 位数字"));
      return;
    }
    if (newMNC && !/^\d{2,3}$/.test(newMNC)) {
      message.warning(t("MNC 必须是 2 或 3 位数字"));
      return;
    }
    setAdding(true);
    try {
      const payload = {
        apn: cleanAPN,
        username: newUsername.trim(),
        proxy: newProxy.trim(),
        mcc: newMCC.trim(),
        mnc: newMNC.trim(),
        ipVersion: newIPVersion,
        roamingIpVersion: newRoamingIPVersion,
        authType: newAuthType,
      };
      if (editingProfile) {
        await updateCardAPN(iccid, editingProfile.id, {
          ...payload,
          ...(newPassword ? { password: newPassword } : {}),
          clearPassword,
        });
      } else {
        await createCardAPN(iccid, { ...payload, password: newPassword });
      }
      setEditorOpen(false);
      await load();
      message.success(editingProfile ? t("自定义 APN 已修改") : t("自定义 APN 已添加，请点击启用后使用"));
    } catch (error) {
      message.error(apiMessage(error) || (editingProfile ? t("修改 APN 失败") : t("添加 APN 失败")));
    } finally {
      setAdding(false);
    }
  }

  async function remove(row: APNRow) {
    if (!row.customID) return;
    const confirmed = await confirmDialog(
      t("确定删除这个自定义 APN 配置吗？"),
      t("删除 APN"),
      { type: "danger", confirmVariant: "danger", confirmText: t("删除") },
    );
    if (!confirmed) return;
    setPendingKey(row.key);
    try {
      const wasActive = isActive(row);
      await deleteCardAPN(iccid, row.customID);
      if (wasActive && policy) {
        onSaved({ ...policy, apn: "", ipVersion: "IPV4V6" });
      }
      await load();
      message.success(wasActive ? t("APN 已删除，并恢复运营商自动配置") : t("自定义 APN 已删除"));
    } catch (error) {
      message.error(apiMessage(error) || t("删除 APN 失败"));
    } finally {
      setPendingKey("");
    }
  }

  function edit(row: APNRow) {
    const profile = customProfiles.find((item) => item.id === row.customID);
    if (profile) openEditor(profile);
  }

  const sourceLabel = (row: APNRow) => {
    if (row.source === "automatic") return t("默认");
    if (row.source === "modem") return t("模组已有");
    return t("自定义");
  };
  const protocolLabel = (value?: "IP" | "IPV6" | "IPV4V6") => value === "IP" ? "IPv4" : value === "IPV6" ? "IPv6" : value === "IPV4V6" ? "IPv4 / IPv6" : "—";

  const detailLine = (row: APNRow) => [
    row.cid ? `CID ${row.cid}` : "",
    row.username ? `${row.username}${row.hasPassword ? ` · ${t("已设密码")}` : ""}` : "",
    row.authType && row.authType !== "NONE" ? row.authType.replace("PAP_OR_CHAP", "PAP / CHAP") : "",
    row.mcc || row.mnc ? `${row.mcc || "—"}/${row.mnc || "—"}` : "",
    protocolLabel(row.ipVersion),
    row.roamingIPVersion ? `${t("漫游")} ${protocolLabel(row.roamingIPVersion)}` : "",
    row.proxy ? `Proxy ${row.proxy}` : "",
  ].filter(Boolean).join(" · ");
  const menuRow = rows.find((row) => row.key === menu?.key);

  return (
    <section className="min-w-0">
      <div className="flex items-end justify-between gap-3 px-4 pb-1.5">
        <h3 className="ios-footnote font-medium uppercase text-label-2">{t("蜂窝 APN")}</h3>
        <button type="button" className="ios-subhead font-medium text-accent" onClick={() => openEditor()}>
          {t("新增 APN")}
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-grouped-2 py-6 ios-footnote text-label-2">
          <Spinner className="h-4 w-4 animate-spin" /> {t("正在读取 APN 列表...")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] bg-grouped-2" role="radiogroup" aria-label={t("蜂窝 APN")}>
          {rows.map((row) => {
            const active = isActive(row);
            const pending = pendingKey === row.key;
            return (
              <div key={row.key} className="ios-select-row flex items-center gap-1 pl-4 pr-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={active || pending}
                  onClick={() => enable(row)}
                  className="ios-select-row-body flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                >
                  <span className="flex w-5 shrink-0 justify-center text-accent [&_svg]:h-5 [&_svg]:w-5">
                    {pending ? <Spinner className="h-4 w-4 animate-spin" /> : active ? <CheckmarkRegular /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate ios-body font-medium text-label">{row.source === "automatic" ? t("运营商自动配置") : row.apn}</span>
                      <span className="shrink-0 ios-footnote text-label-2">{sourceLabel(row)}</span>
                    </span>
                    <span className="mt-0.5 block ios-footnote text-label-2">{detailLine(row)}</span>
                  </span>
                </button>
                {row.source === "custom" ? (
                  <button
                    type="button"
                    aria-label={t("更多操作")}
                    title={t("更多操作")}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent hover:bg-fill-4 [&_svg]:h-5 [&_svg]:w-5"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({ key: row.key, x: rect.right, y: rect.bottom });
                    }}
                  >
                    <MoreHorizontalRegular />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-1.5 px-4 ios-footnote text-label-2">
        {t("APN 列表和启用状态跟随当前 ICCID/Profile 保存")}
      </p>
      {!deviceOnline ? <p className="mt-1 px-4 ios-footnote text-sys-orange">{t("设备离线：自定义列表仍可管理，模组已有 APN 将在上线后读取")}</p> : null}
      <ContextMenu
        open={Boolean(menuRow)}
        anchor={menu}
        onClose={() => setMenu(null)}
        title={menuRow?.apn}
        items={menuRow ? [
          { label: t("修改"), icon: <EditRegular />, onSelect: () => edit(menuRow) },
          { label: t("删除"), icon: <DeleteRegular />, destructive: true, onSelect: () => remove(menuRow) },
        ] : []}
      />
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingProfile ? t("修改 APN 配置") : t("新增 APN 配置")}
        closeOnOverlay={!adding}
        footer={
          <>
            <Button disabled={adding} onClick={() => setEditorOpen(false)}>{t("取消")}</Button>
            <Button variant="primary" loading={adding} onClick={saveEditor}>{editingProfile ? t("保存修改") : t("添加到列表")}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="APN"><Input value={newAPN} maxLength={100} onChange={(event) => setNewAPN(event.target.value)} placeholder={t("必填")} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></Field>
          <Field label={t("用户名")}><Input value={newUsername} maxLength={128} onChange={(event) => setNewUsername(event.target.value)} placeholder={t("可选")} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></Field>
          <Field label={t("密码")}><Input type="password" value={newPassword} disabled={clearPassword} maxLength={128} onChange={(event) => setNewPassword(event.target.value)} placeholder={editingProfile?.hasPassword ? t("留空表示保持原密码") : t("可选")} /></Field>
          <Field label={t("认证类型")}><Select value={newAuthType} onChange={(value) => setNewAuthType(value as "NONE" | "PAP" | "CHAP" | "PAP_OR_CHAP")} options={[{ value: "NONE", label: t("无") }, { value: "PAP", label: "PAP" }, { value: "CHAP", label: "CHAP" }, { value: "PAP_OR_CHAP", label: "PAP / CHAP" }]} /></Field>
        </div>
        {editingProfile?.hasPassword ? (
          <div className="mt-6 space-y-4">
            <ToggleRow title={t("清除已保存密码")} subtitle={t("关闭时，密码输入框留空会保持原密码")} checked={clearPassword} onChange={(value) => { setClearPassword(value); if (value) setNewPassword(""); }} />
          </div>
        ) : null}
        <div className="mt-6 space-y-4">
          <Field label="MCC"><Input inputMode="numeric" value={newMCC} maxLength={3} onChange={(event) => setNewMCC(event.target.value.replace(/\D/g, ""))} placeholder="234" /></Field>
          <Field label="MNC"><Input inputMode="numeric" value={newMNC} maxLength={3} onChange={(event) => setNewMNC(event.target.value.replace(/\D/g, ""))} placeholder="10" /></Field>
          <Field label="Proxy"><Input value={newProxy} maxLength={255} onChange={(event) => setNewProxy(event.target.value)} placeholder={t("可选")} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></Field>
          <Field label={t("APN 协议")}><Select value={newIPVersion} onChange={(value) => setNewIPVersion(value as "IP" | "IPV6" | "IPV4V6")} options={[{ value: "IPV4V6", label: "IPv4 / IPv6" }, { value: "IP", label: "IPv4" }, { value: "IPV6", label: "IPv6" }]} /></Field>
          <Field label={t("APN 漫游协议")}><Select value={newRoamingIPVersion} onChange={(value) => setNewRoamingIPVersion(value as "IP" | "IPV6" | "IPV4V6")} options={[{ value: "IP", label: "IPv4" }, { value: "IPV4V6", label: "IPv4 / IPv6" }, { value: "IPV6", label: "IPv6" }]} /></Field>
        </div>
      </Modal>
    </section>
  );
}
