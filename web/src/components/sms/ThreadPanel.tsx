import { Fragment, type PointerEvent, type RefObject, type UIEvent, type KeyboardEvent } from "react";
import { ArrowUpFilled, ChatRegular, ChevronLeftRegular, DeleteRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import type { SMSMessage } from "../../types";
import {
  messageBody,
  messageDeliveryIndicator,
  messageType,
  type MessageGroup,
  type SmsEncodingInfo,
  type SmsThread,
} from "./smsText";
import { tf, useI18n } from "../../lib/i18n";
import { ContentUnavailable } from "../ios";
import { Spinner } from "../ui";

export interface ThreadPanelProps {
  isMobile: boolean;
  isDesktop: boolean;
  selectedDevice: string;
  activeThread: SmsThread | null;
  canLoadMore: boolean;
  loadingMore: boolean;
  groups: MessageGroup[];
  deletingMessageId: number | null;
  canHover: boolean;
  composer: string;
  composerInfo: SmsEncodingInfo;
  composerLength: number;
  sending: boolean;
  detailRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onBack: () => void;
  onScrollToBottom: () => void;
  onLoadMore: () => void;
  onDeleteMessage: (m: SMSMessage) => void;
  onComposerChange: (v: string) => void;
  onSend: () => void;
  onDetailScroll: (e: UIEvent<HTMLDivElement>) => void;
  onMsgPointerDown: (m: SMSMessage, e: PointerEvent) => void;
  onMsgPointerMove: (e: PointerEvent) => void;
  onMsgPointerEnd: (e: PointerEvent) => void;
}

const DELIVERY_LABEL: Record<string, string> = {
  delivered: "已送达",
  accepted_unconfirmed: "已发送",
  failed: "未能送达",
};

export function ThreadPanel(props: ThreadPanelProps) {
  const { t } = useI18n();
  const {
    isMobile,
    isDesktop,
    selectedDevice,
    activeThread,
    canLoadMore,
    loadingMore,
    groups,
    deletingMessageId,
    canHover,
    composer,
    composerInfo,
    composerLength,
    sending,
    detailRef,
    composerRef,
    onBack,
    onLoadMore,
    onDeleteMessage,
    onComposerChange,
    onSend,
    onDetailScroll,
    onMsgPointerDown,
    onMsgPointerMove,
    onMsgPointerEnd,
  } = props;

  const subtitle =
    activeThread?.displayName && activeThread.displayName !== activeThread.peer
      ? activeThread.peer
      : selectedDevice === "all"
        ? activeThread && (activeThread.localPhone || activeThread.lastDeviceName)
          ? tf("本机：{phone}", { phone: activeThread.localPhone || activeThread.lastDeviceName })
          : t("全部设备")
        : tf("设备：{device}", { device: selectedDevice });

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on desktop; on phones Enter is a newline like iOS.
    if (!isMobile && e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  }

  if (!activeThread) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-bg">
        <ContentUnavailable icon={<ChatRegular />} title={t("没有选中的对话")} description={t("从左侧选择一个对话查看短信")} />
      </div>
    );
  }

  // Index of the last outbound message, which shows its delivery status.
  const flat = groups.flatMap((group) => group.items);
  const lastOutboundId = [...flat].reverse().find((m) => messageType(m) !== 1)?.id;
  const name = activeThread.displayName || activeThread.peer;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      {/* Glass header floating over the conversation. */}
      <header className="glass-chrome absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center px-3 pb-2 pt-[max(8px,env(safe-area-inset-top))]">
        <div className="flex">
          {isMobile ? (
            <button type="button" onClick={onBack} aria-label={t("返回")} className="glass glass-interactive inline-flex h-10 w-10 items-center justify-center rounded-full text-label">
              <ChevronLeftRegular className="h-[22px] w-[22px]" />
            </button>
          ) : null}
        </div>
        <div className="flex min-w-0 max-w-[60vw] flex-col items-center md:max-w-[420px]">
          <span className="ios-avatar mb-1 h-10 w-10 text-[17px]">{Array.from(name)[0]?.toUpperCase()}</span>
          <span className="glass inline-flex max-w-full items-center rounded-full px-3 py-0.5">
            <span className="truncate ios-footnote font-semibold text-label">{name}</span>
          </span>
          <span className="mt-0.5 max-w-full truncate ios-caption-2 text-label-2">{subtitle}</span>
        </div>
        <div />
      </header>

      <div ref={detailRef} onScroll={onDetailScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-[124px]">
        {canLoadMore ? (
          <div className="mb-3 flex justify-center">
            <button type="button" onClick={onLoadMore} disabled={loadingMore} className="inline-flex items-center gap-2 rounded-full bg-fill-3 px-3 py-1 ios-footnote font-medium text-label-2">
              {loadingMore ? <Spinner className="h-3 w-3" /> : null}
              {t("加载更早的信息")}
            </button>
          </div>
        ) : null}
        {groups.map((group) => (
          <Fragment key={group.date}>
            <div className="my-3 text-center ios-caption font-medium text-label-2">{group.date}</div>
            <div className="flex flex-col gap-[3px]">
              {group.items.map((message, index) => {
                const outbound = messageType(message) !== 1;
                const next = group.items[index + 1];
                const nextOutbound = next ? messageType(next) !== 1 : null;
                const tail = nextOutbound === null || nextOutbound !== outbound;
                const delivery = outbound ? messageDeliveryIndicator(message) : null;
                const failed = delivery === "failed";
                const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                return (
                  <Fragment key={message.id}>
                    <div
                      className={cx("group flex items-end gap-2", outbound ? "flex-row-reverse" : "flex-row", tail && "mb-2")}
                      onPointerDown={(event) => onMsgPointerDown(message, event)}
                      onPointerMove={onMsgPointerMove}
                      onPointerUp={onMsgPointerEnd}
                      onPointerCancel={onMsgPointerEnd}
                    >
                      <div
                        className={cx("ios-bubble ios-bubble-in", outbound ? "is-out" : "is-in", tail && "has-tail", failed && "is-failed")}
                        title={`${new Date(message.timestamp).toLocaleString()}${message.deviceName ? ` · ${message.deviceName}` : ""}`}
                      >
                        {!outbound && message.sender && message.sender !== activeThread.peer && message.sender !== activeThread.displayName ? (
                          <div className="mb-0.5 ios-caption font-semibold text-label-2">{message.sender}</div>
                        ) : null}
                        {message.decodeError ? (
                          <div className="mb-1 ios-footnote text-sys-orange" role="status">
                            {t("短信解析失败")}：{message.decodeError}
                          </div>
                        ) : null}
                        {messageBody(message) || <span className="opacity-60">{t("短信正文为空")}</span>}
                      </div>
                      {isDesktop ? (
                        <span className={cx("mb-1 flex shrink-0 items-center gap-1 transition-opacity", canHover ? "opacity-0 group-hover:opacity-100" : "opacity-100")}>
                          <span className="ios-caption-2 text-label-3">{time}</span>
                          <button
                            type="button"
                            aria-label={t("删除短信 ") + message.id}
                            title={t("删除短信")}
                            disabled={deletingMessageId === message.id}
                            onClick={() => onDeleteMessage(message)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-label-3 hover:bg-sys-red/10 hover:text-sys-red"
                          >
                            {deletingMessageId === message.id ? <Spinner className="h-3 w-3" /> : <DeleteRegular className="h-4 w-4" />}
                          </button>
                        </span>
                      ) : null}
                    </div>
                    {message.id === lastOutboundId && delivery ? (
                      <div className={cx("-mt-1 mb-2 pr-1 text-right ios-caption-2 font-medium", failed ? "text-sys-red" : "text-label-2")}>
                        {t(DELIVERY_LABEL[delivery] ?? "发送状态未知")}
                        {message.deviceName ? ` · ${message.deviceName}` : ""}
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </Fragment>
        ))}
      </div>

      {/* Composer: a glass capsule with the send arrow inside. */}
      <div className="shrink-0 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
        {composerLength > 0 ? (
          <div className="mb-1 px-3 text-right ios-caption-2 text-label-3">
            {tf("{encoding} · 预计 {parts} 段 · {length} 字", { encoding: composerInfo.encoding, parts: composerInfo.parts, length: composerLength })}
          </div>
        ) : null}
        <div className="glass flex items-end gap-2 rounded-[22px] py-1 pl-4 pr-1">
          <textarea
            ref={composerRef}
            value={composer}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={t("短信")}
            rows={1}
            className="max-h-40 min-h-[34px] flex-1 resize-none border-0 bg-transparent py-[7px] text-[17px] leading-[20px] text-label outline-none [field-sizing:content] placeholder:text-label-3 lg:text-[15px]"
          />
          <button
            type="button"
            aria-label={t("发送")}
            onClick={onSend}
            disabled={sending || !composer.trim()}
            className={cx(
              "mb-[1px] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-[transform,opacity] duration-200 ios-press",
              !composer.trim() && "scale-75 opacity-0",
            )}
          >
            {sending ? <Spinner className="h-4 w-4 text-white" /> : <ArrowUpFilled className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>
    </div>
  );
}
