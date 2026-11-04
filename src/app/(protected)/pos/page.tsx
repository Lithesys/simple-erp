"use client";

import { useEffect, useState } from "react";
import { PointOfSale } from "@/components/point-of-sale";
import { getUserPermissions } from "@/lib/auth";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { canAccessPage, canPerformAction } from "@/lib/access-control";

export default function PosPage() {
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);
  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);
  if (!access) return <LoadingSkeleton rows={5} />;
  if (!canAccessPage("pos", access.permissions))
    return <div className="alert">Tài khoản không có quyền tạo đơn hàng.</div>;
  return (
    <PointOfSale
      canEditPrice={canPerformAction("pos.editPrice", access.permissions)}
    />
  );
}
