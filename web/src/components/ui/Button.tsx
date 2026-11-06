import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../../lib/utils";
import { Spinner } from "./Spinner";

export type ButtonVariant = "default" | "primary" | "danger" | "success" | "warning" | "text";
export type ButtonSize = "small" | "default" | "large";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
  plain?: boolean;
}

const SIZE: Record<ButtonSize, string> = {
  small: "h-8 px-3.5 text-[13px]",
  default: "h-10 px-[18px] text-[15px]",
  large: "h-[50px] px-6 text-[17px]",
};

// iOS 27 button styles: filled (prominent), tinted (plain), gray (default)
// and borderless (text). Filled and gray buttons are capsules.
const SOLID: Record<string, string> = {
  primary: "bg-accent text-[var(--color-on-primary)] hover:brightness-110 active:brightness-95",
  danger: "bg-sys-red text-white hover:brightness-110 active:brightness-95",
  success: "bg-sys-green text-white hover:brightness-110 active:brightness-95",
  warning: "bg-sys-orange text-white hover:brightness-110 active:brightness-95",
};

const PLAIN: Record<string, string> = {
  primary: "bg-accent/15 text-accent hover:bg-accent/20",
  danger: "bg-sys-red/15 text-sys-red hover:bg-sys-red/20",
  success: "bg-sys-green/15 text-sys-green hover:bg-sys-green/20",
  warning: "bg-sys-orange/15 text-sys-orange hover:bg-sys-orange/20",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "default",
    size = "default",
    loading = false,
    icon,
    block = false,
    plain = false,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const isText = variant === "text";
  const isDefault = variant === "default";
  const isDisabled = disabled || loading;

  const variantClass = isText
    ? "bg-transparent text-accent hover:bg-fill-4"
    : isDefault
      ? "bg-fill-3 text-label hover:bg-fill-2"
      : plain
        ? PLAIN[variant]
        : SOLID[variant];

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={cx(
        "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-0 font-semibold tracking-[-0.01em] outline-none",
        "ios-press transition-[transform,background-color,filter,color] duration-200",
        "focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-grouped",
        "disabled:cursor-not-allowed",
        loading ? "opacity-80" : "disabled:opacity-40",
        SIZE[size],
        isText && "px-2",
        block && "w-full",
        variantClass,
        className,
      )}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Spinner className={size === "small" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : icon ? (
        <span className="inline-flex shrink-0 items-center text-[1.1em]">{icon}</span>
      ) : null}
      {children ? <span className="inline-flex items-center gap-1.5">{children}</span> : null}
    </button>
  );
});
