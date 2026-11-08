import { useRef, useState } from "react";
import { BackspaceRegular, CallFilled, CheckmarkRegular, ChevronDownRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import type { DeviceListItem } from "../../types";
import { ContextMenu } from "../ios/sheet";
import { softphoneReadyReason } from "../devices/shared";
import { KEYS, formatNumber, lineReady, lineTransport, sanitizeDial } from "./model";

/** iOS keypad with a line picker, number display, call and delete keys. */
export function Keypad({
  number,
  onNumber,
  lines,
  lineId,
  onLine,
  onCall,
  busy,
  inCall,
}: {
  number: string;
  onNumber: (value: string) => void;
  lines: DeviceListItem[];
  lineId: string;
  onLine: (id: string) => void;
  onCall: () => void;
  busy: boolean;
  inCall: boolean;
}) {
  const { t } = useI18n();
  const longPress = useRef<number | null>(null);
  const longFired = useRef(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const line = lines.find((item) => item.id === lineId);
  const ready = line ? lineReady(line) : false;
  const reason = line && !ready ? softphoneReadyReason(line) : "";
  const canCall = ready && !busy && !inCall && number.trim().length >= 2;

  const append = (digit: string) => onNumber(sanitizeDial(number + digit));
  const clear = () => {
    if (longPress.current !== null) window.clearTimeout(longPress.current);
    longPress.current = null;
  };

  return (
    <div className="mx-auto flex w-full max-w-[320px] flex-col items-center">
      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.right, y: rect.bottom });
        }}
        className="glass glass-interactive inline-flex h-9 max-w-full items-center gap-1.5 rounded-full px-3.5 ios-subhead font-semibold text-label"
      >
        <span className={cx("h-2 w-2 shrink-0 rounded-full", ready ? "bg-sys-green" : "bg-sys-orange")} />
        <span className="truncate">{line ? line.name || line.id : t("选择线路")}</span>
        {line ? <span className="shrink-0 text-label-2">· {lineTransport(line) === "cellular" ? t("蜂窝") : lineTransport(line) === "airsim" ? t("安卓") : "Wi-Fi"}</span> : null}
        <ChevronDownRegular className="h-4 w-4 shrink-0 text-label-2" />
      </button>
      <ContextMenu
        open={Boolean(menu)}
        anchor={menu}
        onClose={() => setMenu(null)}
        title={t("用这条线路拨打")}
        items={lines.map((item) => ({
          label: (
            <span className="flex flex-col">
              <span>{item.name || item.id}</span>
              <span className="ios-footnote text-label-2">
                {lineTransport(item) === "cellular" ? t("蜂窝通话") : lineTransport(item) === "airsim" ? t("安卓手机 · AirSIM") : "Wi-Fi Calling"} · {lineReady(item) ? t("可用") : t("未就绪")}
              </span>
            </span>
          ),
          icon: item.id === lineId ? <CheckmarkRegular /> : undefined,
          onSelect: () => onLine(item.id),
        }))}
      />

      <input
        value={formatNumber(number)}
        onChange={(event) => onNumber(sanitizeDial(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && canCall) onCall();
        }}
        inputMode="tel"
        autoComplete="tel"
        aria-label={t("电话号码")}
        placeholder=" "
        className="mt-6 h-[52px] w-full border-0 bg-transparent text-center text-[36px] font-normal tracking-[0.01em] text-label outline-none placeholder:text-transparent"
      />
      <div className="h-5 text-center ios-footnote text-sys-orange">{reason ? <span className="line-clamp-1" title={reason}>{reason}</span> : null}</div>

      <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-4">
        {KEYS.map((key) => (
          <button
            key={key.value}
            type="button"
            aria-label={key.longPress ? t("长按输入 +") : key.value}
            className={cx("ios-key", pressed === key.value && "is-pressed")}
            onPointerDown={() => {
              setPressed(key.value);
              longFired.current = false;
              clear();
              if (key.longPress) {
                longPress.current = window.setTimeout(() => {
                  longFired.current = true;
                  append(key.longPress!);
                }, 450);
              }
            }}
            onPointerUp={() => {
              setPressed(null);
              clear();
              if (!longFired.current) append(key.value);
            }}
            onPointerLeave={() => {
              setPressed(null);
              clear();
            }}
            onPointerCancel={() => {
              setPressed(null);
              clear();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                append(key.value);
              }
            }}
          >
            <span className={cx("ios-key-digit", key.value === "*" && "translate-y-[6px] text-[44px]")}>{key.value}</span>
            {key.letters ? <span className="ios-key-letters">{key.letters}</span> : null}
          </button>
        ))}
        <span />
        <button type="button" aria-label={t("拨号")} title={reason || t("拨号")} disabled={!canCall} onClick={onCall} className="ios-call-btn is-green justify-self-center">
          <CallFilled />
        </button>
        <button
          type="button"
          aria-label={t("退格")}
          title={t("长按或右键清空")}
          onClick={() => onNumber(number.slice(0, -1))}
          onContextMenu={(event) => {
            event.preventDefault();
            onNumber("");
          }}
          className={cx("inline-flex h-[78px] w-[78px] items-center justify-center justify-self-center rounded-full text-label-2 transition-opacity", !number && "pointer-events-none opacity-0")}
        >
          <BackspaceRegular className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}
