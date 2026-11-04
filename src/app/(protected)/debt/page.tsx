"use client";

import { useEffect, useState } from "react";
import { DebtManagement } from "@/components/debt-management";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { getUserPermissions } from "@/lib/auth";
import { canAccessPage, canPerformAction } from "@/lib/access-control";

export function DebtPage() {
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);

  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);

  if (!access) return <LoadingSkeleton rows={4} />;
  if (!canAccessPage("debt", access.permissions))
    return <div className="alert">Tài khoản không có quyền xem công nợ.</div>;

  return (
    <DebtManagement
      canRead={access.can("debts.read")}
      canCreate={canPerformAction("debts.create", access.permissions)}
      canUpdate={canPerformAction("debts.update", access.permissions)}
      canDelete={canPerformAction("debts.delete", access.permissions)}
      canReport={canPerformAction("debts.report", access.permissions)}
    />
  );
}

export default DebtPage;
