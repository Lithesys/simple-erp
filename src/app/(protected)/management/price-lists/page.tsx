"use client";

import { useEffect, useState } from "react";
import { PriceListManagement } from "@/components/price-list-management";
import { getUserPermissions } from "@/lib/auth";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { canAccessPage } from "@/lib/access-control";

export default function PriceListsPage() {
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);
  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);
  if (!access) return <LoadingSkeleton rows={5} />;
  if (!canAccessPage("priceLists", access.permissions))
    return (
      <div className="alert">Tài khoản không có quyền quản lý bảng giá.</div>
    );
  return <PriceListManagement />;
}
