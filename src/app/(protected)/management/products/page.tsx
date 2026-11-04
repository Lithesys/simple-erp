"use client";

import { useEffect, useState } from "react";
import { ProductManagement } from "@/components/product-management";
import { getUserPermissions } from "@/lib/auth";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { canAccessPage, canPerformAction } from "@/lib/access-control";

export function ProductsPage() {
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);
  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);
  if (!access) return <LoadingSkeleton rows={8} />;
  if (!canAccessPage("products", access.permissions))
    return <div className="alert">Tài khoản không có quyền xem hàng hóa.</div>;
  return (
    <ProductManagement
      canCreate={canPerformAction("products.create", access.permissions)}
      canUpdate={canPerformAction("products.update", access.permissions)}
      canAdjustStock={
        canPerformAction("stockChecks.create", access.permissions) &&
        canPerformAction("stockChecks.complete", access.permissions)
      }
      canViewStockChecks={canPerformAction("stockChecks.list", access.permissions)}
      canUpdateCost={canPerformAction(
        "products.updateCost",
        access.permissions,
      )}
      canViewCost={canPerformAction("products.viewCost", access.permissions)}
      canArchive={canPerformAction("products.archive", access.permissions)}
    />
  );
}

export default ProductsPage;
