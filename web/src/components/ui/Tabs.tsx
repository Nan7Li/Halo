import { useRef, type ReactNode } from "react";
import { cx } from "../../lib/utils";
import { useSlidingIndicator } from "../ios/core";

export interface TabItem {
  key: string;
  label: ReactNode;
  disabled?: boolean;
}

/** Horizontally scrolling capsule tabs with a spring-animated selection. */
export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = tabs.findIndex((tab) => tab.key === value);
  const lens = useSlidingIndicator(ref, active);
  return (
    <div className={cx("relative", className)}>
      <div
        ref={ref}
        role="tablist"
        className="relative flex w-max max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-fill-3 p-[3px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <span
          aria-hidden
          className="absolute bottom-[3px] left-0 top-[3px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-[transform,width] duration-[var(--dur-spring-snappy)] ease-spring-snappy dark:bg-[#636366]"
          style={lens}
        />
        {tabs.map((tab) => {
          const selected = tab.key === value;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              data-indicator-item
              aria-selected={selected}
              disabled={tab.disabled}
              onClick={() => onChange(tab.key)}
              className={cx(
                "ui-tab relative z-[1] h-8 shrink-0 whitespace-nowrap rounded-full px-4 text-[14px] outline-none ios-press",
                "disabled:cursor-not-allowed disabled:opacity-40",
                selected ? "font-semibold text-label" : "font-medium text-label-2 hover:text-label",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
