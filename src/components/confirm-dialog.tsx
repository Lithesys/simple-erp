"use client";

import { AppButton } from "@/components/app-button";
import { ModalLayer } from "@/components/modal-layer";
import { X } from "lucide-react";

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  showCloseButton?: boolean;
};

export function ConfirmDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: ConfirmRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!request) return null;
  return (
    <ModalLayer
      className="modal-backdrop"
      onEscape={onCancel}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="modal card confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className="modal-title">
          <h2 id="confirm-title">{request.title}</h2>
          {request.showCloseButton && (
            <AppButton
              type="button"
              variant="ghost"
              iconOnly
              aria-label="Đóng hộp thoại"
              title="Đóng"
              onClick={onCancel}
            >
              <X size={18} aria-hidden="true" />
            </AppButton>
          )}
        </div>
        <p id="confirm-message" className="muted">
          {request.message}
        </p>
        <div className="form-actions">
          <AppButton type="button" variant="secondary" onClick={onCancel}>
            Hủy
          </AppButton>
          <AppButton
            type="button"
            variant={request.confirmVariant ?? "danger"}
            onClick={onConfirm}
          >
            {request.confirmLabel || "Xác nhận"}
          </AppButton>
        </div>
      </section>
    </ModalLayer>
  );
}
