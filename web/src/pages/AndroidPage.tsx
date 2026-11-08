import { useEffect, useState } from "react";
import {
  ArrowRepeatAllRegular,
  Battery10Regular,
  BatteryChargeRegular,
  CallRegular,
  ChatRegular,
  DeleteRegular,
  LinkRegular,
  PhoneRegular,
  SimRegular,
  Wifi1Regular,
} from "@fluentui/react-icons";
import { api, apiMessage } from "../api";
import { useI18n } from "../lib/i18n";
import { ContentUnavailable, ListRow, ListSection, Page, Sheet } from "../components/ios";
import { Button, Input } from "../components/ui";
import { message } from "../components/ui/message";
import { confirmDialog } from "../components/ui/MessageBox";
import { useCalls } from "../components/phone/CallProvider";
import { airsimName, type AirSIMStatus } from "../components/phone/airsim";
import { formatNumber, formatRecentTime } from "../components/phone/model";

const STATE_TEXT: Record<AirSIMStatus["state"], string> = {
  unpaired: "未配对",
  connecting: "正在连接",
  online: "在线",
  offline: "离线",
};

/**
 * The Android phone Halo drives over AirSIM: pairing, its state, SIMs and
 * recent calls. Calls themselves happen on the Phone page, where the phone
 * is one more line, and its texts land in Messages.
 */
export default function AndroidPage() {
  const { t } = useI18n();
  const { airsim, refreshAirSIM } = useCalls();
  const [pairing, setPairing] = useState(false);
  useEffect(() => {
    void refreshAirSIM();
  }, [refreshAirSIM]);

  const unpair = async () => {
    const ok = await confirmDialog(
      t("Halo 将不再连接这台安卓手机。手机上的 AirSIM 仍会保留这条配对记录，可在手机上清除。"),
      t("取消配对"),
      { confirmText: t("取消配对"), confirmVariant: "danger", type: "danger" },
    );
    if (!ok) return;
    try {
      await api("/airsim", { method: "DELETE" });
      await refreshAirSIM();
    } catch (error) {
      message.error(apiMessage(error));
    }
  };

  if (!airsim) {
    return (
      <Page title={t("安卓手机")}>
        <div className="py-16 text-center ios-subhead text-label-2">{t("正在读取…")}</div>
      </Page>
    );
  }

  return (
    <Page title={t("安卓手机")}>
      {!airsim.paired ? (
        <>
          <ContentUnavailable
            icon={<PhoneRegular />}
            title={t("把安卓手机变成 Halo 的一条线路")}
            description={t("安卓手机装上 AirSIM 后，Halo 可以用它打电话、接电话、收发短信，通话声音在浏览器里听说。")}
            action={<Button variant="primary" onClick={() => setPairing(true)}>{t("配对安卓手机")}</Button>}
          />
          <ListSection header={t("准备")} footer={t("手机和 NAS 要在同一个局域网，或都在同一个 Tailscale 网络里。")}>
            <ListRow multiline icon={<PhoneRegular />} iconColor="green" title={t("安装 AirSIM Standalone APK")} subtitle={t("设为默认电话应用，并在 Shizuku 里授权，通话音频桥才能工作。")} />
            <ListRow multiline icon={<LinkRegular />} iconColor="blue" title={t("在手机上打开「一次性配对」")} subtitle={t("页面会显示手机的 IP、配对端口和 6 位数配对码，两分钟内有效。")} />
            <ListRow multiline icon={<Wifi1Regular />} iconColor="indigo" title={t("在这里填入地址、端口和配对码")} subtitle={t("Halo 以本地模式配对：不经过 AirSIM 云端，不写入推送设置。")} />
          </ListSection>
        </>
      ) : (
        <>
          <ListSection>
            <ListRow
              leading={<span className="ios-avatar h-[52px] w-[52px] text-[24px]"><PhoneRegular /></span>}
              title={<span className="ios-title-3">{airsimName(airsim)}</span>}
              subtitle={
                <span className="inline-flex items-center gap-1.5">
                  <span className={airsim.state === "online" ? "h-2 w-2 rounded-full bg-sys-green" : airsim.state === "offline" ? "h-2 w-2 rounded-full bg-sys-red" : "h-2 w-2 rounded-full bg-sys-orange"} />
                  {t(STATE_TEXT[airsim.state])}
                  {airsim.model && airsim.deviceName ? ` · ${airsim.manufacturer || ""} ${airsim.model}` : ""}
                </span>
              }
            />
            {airsim.state === "offline" && airsim.error ? <ListRow multiline title={<span className="text-sys-red">{airsim.error}</span>} /> : null}
          </ListSection>

          <ListSection>
            <ListRow icon={<CallRegular />} iconColor="green" title={t("打电话")} to="/phone" />
            <ListRow icon={<ChatRegular />} iconColor="green" title={t("信息")} to="/sms" />
          </ListSection>

          <ListSection header={t("手机")}>
            {airsim.phoneNumber ? <ListRow title={t("本机号码")} detail={formatNumber(airsim.phoneNumber)} /> : null}
            {airsim.battery ? (
              <ListRow
                icon={airsim.battery.charging ? <BatteryChargeRegular /> : <Battery10Regular />}
                iconColor={airsim.battery.percent <= 20 && !airsim.battery.charging ? "red" : "green"}
                title={t("电量")}
                detail={`${airsim.battery.percent}%${airsim.battery.charging ? ` · ${t("充电中")}` : ""}`}
              />
            ) : null}
            <ListRow title={t("地址")} detail={`${airsim.host}`} />
            <ListRow title={t("控制 / 音频端口")} detail={`${airsim.controlPort} / ${airsim.pcmPort}`} />
            {airsim.lastSeen ? <ListRow title={t("最后连接")} detail={new Date(airsim.lastSeen).toLocaleString()} /> : null}
          </ListSection>

          {airsim.simSlots.length ? (
            <ListSection header={t("SIM 卡")} footer={t("拨号默认使用手机上的默认通话卡。")}>
              {airsim.simSlots.map((slot) => (
                <ListRow
                  key={slot.id}
                  icon={<SimRegular />}
                  iconColor={slot.default ? "green" : "gray"}
                  title={slot.label || slot.carrierName || `SIM ${(slot.slotIndex ?? 0) + 1}`}
                  subtitle={[slot.carrierName, slot.number ? formatNumber(slot.number) : "", slot.isEmbedded ? "eSIM" : ""].filter(Boolean).join(" · ")}
                  detail={slot.default ? t("默认") : undefined}
                />
              ))}
            </ListSection>
          ) : null}

          {airsim.history.length ? (
            <ListSection header={t("手机上的最近通话")}>
              {[...airsim.history].reverse().slice(0, 10).map((call) => (
                <ListRow
                  key={call.id}
                  title={<span className={call.missed ? "text-sys-red" : undefined}>{formatNumber(call.number || "") || t("未知号码")}</span>}
                  subtitle={call.direction === "incoming" ? (call.missed ? t("未接来电") : t("来电")) : t("呼出")}
                  detail={formatRecentTime(call.startedAt)}
                />
              ))}
            </ListSection>
          ) : null}

          <ListSection>
            <ListRow icon={<ArrowRepeatAllRegular />} iconColor="blue" title={t("重新配对")} onClick={() => setPairing(true)} />
            <ListRow icon={<DeleteRegular />} iconColor="red" title={t("取消配对")} destructive onClick={unpair} />
          </ListSection>
        </>
      )}
      <PairSheet open={pairing} onClose={() => setPairing(false)} onPaired={refreshAirSIM} />
    </Page>
  );
}

