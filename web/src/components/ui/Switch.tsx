import { IOSSwitch } from "../ios/controls";

export interface SwitchProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  size?: "default" | "small";
  ariaLabel?: string;
}

export function Switch({ checked, onChange, disabled, loading, size = "default", ariaLabel }: SwitchProps) {
  return <IOSSwitch checked={checked} onChange={onChange} disabled={disabled || loading} small={size === "small"} ariaLabel={ariaLabel} />;
}
