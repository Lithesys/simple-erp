"use client";

import { useEffect, useState } from "react";
import { getUserPermissions } from "@/lib/auth";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { PurchaseManagement } from "@/components/purchase-management";
import { canAccessPage, canPerformAction } from "@/lib/access-control";

export default function PurchasePage() {
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);
  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);
  if (!access) return <LoadingSkeleton rows={5} />;
  if (!canAccessPage("purchase", access.permissions))
    return (
      <div className="alert">Tài khoản không có quyền truy cập nhập hàng.</div>
    );
  return (
    <PurchaseManagement
      permissions={{
        canRead: canPerformAction("purchases.read", access.permissions),
        canList: canPerformAction("purchases.list", access.permissions),
        canCreate: canPerformAction("purchases.create", access.permissions),
        canOverrideCreateCost: canPerformAction(
          "purchases.createCostOverride",
          access.permissions,
        ),
        canUpdate: canPerformAction("purchases.update", access.permissions),
        canEdit: canPerformAction("purchases.edit", access.permissions),
        canDelete: canPerformAction("purchases.delete", access.permissions),
        canApprove: canPerformAction("purchases.approve", access.permissions),
        canViewCost: canPerformAction("purchases.viewCost", access.permissions),
      }}
    />
  );
}
