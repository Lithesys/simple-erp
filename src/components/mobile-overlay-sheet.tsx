"use client";

import { useId, useRef } from "react";
import { X } from "lucide-react";
import { AppButton } from "@/components/app-button";
import { ModalLayer } from "@/components/modal-layer";
import { mergeClassNames } from "@/lib/class-names";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

export function MobileOverlaySheet({
  open,
  title,
  onClose,
  children,
  id,
  className = "",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  useDialogBehavior(open, dialogRef, onClose);

  if (!open) return null;

  return (
    <ModalLayer
      className="mobile-overlay-backdrop"
      data-mobile-overlay-sheet
      onEscape={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        id={id}
        className={mergeClassNames("mobile-overlay-sheet", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="mobile-overlay-header">
          <h2 id={titleId}>{title}</h2>
          <AppButton
            variant="ghost"
            type="button"
            className="mobile-overlay-close mobile-dialog-close"
            aria-label="Đóng"
            onClick={onClose}
          >
            <X size={18} />
          </AppButton>
        </header>
        <div className="mobile-overlay-content">{children}</div>
      </section>
    </ModalLayer>
  );
}
