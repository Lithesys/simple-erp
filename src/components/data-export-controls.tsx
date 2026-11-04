"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Download, X } from "lucide-react";
import { AppButton } from "@/components/app-button";
import { ModalLayer } from "@/components/modal-layer";
import { AppInput } from "@/components/app-input";
import { useStableCallback } from "@/lib/use-stable-callback";

export type DataExportFieldOption = { key: string; label: string };
export type DataExportFieldGroup = {
  key: string;
  label: string;
  fields: DataExportFieldOption[];
};

export function DataExportMenu({
  disabled = false,
  busy = false,
  onOverview,
  onDetails,
}: {
  disabled?: boolean;
  busy?: boolean;
  onOverview: () => void;
  onDetails: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const handleToggle = useStableCallback(() => setOpen((value) => !value));
  const handleOverview = useStableCallback(() => {
    setOpen(false);
    onOverview();
  });
  const handleDetails = useStableCallback(() => {
    setOpen(false);
    onDetails();
  });

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="data-export-menu-wrap" ref={menuRef}>
      <AppButton
        variant="default"
        className="data-export-menu-trigger"
        type="button"
        aria-label={busy ? "Đang xuất dữ liệu" : "Xuất dữ liệu"}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy}
        onClick={handleToggle}
      >
        <Download size={15} />
        <span className="mobile-button-label">
          {busy ? "Đang xuất…" : "Xuất dữ liệu"}
        </span>
      </AppButton>
      {open && (
        <div
          className="data-export-menu"
          role="menu"
          aria-label="Tùy chọn xuất dữ liệu"
        >
          <AppButton
            variant="ghost"
            type="button"
            role="menuitem"
            onClick={handleOverview}
          >
            Tổng quan
          </AppButton>
          <AppButton
            variant="ghost"
            type="button"
            role="menuitem"
            onClick={handleDetails}
          >
            Chi tiết
          </AppButton>
        </div>
      )}
    </div>
  );
}

export function DataExportFieldModal({
  title,
  description = "Chọn ít nhất 1 cột để xuất file.",
  groups,
  defaultSelectedKeys,
  busy = false,
  submitDisabled = false,
  error = "",
  children,
  onCancel,
  onExport,
}: {
  title: string;
  description?: string;
  groups: DataExportFieldGroup[];
  defaultSelectedKeys: string[];
  busy?: boolean;
  submitDisabled?: boolean;
  error?: string;
  children?: ReactNode;
  onCancel: () => void;
  onExport: (selectedKeys: string[]) => void | Promise<void>;
}) {
  const titleId = useId();
  const [selectedKeys, setSelectedKeys] = useState(defaultSelectedKeys);
  const allKeys = groups.flatMap((group) =>
    group.fields.map((field) => field.key),
  );
  const allSelected =
    allKeys.length > 0 && allKeys.every((key) => selectedKeys.includes(key));
  const handleSubmit = useStableCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!busy && selectedKeys.length)
        void onExport(selectedKeys.filter((key) => allKeys.includes(key)));
    },
  );

  function toggleField(key: string, checked: boolean) {
    setSelectedKeys((current) =>
      checked
        ? current.includes(key)
          ? current
          : [...current, key]
        : current.filter((value) => value !== key),
    );
  }

  return (
    <ModalLayer
      className="modal-backdrop no-print"
      onEscape={() => {
        if (!busy) onCancel();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        className="modal card data-export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={handleSubmit}
      >
        <div className="modal-title data-export-title">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p className="muted">{description}</p>
          </div>
          <AppButton
            variant="ghost"
            type="button"
            aria-label="Đóng tùy chọn xuất"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={18} />
          </AppButton>
        </div>
        <div className="data-export-scroll">
          {children && (
            <div className="data-export-custom-controls">{children}</div>
          )}
          {groups.map((group) => {
            const selectedCount = group.fields.filter((field) =>
              selectedKeys.includes(field.key),
            ).length;
            return (
              <section
                className="data-export-section"
                key={group.key}
                aria-label={group.label}
              >
                <div className="data-export-section-title">
                  <h3>{group.label}</h3>
                  <span>
                    {selectedCount}/{group.fields.length}
                  </span>
                </div>
                <div className="data-export-fields">
                  {group.fields.map((field) => (
                    <label key={field.key} className="data-export-field">
                      <AppInput
                        type="checkbox"
                        checked={selectedKeys.includes(field.key)}
                        disabled={busy}
                        onChange={(event) =>
                          toggleField(field.key, event.target.checked)
                        }
                      />
                      {field.label}
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="data-export-footer">
          <AppButton
            variant="ghost"
            className="data-export-select-all"
            type="button"
            disabled={busy || allKeys.length === 0}
            onClick={() => setSelectedKeys(allSelected ? [] : allKeys)}
          >
            {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </AppButton>
          <div className="form-actions">
            <AppButton
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={onCancel}
            >
              Bỏ qua
            </AppButton>
            <AppButton
              variant="primary"
              type="submit"
              disabled={busy || submitDisabled || selectedKeys.length === 0}
            >
              {busy ? "Đang xuất…" : "Xuất file"}
            </AppButton>
          </div>
        </div>
      </form>
    </ModalLayer>
  );
}
