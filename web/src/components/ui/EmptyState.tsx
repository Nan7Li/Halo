import type { ReactNode } from "react";

// EmptyState: iOS ContentUnavailableView look — no box, a large tertiary
// glyph, Title 3, secondary description, then actions. In dialogs and
// cards it stays compact (smaller padding) so it does not dominate.
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
    <div className="ios-empty-state flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon ? <div className="mb-3 text-label-3 [&_svg]:h-11 [&_svg]:w-11">{icon}</div> : null}
      <div className="ios-headline text-label">{title}</div>
      {subtitle ? <div className="mt-1 max-w-sm ios-subhead text-label-2">{subtitle}</div> : null}
      {actions ? <div className="mt-4 flex items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