function PairSheet({ open, onClose, onPaired }: { open: boolean; onClose: () => void; onPaired: () => Promise<void> }) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = host.trim() && Number(port) > 0 && /^\d{6}$/.test(code.trim());

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/airsim/pair", { method: "POST", body: { host: host.trim(), port: Number(port), code: code.trim() }, timeoutMs: 45000 });
      await onPaired();
      message.success(t("已配对安卓手机"));
      setCode("");
      onClose();
    } catch (failure) {
      setError(apiMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("配对安卓手机")}
      footer={
        <Button variant="primary" className="w-full" disabled={!ready || busy} loading={busy} onClick={submit}>
          {t("连接并加密配对")}
        </Button>
      }
    >
      <p className="mb-4 ios-subhead text-label-2">
        {t("在安卓 AirSIM 里点「开始一次性配对」，把页面上显示的局域网 IP、配对端口和 6 位数配对码填到下面。")}
      </p>
      <div className="ios-form-row"><label className="ios-form-label">{t("手机 IP")}</label><div className="ios-form-control"><Input value={host} inputMode="decimal" autoComplete="off" placeholder="192.168.1.50" onChange={(event) => setHost(event.target.value)} /></div></div>
      <div className="ios-form-row"><label className="ios-form-label">{t("配对端口")}</label><div className="ios-form-control"><Input value={port} inputMode="numeric" autoComplete="off" placeholder="45945" onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))} /></div></div>
      <div className="ios-form-row"><label className="ios-form-label">{t("配对码")}</label><div className="ios-form-control"><Input value={code} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></div></div>
      <p className="ios-form-hint ios-footnote text-label-2">
        {t("不要填无线 ADB 端口，也不要填 7592 / 7593 通话端口。配对端口每次打开配对窗口都可能不同。")}
      </p>
      {error ? <p className="mt-3 ios-subhead text-sys-red">{error}</p> : null}
    </Sheet>
  );
}
