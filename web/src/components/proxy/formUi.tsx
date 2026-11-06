import type { ReactNode } from "react";
import { Switch } from "../ui";

/** Group header inside a dialog: iOS list header (13pt secondary). */
export function SectionHeader({ title }: { tone?: "indigo" | "amber" | "green"; title: string }) {
  return <h3 className="px-0.5 pb-1 pt-3 ios-footnote font-medium text-label-2">{title}</h3>;
}

/** Label + control as one iOS form row (see .ios-form-row). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ios-form-row">
      <label className="ios-form-label">{label}</label>
      <div className="ios-form-control">{children}</div>
    </div>
  );
}

/** A switch row: title and footnote on the leading side, switch trailing. */
export function ToggleRow({
  title,
  subtitle,
  checked,
  onChange,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="ios-form-row items-center">
      <div className="min-w-0 flex-1 py-1">
        <div className="ios-body text-label">{title}</div>
        <div className="mt-0.5 ios-footnote text-label-2">{subtitle}</div>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}
