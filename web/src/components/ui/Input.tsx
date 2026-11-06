import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cx } from "../../lib/utils";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  prefix?: ReactNode;
  suffix?: ReactNode;
  inputSize?: "default" | "large";
}

const FIELD =
  "w-full border-0 bg-fill-3 px-3.5 text-[16px] tracking-[-0.02em] text-label outline-none lg:text-[15px] " +
  "transition-[box-shadow,background-color] duration-200 " +
  "placeholder:text-label-3 focus:bg-fill-4 focus:ring-2 focus:ring-accent/35 " +
  "disabled:cursor-not-allowed disabled:text-label-3";

// el-input equivalent with optional prefix/suffix icons.
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { prefix, suffix, inputSize = "default", className, ...rest },
  ref,
) {
  return (
    <div className={cx("relative flex w-full items-center", className)}>
      {prefix && (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-label-3">
          {prefix}
        </span>
      )}
      <input
        ref={ref}
        className={cx(
          FIELD,
          "rounded-full",
          inputSize === "large" ? "h-12" : "h-11",
          prefix ? "pl-10" : null,
          suffix ? "pr-10" : null,
        )}
        {...rest}
      />
      {suffix && (
        <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-label-3">{suffix}</span>
      )}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(FIELD, "rounded-[18px] py-2.5", className)}
      {...rest}
    />
  );
});
