import type { ReactNode } from "react";
import { Sheet } from "../ios/sheet";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
  showClose?: boolean;
  closeOnOverlay?: boolean;
  className?: string;
  bodyClassName?: string;
}

/** Legacy modal API, presented as an iOS sheet. */
export function Modal({
  open,
  onClose,
  title,
  width = "max-w-lg",
  children,
  footer,
  showClose = true,
  closeOnOverlay = true,
  className,
  bodyClassName,
}: ModalProps) {
  // Old callers pass "max-w-*"; on phones the sheet is always full width.
  const desktopWidth = width
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.startsWith("max-w-") || token.startsWith("w-") ? `md:${token}` : token))
    .join(" ");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={footer}
      showClose={showClose}
      dismissible={closeOnOverlay}
      width={desktopWidth}
      className={className}
      bodyClassName={bodyClassName}
    >
      {children}
    </Sheet>
  );
}
