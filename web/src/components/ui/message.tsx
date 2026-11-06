import { useEffect, useState } from "react";
import {
  CheckmarkCircleFilled,
  DismissCircleFilled,
  InfoFilled,
  WarningFilled,
} from "@fluentui/react-icons";
import { cx } from "../../lib/utils";

export type MessageKind = "success" | "error" | "warning" | "info";

interface MessageItem {
  id: number;
  kind: MessageKind;
  text: string;
  leaving?: boolean;
}

type Listener = (items: MessageItem[]) => void;

let seq = 1;
let items: MessageItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener([...items]);
}

function push(kind: MessageKind, text: string, duration = 3000) {
  const id = seq++;
  items = [...items, { id, kind, text }];
  emit();
  window.setTimeout(() => dismiss(id), duration);
}

function dismiss(id: number) {
  items = items.map((item) => (item.id === id ? { ...item, leaving: true } : item));
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 220);
}

export const message = {
  success: (text: string, duration?: number) => push("success", text, duration),
  error: (text: string, duration?: number) => push("error", text, duration ?? 4000),
  warning: (text: string, duration?: number) => push("warning", text, duration),
  info: (text: string, duration?: number) => push("info", text, duration),
};

const ICONS: Record<MessageKind, typeof CheckmarkCircleFilled> = {
  success: CheckmarkCircleFilled,
  error: DismissCircleFilled,
  warning: WarningFilled,
  info: InfoFilled,
};

const TONE: Record<MessageKind, string> = {
  success: "text-sys-green",
  error: "text-sys-red",
  warning: "text-sys-orange",
  info: "text-accent",
};

export function MessageHost() {
  const [current, setCurrent] = useState<MessageItem[]>(items);
  useEffect(() => {
    const listener: Listener = (next) => setCurrent(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed left-1/2 top-[max(10px,env(safe-area-inset-top))] z-[10000] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
      {current.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            key={item.id}
            className={cx(
              "glass-thick pointer-events-auto flex items-center gap-2.5 rounded-full px-5 py-3 text-[15px] font-semibold tracking-[-0.01em] text-label",
              item.leaving ? "ui-toast-out" : "ui-toast-in",
            )}
            role="status"
          >
            <Icon className={cx("h-4.5 w-4.5 shrink-0 text-[18px]", TONE[item.kind])} />
            <span className="break-words">{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}
