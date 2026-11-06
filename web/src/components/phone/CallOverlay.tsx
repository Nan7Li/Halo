import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CallEndFilled,
  CallFilled,
  ChevronDownRegular,
  MicOffRegular,
  MicRegular,
  RecordRegular,
  SpeakerMuteRegular,
  Speaker2Filled,
  Speaker2Regular,
  WarningRegular,
} from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { useCalls } from "./CallProvider";
import { micUnavailableReason } from "./callAudio";
import { callPhase, formatElapsed, formatNumber, lineTransport } from "./model";

function useNow(enabled: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

/** Incoming banner, full-screen call UI and the minimized call pill. */
export function CallOverlay() {
  const calls = useCalls();
  const { current, expanded } = calls;
  if (!current) return null;
  const phase = callPhase(current);
  if (expanded) return createPortal(<InCallScreen />, document.body);
  if (phase === "incoming") return createPortal(<IncomingBanner />, document.body);
  return createPortal(<CallPill />, document.body);
}

function lineName(lines: { id: string; name?: string }[], deviceId: string) {
  const line = lines.find((item) => item.id === deviceId);
  return line?.name || deviceId;
}

function IncomingBanner() {
  const { t } = useI18n();
  const { current, lines, answer, hangup, busy, setExpanded } = useCalls();
  if (!current) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[5000] flex justify-center px-3 pt-[max(10px,env(safe-area-inset-top))]">
      <div className="ios-banner glass-thick pointer-events-auto flex w-full max-w-[460px] items-center gap-3 rounded-[30px] p-3 pl-4">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setExpanded(true)}>
          <span className="ios-avatar h-11 w-11 text-[18px]">
            <CallFilled className="h-5 w-5 [animation:ios-ring_1.4s_ease-in-out_infinite]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate ios-headline text-label">{formatNumber(current.number || "") || t("未知号码")}</span>
            <span className="block truncate ios-footnote text-label-2">
              {t("来电")} · {lineName(lines, current.deviceId)}
            </span>
          </span>
        </button>
        <button type="button" aria-label={t("拒绝")} disabled={busy} onClick={() => void hangup()} className="ios-call-btn is-red !h-12 !w-12 [&_svg]:!h-6 [&_svg]:!w-6">
          <CallEndFilled />
        </button>
        <button type="button" aria-label={t("接听")} disabled={busy} onClick={() => void answer()} className="ios-call-btn is-green !h-12 !w-12 [&_svg]:!h-6 [&_svg]:!w-6">
          <CallFilled />
        </button>
      </div>
    </div>
  );
}

function CallPill() {
  const { t } = useI18n();
  const { current, setExpanded } = useCalls();
  const now = useNow(true);
  if (!current) return null;
  const phase = callPhase(current);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[5000] flex justify-center pt-[max(8px,env(safe-area-inset-top))]">
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="ios-banner pointer-events-auto flex h-9 items-center gap-2 rounded-full bg-black px-4 text-[14px] font-semibold text-white shadow-lg ios-press"
      >
        <CallFilled className="h-4 w-4 text-sys-green" />
        <span className="font-mono tabular-nums text-sys-green">
          {phase === "active" ? formatElapsed(current.answeredAt || current.startedAt, now) : t("呼叫中")}
        </span>
        <span className="max-w-[40vw] truncate">{formatNumber(current.number || "") || t("未知号码")}</span>
      </button>
    </div>
  );
}

