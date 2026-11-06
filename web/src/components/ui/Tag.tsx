import type { ReactNode } from "react";
import { cx } from "../../lib/utils";

export type TagType = "success" | "danger" | "warning" | "info" | "primary";

const TONE: Record<TagType, string> = {
  success: "bg-sys-green/15 text-sys-green",
  danger: "bg-sys-red/15 text-sys-red",
  warning: "bg-sys-orange/15 text-sys-orange",
  info: "bg-fill-3 text-label-2",
  primary: "bg-accent/15 text-accent",
};

// el-tag equivalent.
export function Tag({ type = "info", children, className }: { type?: TagType; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold",
        TONE[type],
        className,
      )}
    >
      {children}
    </span>
  );
}
