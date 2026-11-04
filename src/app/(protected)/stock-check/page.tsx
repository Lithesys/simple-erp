"use client";

import { useEffect, useState } from "react";
import { StockCheckManagement } from "@/components/stock-check-management";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { getUserPermissions } from "@/lib/auth";
import { canAccessPage, canPerformAction } from "@/lib/access-control";

export default function StockCheckPage() {
  const [access, setAccess] = useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);
  useEffect(() => { getUserPermissions().then(setAccess); }, []);
  if (!access) return <LoadingSkeleton rows={8} />;
  if (!canAccessPage("stockCheck", access.permissions))
    return <div className="alert">Tài khoản không có quyền truy cập kiểm kho.</div>;
  return <StockCheckManagement permissions={{
    canList: canPerformAction("stockChecks.list", access.permissions),
    canCreate: canPerformAction("stockChecks.create", access.permissions),
    canUpdate: canPerformAction("stockChecks.update", access.permissions),
    canDelete: canPerformAction("stockChecks.delete", access.permissions),
    canComplete: canPerformAction("stockChecks.complete", access.permissions),
    canExport: canPerformAction("stockChecks.export", access.permissions),
    canViewCost: canPerformAction("products.viewCost", access.permissions),
  }} />;
}
