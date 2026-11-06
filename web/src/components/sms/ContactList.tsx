import { useState, type PointerEvent, type ReactNode } from "react";
import { ChatMultipleRegular, CheckmarkRegular, ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { ListSkeleton, type SelectOption } from "../ui";
import { cx } from "../../lib/utils";
import type { SmsThread } from "./smsText";
import { formatRecentTime } from "../phone/model";
import { useI18n } from "../../lib/i18n";
import { ContextMenu, ContentUnavailable, SearchField, SwipeRow } from "../ios";

export interface ContactListProps {
  isMobile: boolean;
  isDesktop: boolean;
  selectedDevice: string;
  deviceOptions: SelectOption[];
  onSelectDevice: (id: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  contacts: SmsThread[];
  activeKey: string;
  isUnread: (t: SmsThread) => boolean;
  deletingKey: string | null;
  canHover: boolean;
  onSelect: (key: string) => void;
  onDelete: (t: SmsThread) => void;
  onRowPointerDown: (t: SmsThread, e: PointerEvent) => void;
  onRowPointerMove: (e: PointerEvent) => void;
  onRowPointerEnd: (e: PointerEvent) => void;
  /** Title row: large title and toolbar actions. */
  header?: ReactNode;
}

/** Initials (or the last digits) for a conversation avatar. */
function avatarText(thread: SmsThread) {
  const name = (thread.displayName || "").trim();
  if (name && !/^[+\d\s-]+$/.test(name)) return Array.from(name)[0]?.toUpperCase() || "#";
  return "";
}

export function ContactList(props: ContactListProps) {
  const { t } = useI18n();
  const {
    isMobile,
    selectedDevice,
    deviceOptions,
    onSelectDevice,
    searchQuery,
    onSearchChange,
    loading,
    contacts,
    activeKey,
    isUnread,
    onSelect,
    onDelete,
    onRowPointerDown,
    onRowPointerMove,
    onRowPointerEnd,
    header,
  } = props;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const deviceLabel = deviceOptions.find((option) => option.value === selectedDevice)?.label ?? t("全部设备");

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="shrink-0 px-4 pb-3 pt-1">
        {header}
        <div className="flex items-center gap-2">
          <SearchField value={searchQuery} onChange={onSearchChange} placeholder={t("搜索")} className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.right, y: rect.bottom });
            }}
            className="inline-flex h-[38px] max-w-[45%] shrink-0 items-center gap-1 rounded-[12px] bg-fill-3 px-3 ios-subhead font-medium text-label"
          >
            <span className="truncate">{deviceLabel}</span>
            <ChevronDownRegular className="h-4 w-4 shrink-0 text-label-2" />
          </button>
        </div>
      </div>
      <ContextMenu
        open={Boolean(menu)}
        anchor={menu}
        onClose={() => setMenu(null)}
        title={t("显示设备")}
        items={deviceOptions.map((option) => ({
          label: option.label,
          icon: option.value === selectedDevice ? <CheckmarkRegular /> : undefined,
          onSelect: () => onSelectDevice(String(option.value)),
        }))}
      />

      {loading && contacts.length === 0 ? (
        <ListSkeleton rows={8} />
      ) : contacts.length === 0 ? (
        <ContentUnavailable
          icon={<ChatMultipleRegular />}
          title={searchQuery ? t("无结果") : t("没有信息")}
          description={searchQuery ? t("换个关键词试试") : t("模组收到短信后会显示在这里，也可以点右上角新建一条。")}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-28 md:pb-4">
          {contacts.map((thread, index) => {
            const active = activeKey === thread.key && !isMobile;
            const unread = isUnread(thread);
            const initial = avatarText(thread);
            const row = (
              <div
                className={cx(
                  "relative flex w-full cursor-pointer items-stretch gap-3 pl-2 pr-4 text-left transition-colors duration-100",
                  active ? "bg-accent text-[var(--color-on-primary)]" : "bg-bg hover:bg-fill-4 active:bg-fill-3",
                  active && "rounded-[14px] md:mx-2 md:w-[calc(100%-16px)]",
                )}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(thread.key)}
                onKeyDown={(event) => event.key === "Enter" && onSelect(thread.key)}
                onPointerDown={(event) => onRowPointerDown(thread, event)}
                onPointerMove={onRowPointerMove}
                onPointerUp={onRowPointerEnd}
                onPointerCancel={onRowPointerEnd}
              >
                <span className="flex w-3 shrink-0 items-center justify-center">
                  {unread ? <span className={cx("ios-dot", active && "!bg-white")} /> : null}
                </span>
                <span className="flex shrink-0 items-center py-2.5">
                  <span className="ios-avatar h-11 w-11 text-[18px]">
                    {initial || (
                      <svg viewBox="0 0 24 24" className="h-7 w-7 translate-y-1 fill-white/90" aria-hidden>
                        <circle cx="12" cy="8" r="4.2" />
                        <path d="M3.5 22c.6-4.6 4.2-7.6 8.5-7.6s7.9 3 8.5 7.6z" />
                      </svg>
                    )}
                  </span>
                </span>
                <span
                  className={cx(
                    "min-w-0 flex-1 py-2.5",
                    index > 0 && !active && "border-t-[0.5px] border-separator",
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <span className={cx("min-w-0 flex-1 truncate ios-headline", !active && "text-label")}>{thread.displayName || thread.peer}</span>
                    <span className={cx("shrink-0 ios-subhead", active ? "text-white/80" : "text-label-2")}>{t(formatRecentTime(thread.lastTs ? new Date(thread.lastTs).toISOString() : ""))}</span>
                    <ChevronRightRegular className={cx("h-3.5 w-3.5 shrink-0", active ? "text-white/70" : "text-label-3")} />
                  </span>
                  <span className={cx("mt-0.5 line-clamp-2 ios-subhead", active ? "text-white/85" : "text-label-2")}>{thread.lastMessage}</span>
                  {selectedDevice === "all" && (thread.localPhone || thread.lastDeviceName) ? (
                    <span className={cx("mt-0.5 block truncate ios-caption", active ? "text-white/70" : "text-label-3")}>
                      {thread.lastDeviceName}{thread.localPhone ? ` · ${thread.localPhone}` : ""}
                    </span>
                  ) : null}
                </span>
              </div>
            );
            return (
              <SwipeRow key={thread.key} background="rgb(var(--ios-bg))" actions={[{ label: t("删除"), color: "red", onAction: () => onDelete(thread) }]}>
                {row}
              </SwipeRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