function InCallScreen() {
  const { t } = useI18n();
  const { current, lines, audio, mic, muted, toggleMute, answer, hangup, busy, setExpanded } = useCalls();
  const now = useNow(true);
  if (!current) return null;
  const phase = callPhase(current);
  const line = lines.find((item) => item.id === current.deviceId);
  const transport = line ? lineTransport(line) : "vowifi";
  const status =
    phase === "incoming" ? t("来电") :
    phase === "dialing" ? t("正在呼叫…") :
    phase === "connecting" ? t("正在接通…") :
    formatElapsed(current.answeredAt || current.startedAt, now);
  const micReason = micUnavailableReason(mic);
  const listenOnly = phase === "active" && Boolean(micReason);

  return (
    <div className="fixed inset-0 z-[5000] flex flex-col overflow-hidden text-white [animation:ios-fade_var(--dur-spring-smooth)_var(--spring-smooth)_backwards]" role="dialog" aria-modal="true" aria-label={t("通话")}>
      {/* Poster background: blurred accent gradient, like a contact poster. */}
      <div className="absolute inset-0 -z-10 bg-[#0b0b0f]" />
      <div className="absolute inset-0 -z-10 opacity-90" style={{ background: "radial-gradient(120% 70% at 50% 0%, rgb(var(--color-primary-rgb) / 0.55), transparent 65%), radial-gradient(90% 60% at 100% 100%, rgb(var(--ios-indigo) / 0.45), transparent 70%), radial-gradient(80% 60% at 0% 90%, rgb(var(--ios-teal) / 0.35), transparent 70%)" }} />
      <div className="absolute inset-0 -z-10 backdrop-blur-3xl" />

      <div className="flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label={t("最小化")}
          className="glass glass-interactive inline-flex h-10 w-10 items-center justify-center rounded-full text-white [--glass-tint:255_255_255] [--glass-alpha:0.16]"
        >
          <ChevronDownRegular className="h-5 w-5" />
        </button>
        <span className="rounded-full bg-white/15 px-3 py-1 ios-caption font-semibold backdrop-blur">
          {transport === "cellular" ? t("蜂窝") : "Wi-Fi Calling"} · {line?.name || current.deviceId}
        </span>
        <span className="h-10 w-10" />
      </div>

      <div className="mt-[8vh] flex flex-col items-center px-6 text-center">
        <div className="relative mb-5">
          {phase === "incoming" || phase === "dialing" ? (
            <span className="absolute inset-0 rounded-full bg-white/30 [animation:ios-pulse-ring_1.6s_ease-out_infinite]" />
          ) : null}
          <span className="ios-avatar relative h-24 w-24 text-[40px] !bg-white/20">
            <CallFilled className="h-11 w-11" />
          </span>
        </div>
        <div className="max-w-full break-all ios-large-title !text-[38px] !font-semibold tracking-tight">
          {formatNumber(current.number || "") || t("未知号码")}
        </div>
        <div className="mt-2 font-mono text-[19px] tabular-nums text-white/75">{status}</div>
        {phase === "active" && audio === "connecting" ? <div className="mt-2 ios-footnote text-white/60">{t("正在连接浏览器音频…")}</div> : null}
        {phase === "active" && audio === "error" ? <div className="mt-2 ios-footnote text-[#FF9F0A]">{t("浏览器音频连接失败")}</div> : null}
        {listenOnly ? (
          <div className="mt-4 flex max-w-sm items-start gap-2 rounded-2xl bg-white/12 px-4 py-3 text-left ios-footnote text-white/85 backdrop-blur">
            <SpeakerMuteRegular className="mt-0.5 h-4 w-4 shrink-0 text-[#FF9F0A]" />
            <span>{t(micReason)}</span>
          </div>
        ) : null}
      </div>

      <div className="mt-auto px-8 pb-[max(36px,env(safe-area-inset-bottom))]">
        {phase === "incoming" ? (
          <div className="mx-auto flex max-w-xs items-end justify-between">
            <CallAction label={t("拒绝")} onClick={() => void hangup()} disabled={busy} tone="red" icon={<CallEndFilled />} />
            <CallAction label={t("接听")} onClick={() => void answer()} disabled={busy} tone="green" icon={<CallFilled />} />
          </div>
        ) : (
          <>
            <div className="mx-auto mb-10 grid max-w-xs grid-cols-3 gap-6">
              <ControlButton
                label={muted ? t("取消静音") : t("静音")}
                active={muted}
                disabled={phase !== "active" || listenOnly || mic === "pending"}
                onClick={toggleMute}
                icon={muted ? <MicOffRegular /> : <MicRegular />}
              />
              <ControlButton label={t("录音")} active={Boolean(current.recording)} disabled icon={<RecordRegular />} />
              <ControlButton
                label={audio === "ready" ? t("音频已连接") : t("音频")}
                active={audio === "ready"}
                disabled
                icon={audio === "error" ? <WarningRegular /> : audio === "ready" ? <Speaker2Filled /> : <Speaker2Regular />}
              />
            </div>
            <div className="flex justify-center">
              <CallAction label={t("结束")} onClick={() => void hangup()} disabled={busy} tone="red" icon={<CallEndFilled />} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CallAction({ label, onClick, disabled, tone, icon }: { label: string; onClick: () => void; disabled?: boolean; tone: "red" | "green"; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={cx("ios-call-btn", tone === "red" ? "is-red" : "is-green")}>
        {icon}
      </button>
      <span className="ios-footnote text-white/80">{label}</span>
    </div>
  );
}

function ControlButton({ label, icon, active, disabled, onClick }: { label: string; icon: React.ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled && !active}
        className={cx(
          "inline-flex h-[72px] w-[72px] items-center justify-center rounded-full backdrop-blur-xl transition-[background-color,transform] duration-200 active:scale-95 [&_svg]:h-8 [&_svg]:w-8",
          active ? "bg-white text-black" : "bg-white/18 text-white",
          disabled && !active && "opacity-40",
          !onClick && "pointer-events-none",
        )}
      >
        {icon}
      </button>
      <span className="ios-caption text-white/80">{label}</span>
    </div>
  );
}
