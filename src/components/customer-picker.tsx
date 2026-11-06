"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { createClient } from "@/lib/data/client";
import { SearchInputField } from "@/components/search-input-field";
import type { Customer } from "@/lib/customers";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCachedQuery } from "@/lib/query-cache";
import { searchCachedCustomers } from "@/lib/pos-search-cache";

export type CustomerContact = Pick<Customer, "name" | "phone" | "address"> & {
  id?: string;
};

export function CustomerPicker({
  value,
  onChange,
  disabled,
  inputRef,
  compact = false,
  searchOnly = false,
  searchLabel = "Tên khách hàng",
  showInputLabel = true,
  showSearchIcon = true,
  onEnter,
  placeholder = "Tìm theo tên, sđt hoặc địa chỉ · F4",
  suggestionsEnabled = true,
  canCreateCustomer = false,
  onCreateCustomer,
  onEditCustomer,
}: {
  value: CustomerContact;
  onChange: (value: CustomerContact) => void;
  disabled: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  compact?: boolean;
  searchOnly?: boolean;
  searchLabel?: string;
  showInputLabel?: boolean;
  showSearchIcon?: boolean;
  onEnter?: () => void;
  placeholder?: string;
  suggestionsEnabled?: boolean;
  canCreateCustomer?: boolean;
  onCreateCustomer?: () => void;
  onEditCustomer?: (customer: CustomerContact) => void;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const listboxId = `customer-suggestions-${useId()}`;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Customer[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(false);
  const [selecting, setSelecting] = useState(!value.id);
  const localInputRef = useRef<HTMLInputElement>(null);
  const resolvedInputRef = inputRef ?? localInputRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const createCustomerButton =
    canCreateCustomer && onCreateCustomer ? (
      <AppButton
        variant="ghost"
        type="button"
        iconOnly
        className="pos-customer-create"
        aria-label="Thêm khách hàng"
        title="Thêm khách hàng"
        disabled={disabled}
        onClick={onCreateCustomer}
      >
        <Plus size={18} aria-hidden="true" />
      </AppButton>
    ) : null;
  useEffect(() => {
    if (!open || !suggestionsEnabled) return;
    let active = true;
    let fallbackTimer = 0;
    void (async () => {
      setStatus("Đang tìm…");
      let cachedRows: Customer[] | null = null;
      try {
        try {
          cachedRows = await searchCachedCustomers(supabase, value.name);
        } catch {
          // If browser storage is unavailable, continue with the server query.
        }
        if (!active) return;
        if (cachedRows !== null) {
          setRows(cachedRows);
          setActiveIndex(0);
          setStatus(
            cachedRows.length ? "" : "Không tìm thấy khách hàng phù hợp.",
          );
          return;
        }
        fallbackTimer = window.setTimeout(() => {
          void (async () => {
            let data: { rows?: Customer[] } | null = null;
            let error: Error | null = null;
            try {
              data = await fetchCachedQuery(
                queryClient,
                supabase,
                ["customer-suggestions", value.name, 8],
                async () => {
                  const result = await supabase.rpc("search_customers", {
                    p_query: value.name,
                    p_offset: 0,
                    p_limit: 8,
                  });
                  if (result.error) throw result.error;
                  return result.data;
                },
              );
            } catch (caught) {
              error =
                caught instanceof Error ? caught : new Error("Request failed");
            }
            if (!active) return;
            setRows(error ? [] : (data?.rows ?? []));
            setActiveIndex(0);
            setStatus(
              error
                ? "Không tải được gợi ý khách hàng. Bạn vẫn có thể nhập thông tin."
                : data?.rows?.length
                  ? ""
                  : "Không tìm thấy. Bạn có thể nhập khách mới cho hóa đơn này.",
            );
          })();
        }, 200);
      } catch {
        if (active)
          setStatus(
            "Không tải được gợi ý khách hàng. Bạn vẫn có thể nhập thông tin.",
          );
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(fallbackTimer);
    };
  }, [open, value.name, suggestionsEnabled, supabase, queryClient]);

  useLayoutEffect(() => {
    if (!open || !suggestionsEnabled) return;

    function updateMenuPosition() {
      const input = resolvedInputRef.current;
      const menu = menuRef.current;
      if (!input || !menu) return;

      const rect = input.getBoundingClientRect();
      const viewportPadding = 8;
      const availableBelow = Math.max(
        0,
        window.innerHeight - rect.bottom - viewportPadding,
      );
      const availableAbove = Math.max(0, rect.top - viewportPadding);
      const openAbove = availableBelow < 220 && availableAbove > availableBelow;
      const width = Math.min(
        rect.width,
        window.innerWidth - viewportPadding * 2,
      );
      const left = Math.min(
        Math.max(rect.left, viewportPadding),
        window.innerWidth - width - viewportPadding,
      );

      menu.style.left = `${left}px`;
      menu.style.width = `${width}px`;
      menu.style.maxHeight = `${Math.min(
        280,
        openAbove ? availableAbove : availableBelow,
      )}px`;
      menu.style.top = openAbove ? "auto" : `${rect.bottom + 4}px`;
      menu.style.bottom = openAbove
        ? `${window.innerHeight - rect.top + 4}px`
        : "auto";
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [inputRef, open, resolvedInputRef, suggestionsEnabled]);
  function choose(customer: Customer) {
    onChange({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
    });
    setSelected(true);
    setSelecting(false);
    setOpen(false);
  }
  return (
    <div
      className="pos-customer-picker"
      style={
        searchOnly
          ? { display: "grid", gap: 0 }
          : compact
            ? { display: "contents" }
            : { display: "grid", gap: 10, marginBottom: 11 }
      }
    >
      <div
        className="pos-customer-search"
        style={{ position: "relative" }}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (
            !event.currentTarget.contains(nextTarget) &&
            !menuRef.current?.contains(nextTarget)
          )
            setOpen(false);
        }}
      >
        <div className="pos-customer-search-row">
          <div className={showInputLabel ? "form-label" : undefined}>
            {showInputLabel && <span>{searchLabel}</span>}
            {value.id && !selecting ? (
              <div className="pos-customer-selected-field">
                {onEditCustomer ? (
                  <AppButton
                    variant="ghost"
                    type="button"
                    className="pos-customer-selected-value"
                    disabled={disabled}
                    aria-label={`Sửa khách hàng ${value.name}`}
                    onClick={() => onEditCustomer(value)}
                  >
                    <span>{value.name}</span>
                  </AppButton>
                ) : (
                  <div className="pos-customer-selected-value">
                    <span>{value.name}</span>
                  </div>
                )}
                {createCustomerButton}
              </div>
            ) : (
              <SearchInputField
                ref={resolvedInputRef}
                className={showSearchIcon ? "" : "customer-picker-input"}
                showSearchIcon={showSearchIcon}
                endAdornment={createCustomerButton}
                aria-label={searchLabel}
                role="combobox"
                aria-keyshortcuts={searchOnly ? undefined : "F4"}
                aria-autocomplete="list"
                aria-expanded={open && suggestionsEnabled}
                aria-controls={suggestionsEnabled ? listboxId : undefined}
                aria-activedescendant={
                  open && suggestionsEnabled && rows[activeIndex]
                    ? `${listboxId}-option-${activeIndex}`
                    : undefined
                }
                autoComplete="off"
                disabled={disabled}
                maxLength={300}
                placeholder={placeholder}
                value={value.name}
                onFocus={() => setOpen(true)}
                onChange={(name) => {
                  onChange({
                    id: "",
                    name,
                    phone: selected ? "" : value.phone,
                    address: selected ? "" : value.address,
                  });
                  setSelected(false);
                  setSelecting(true);
                  setRows([]);
                  setOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (open && rows[activeIndex]) {
                      choose(rows[activeIndex]);
                      onEnter?.();
                    } else if (value.id) {
                      onEnter?.();
                    }
                    return;
                  }
                  if (!open || !rows.length) return;
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((activeIndex + 1) % rows.length);
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex(
                      (activeIndex + rows.length - 1) % rows.length,
                    );
                  }
                }}
              />
            )}
          </div>
          {value.id && !selecting && (
            <AppButton
              variant="ghost"
              type="button"
              className={
                compact
                  ? "pos-customer-change pos-customer-clear"
                  : "pos-customer-change"
              }
              iconOnly={compact}
              aria-label={compact ? "Xóa khách hàng đã chọn" : "Đổi khách hàng"}
              title={compact ? "Xóa khách hàng" : undefined}
              disabled={disabled}
              onClick={() => {
                onChange({ id: "", name: "", phone: "", address: "" });
                setSelecting(true);
                setOpen(true);
                requestAnimationFrame(() => resolvedInputRef.current?.focus());
              }}
            >
              {compact ? <X size={16} aria-hidden="true" /> : "Đổi"}
            </AppButton>
          )}
        </div>
      </div>
      {open &&
        suggestionsEnabled &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            className="card"
            data-customer-picker-menu
            id={listboxId}
            role="listbox"
            aria-label="Gợi ý khách hàng"
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              zIndex: "var(--z-modal-popover)",
              width: 0,
              maxHeight: 0,
              overflowY: "auto",
              padding: 4,
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setOpen(false);
            }}
          >
            {rows.map((customer, index) => (
              <AppButton
                variant="ghost"
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                id={`${listboxId}-option-${index}`}
                key={customer.id}
                style={{
                  width: "100%",
                  display: "block",
                  textAlign: "left",
                  whiteSpace: "normal",
                  background:
                    activeIndex === index ? "var(--primary-subtle)" : undefined,
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(customer)}
              >
                <b>{customer.name}</b>
                <div className="muted" style={{ fontSize: 11 }}>
                  {customer.phone || "Chưa có số điện thoại"}
                  {customer.address && ` · ${customer.address}`}
                </div>
              </AppButton>
            ))}
            {status && (
              <div
                role="status"
                className="muted"
                style={{ padding: 10, fontSize: 12 }}
              >
                {status}
              </div>
            )}
          </div>,
          document.body,
        )}
      {!searchOnly &&
        (compact ? (
          <details className="pos-customer-contacts">
            <summary>Thông tin liên hệ</summary>
            <div className="pos-customer-contact-fields">
              <label className="form-label">
                Số điện thoại
                <AppInput
                  className="field"
                  type="tel"
                  maxLength={100}
                  disabled={disabled}
                  value={value.phone}
                  onChange={(event) =>
                    onChange({ ...value, phone: event.target.value })
                  }
                />
              </label>
              <label className="form-label">
                Địa chỉ
                <AppInput
                  className="field"
                  maxLength={1000}
                  disabled={disabled}
                  value={value.address}
                  onChange={(event) =>
                    onChange({ ...value, address: event.target.value })
                  }
                />
              </label>
            </div>
          </details>
        ) : (
          <>
            <label className="form-label">
              Số điện thoại
              <AppInput
                className="field"
                type="tel"
                maxLength={100}
                disabled={disabled}
                value={value.phone}
                onChange={(event) =>
                  onChange({ ...value, phone: event.target.value })
                }
              />
            </label>
            <label className="form-label">
              Địa chỉ
              <AppInput
                className="field"
                maxLength={1000}
                disabled={disabled}
                value={value.address}
                onChange={(event) =>
                  onChange({ ...value, address: event.target.value })
                }
              />
            </label>
          </>
        ))}
    </div>
  );
}
