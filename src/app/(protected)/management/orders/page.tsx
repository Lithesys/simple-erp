"use client";

import { useEffect, useState } from "react";
import { getUserPermissions } from "@/lib/auth";
import { OrdersManagement } from "@/components/orders-management";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { canAccessPage, canPerformAction } from "@/lib/access-control";

export function OrdersPage() {
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);
  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);
  if (!access) return <LoadingSkeleton rows={6} />;
  if (!canAccessPage("orders", access.permissions))
    return <div className="alert">Tài khoản không có quyền xem đơn hàng.</div>;
  return (
    <OrdersManagement
      canReadAll={canPerformAction("orders.readAll", access.permissions)}
      canReadProducts={access.permissions.includes("products.read")}
      canViewProfit={canPerformAction("products.viewCost", access.permissions)}
      canCancel={canPerformAction("orders.delete", access.permissions)}
      canEdit={canPerformAction("orders.edit", access.permissions)}
      canSearchCustomers={canPerformAction(
        "orders.searchCustomers",
        access.permissions,
      )}
      userId={access.user.id}
    />
  );
}

export default OrdersPage;
