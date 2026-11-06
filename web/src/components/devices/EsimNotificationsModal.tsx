import { Modal } from "../ui";
import type { EsimNotification } from "./types";
import { tl, useI18n } from "../../lib/i18n";

function eventLabel(event?: string): string {
  switch (event) {
    case "install":
      return tl("安装");
    case "enable":
      return tl("启用");
    case "disable":
      return tl("禁用");
    case "delete":
      return tl("删除");
    case "":
      return tl("未知");
    default:
      return event || tl("未知");
  }
}

function MetaLine({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <span className="block min-w-0 ios-footnote text-label-2">
      <span className="mr-1">{label}</span>
      <span className="break-all font-mono">{value}</span>
    </span>
  );
}

export interface EsimNotificationsModalProps {
  open: boolean;
  loading: boolean;
  items: EsimNotification[];
  retryingSeq: number | null;
  onClose: () => void;
  onRetry: (item: EsimNotification) => void;
}

export function EsimNotificationsModal({ open, loading, items, retryingSeq, onClose, onRetry }: EsimNotificationsModalProps) {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={t("当前通知列表")} width="max-w-[min(500px,calc(100vw-24px))]" className="glass-modal">
      {loading ? (
        <div className="py-10 text-center ios-subhead text-label-2">{t("正在加载通知...")}</div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center ios-subhead text-label-2">{t("当前没有可展示的通知")}</div>
      ) : (
        <div className="ios-list max-h-[420px] overflow-auto">
          {items.map((item) => (
            <div
              key={`${item.aidHex || "default"}:${item.sequenceNumber}`}
              className="ios-select-row flex items-center gap-3 px-4"
            >
              <div className="ios-select-row-body flex min-w-0 flex-1 items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 ios-body text-label">
                  <span className="font-semibold">#{item.sequenceNumber}</span>
                  <span className="ios-footnote text-label-2">{eventLabel(item.event)}</span>
                </div>
                <div className="mt-0.5">
                  <MetaLine label="ICCID" value={item.iccid} />
                  <MetaLine label={t("地址")} value={item.address} />
                  <MetaLine label="AID" value={item.aidHex} />
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 ios-body text-accent disabled:opacity-40"
                disabled={!item.canRetry || retryingSeq === item.sequenceNumber}
                onClick={() => onRetry(item)}
              >
                {retryingSeq === item.sequenceNumber ? t("重发中…") : t("重发")}
              </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
