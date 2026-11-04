"use client";

import { useRef } from "react";
import { mergeClassNames } from "@/lib/class-names";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";
import { ModalLayer } from "@/components/modal-layer";

export function EntityDetailModal({
  open,
  onClose,
  children,
  className,
  panelClassName,
  ariaLabel,
  presentation = "overlay",
  renderWhenClosed = false,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  ariaLabel?: string;
  presentation?: "overlay" | "inline";
  renderWhenClosed?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(open && presentation === "overlay", dialogRef, onClose);

  if (!open) return renderWhenClosed ? <>{children}</> : null;
  if (presentation === "inline") return <>{children}</>;

  return (
    <ModalLayer
      ref={dialogRef}
      className={mergeClassNames("modal-backdrop no-print", className)}
      onEscape={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {panelClassName ? (
        <section
          className={mergeClassNames("modal card", panelClassName)}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
        >
          {children}
        </section>
      ) : (
        children
      )}
    </ModalLayer>
  );
}
