"use client";

import { useEffect, useState } from "react";
import { PrintTemplateManagement } from "@/components/print-template-management";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { canAccessPage, canPerformAction } from "@/lib/access-control";
import { getUserPermissions } from "@/lib/auth";

export default function PrintTemplatesPage() {
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);

  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);

  if (!access) return <LoadingSkeleton rows={4} />;
  if (!canAccessPage("printTemplates", access.permissions)) {
    return <div className="alert">Tài khoản không có quyền xem mẫu in.</div>;
  }

  return (
    <PrintTemplateManagement
      canCreate={canPerformAction("printTemplates.create", access.permissions)}
      canUpdate={canPerformAction("printTemplates.update", access.permissions)}
      canDelete={canPerformAction("printTemplates.delete", access.permissions)}
    />
  );
}
