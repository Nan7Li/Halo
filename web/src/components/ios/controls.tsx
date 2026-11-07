import { useRef, type ReactNode } from "react";
import { SearchRegular, DismissCircleFilled } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { useLift, useSlidingIndicator } from "./core";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/** UISegmentedControl with a spring-animated thumb. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  pill = false,
  block = false,
  className,
  ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  pill?: boolean;
  block?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = options.findIndex((option) => option.value === value);
  const thumb = useSlidingIndicator(ref, active);
  const moving = useLift(active);
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      className={cx("ios-segmented", moving && "is-moving", pill && "is-pill", block && "grid w-full", className)}
    >
      <span className="ios-segment-thumb" style={thumb} aria-hidden />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          data-indicator-item
          aria-selected={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cx("ios-segment", option.value === value && "is-active", option.disabled && "opacity-40")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function IOSSwitch({
  checked,
  onChange,
  disabled,
  small,
  ariaLabel,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  small?: boolean;
  ariaLabel?: string;
}) {
  const moving = useLift(checked);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange?.(!checked);
      }}
      className={cx(
        "ios-switch outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-grouped-2",
        checked && "is-on",
        moving && "is-moving",
        small && "is-small",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="ios-switch-knob" />
    </button>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  ariaLabel,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className={cx("ios-slider", className)}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      style={{ ["--fill" as string]: `${fill}%` }}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  pill,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  pill?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  return (
    <label className={cx("ios-search", pill && "is-pill glass", className)}>
      <SearchRegular className="h-[18px] w-[18px] shrink-0" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder ?? t("搜索")}
        onChange={(event) => onChange(event.target.value)}
        className="[&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" aria-label={t("清除")} onClick={() => onChange("")} className="text-label-3">
          <DismissCircleFilled className="h-[18px] w-[18px]" />
        </button>
      ) : null}
    </label>
  );
}
