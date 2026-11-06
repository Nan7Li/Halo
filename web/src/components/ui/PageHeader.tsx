import type { ReactNode } from "react";

/** Large-title header for screens that are not wrapped in <Page>. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 px-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="ios-title-1 text-label">{title}</h2>
        {subtitle ? <p className="mt-1 ios-subhead text-label-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="min-w-0 shrink-0">{actions}</div> : null}
    </div>
  );
}
