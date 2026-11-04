"use client";

import { useEffect, useState } from "react";
import { CustomerManagement } from "@/components/customer-management";
import { getUserPermissions } from "@/lib/auth";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { canAccessPage, canPerformAction } from "@/lib/access-control";

export default function CustomersPage() {
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);
  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);
  if (!access) return <LoadingSkeleton rows={4} />;
  if (!canAccessPage("customers", access.permissions))
    return (
      <div className="alert">Tài khoản không có quyền xem khách hàng.</div>
    );
  return (
    <CustomerManagement
      canCreate={canPerformAction("customers.create", access.permissions)}
      canUpdate={canPerformAction("customers.update", access.permissions)}
      canDelete={canPerformAction("customers.delete", access.permissions)}
    />
  );
}
