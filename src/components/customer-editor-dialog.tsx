"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { AppTextarea } from "@/components/app-textarea";
import { ModalLayer } from "@/components/modal-layer";
import type { Customer } from "@/lib/customers";
import { useForm } from "react-hook-form";

type CustomerEditorValues = Pick<Customer, "name" | "phone" | "address">;

export function CustomerEditorDialog({
  customer,
  busy,
  error,
  onClose,
  onSave,
}: {
  customer: Customer | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (customer: Customer) => void | Promise<void>;
}) {
  const { register, handleSubmit } = useForm<CustomerEditorValues>({
    defaultValues: {
      name: customer?.name ?? "",
      phone: customer?.phone ?? "",
      address: customer?.address ?? "",
    },
  });

  if (!customer) return null;

  return (
    <ModalLayer className="modal-backdrop" onEscape={onClose}>
      <form
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-label={customer.id ? "Sửa khách hàng" : "Thêm khách hàng"}
        onSubmit={handleSubmit((values) =>
          onSave({ ...values, id: customer.id }),
        )}
      >
        <h2>{customer.id ? "Sửa khách hàng" : "Thêm khách hàng"}</h2>
        <div style={{ display: "grid", gap: "var(--form-field-gap)" }}>
          <label className="form-label">
            Tên khách hàng
            <AppInput
              className="field"
              autoFocus
              required
              maxLength={300}
              {...register("name", { required: true, maxLength: 300 })}
            />
          </label>
          <label className="form-label">
            Số điện thoại
            <AppInput
              className="field"
              type="tel"
              maxLength={100}
              {...register("phone", { maxLength: 100 })}
            />
          </label>
          <label className="form-label">
            Địa chỉ
            <AppTextarea
              maxLength={1000}
              rows={4}
              {...register("address", { maxLength: 1000 })}
            />
          </label>
        </div>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <AppButton
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Hủy
          </AppButton>
          <AppButton variant="primary" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu khách hàng"}
          </AppButton>
        </div>
      </form>
    </ModalLayer>
  );
}
