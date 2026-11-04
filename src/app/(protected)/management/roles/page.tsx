"use client";

import { useEffect, useState } from "react";
import { RoleManagement } from "@/components/role-management";
import { getUserPermissions } from "@/lib/auth";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { canAccessPage } from "@/lib/access-control";

export default function RolesPage() {
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);
  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);
  if (!access) return <LoadingSkeleton rows={5} />;
  if (!canAccessPage("roles", access.permissions))
    return (
      <div className="alert">Tài khoản không có quyền quản lý vai trò.</div>
    );
  return <RoleManagement />;
}
