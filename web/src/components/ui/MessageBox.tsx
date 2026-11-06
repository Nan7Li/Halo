import { useEffect, useState, type ReactNode } from "react";
import { WarningFilled } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { tl, useI18n } from "../../lib/i18n";

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  type?: "warning" | "danger" | "info";
  confirmVariant?: "primary" | "danger";
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

let openConfirm: ((state: ConfirmState) => void) | null = null;

// Promise-based ElMessageBox.confirm equivalent.
export function confirmDialog(message: ReactNode, title = tl("提示"), options: Omit<ConfirmOptions, "message" | "title"> = {}): Promise<boolean> {
  return new Promise((resolve) => {
    openConfirm?.({ message, title, resolve, ...options });
  });
}

export function ConfirmHost() {
  const { t } = useI18n();
  const [state, setState] = useState<ConfirmState | null>(null);

  useEffect(() => {
    openConfirm = (next) => setState(next);
    return () => {
      openConfirm = null;
    };
  }, []);

  function close(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  if (!state) return null;
  const danger = state.type === "danger" || state.confirmVariant === "danger";

  // UIAlertController: compact glass card, centered text, button row.
  return (
    <div className="ios-sheet-root !items-center" style={{ zIndex: 4500 }}>
      <button type="button" className="ios-sheet-scrim glass-scrim" aria-label={t("取消")} onClick={() => close(false)} />
      <div role="alertdialog" aria-modal="true" className="glass-thick relative z-[1] w-[300px] overflow-hidden rounded-[28px] [animation:ios-scale-in_380ms_var(--spring-bouncy)_backwards]">
        <div className="px-5 pb-4 pt-5 text-center">
          {danger ? <WarningFilled className="mx-auto mb-1 block text-[28px] text-sys-red" /> : null}
          <div className="ios-headline text-label">{state.title}</div>
          <div className="mt-1 ios-footnote text-label">{state.message}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
          <button type="button" className="h-11 rounded-full bg-fill-3 ios-body font-medium text-label ios-press" onClick={() => close(false)}>
            {state.cancelText ?? t("取消")}
          </button>
          <button
            type="button"
            autoFocus
            className={cx("h-11 rounded-full ios-body font-semibold text-white ios-press", danger ? "bg-sys-red" : "bg-accent")}
            onClick={() => close(true)}
          >
            {state.confirmText ?? t("确定")}
          </button>
        </div>
      </div>
    </div>
  );
}
