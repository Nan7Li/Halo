import type { ReactNode } from "react";

// EmptyState: dashed muted panel with icon, title, subtitle, and actions.
export function EmptyState({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ui-surface-muted rounded-2xl border border-dashed border-gray-300 p-12 text-center dark:border-separator">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100/80 text-gray-500 dark:bg-grouped-3 dark:text-label-2">
        {icon ?? <span className="text-xl font-bold">∅</span>}
      </div>
      <div className="mt-4 text-sm font-bold text-gray-700 dark:text-label">{title}</div>
      {subtitle ? <div className="mt-1 text-xs text-gray-400 dark:text-label-2">{subtitle}</div> : null}
      <div className="mt-5 flex items-center justify-center gap-2">{actions}</div>
    </div>
  );
}
