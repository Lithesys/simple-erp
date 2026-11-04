"use client";

import { AppButton } from "@/components/app-button";
import { mergeClassNames } from "@/lib/class-names";

import { Plus, X } from "lucide-react";
import { usePosOrderTabs } from "@/components/pos-order-tabs-context";

export function PosOrderTabs() {
  const {
    orders,
    activeOrderId,
    isBusy,
    activateOrder,
    createOrder,
    closeOrder,
  } = usePosOrderTabs();

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % orders.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + orders.length) % orders.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = orders.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const order = orders[nextIndex];
    activateOrder(order.id);
    document.getElementById(`pos-order-tab-${order.id}`)?.focus();
  }

  return (
    <div className="pos-order-tabs">
      <div
        className="pos-order-tab-list"
        role="tablist"
        aria-label="Hóa đơn đang mở"
      >
        {orders.map((order, index) => {
          const active = order.id === activeOrderId;
          const tabId = `pos-order-tab-${order.id}`;
          return (
            <div
              key={order.id}
              className={mergeClassNames(
                "pos-order-tab-group",
                active && "active",
              )}
              role="presentation"
            >
              <AppButton variant="ghost"
                id={tabId}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="pos-order-panel"
                tabIndex={active ? 0 : -1}
                className="pos-order-tab"
                onClick={() => activateOrder(order.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <span>{order.name}</span>
              </AppButton>
              {orders.length > 1 && (
                <AppButton variant="ghost"
                  type="button"
                  className="pos-order-tab-close"
                  aria-label={`Đóng ${order.name}`}
                  title={`Đóng ${order.name}`}
                  disabled={isBusy}
                  onClick={() => closeOrder(order.id)}
                >
                  <X size={14} aria-hidden="true" />
                </AppButton>
              )}
            </div>
          );
        })}
      </div>
      <AppButton variant="ghost"
        type="button"
        className="pos-order-new"
        aria-label="Tạo hóa đơn mới"
        aria-keyshortcuts="F1"
        title="Tạo hóa đơn mới (F1)"
        disabled={isBusy}
        onClick={createOrder}
      >
        <Plus size={18} aria-hidden="true" />
      </AppButton>
    </div>
  );
}
