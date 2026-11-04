"use client";

import { createClient } from "@/lib/data/client";
import type { Permission } from "@/lib/types";

export async function getUserPermissions({
  throwOnError = false,
}: { throwOnError?: boolean } = {}) {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    if (throwOnError) throw userError;
    return null;
  }
  if (!user) return null;
  const { data, error } = await supabase.rpc("current_user_access");
  if (error) {
    if (throwOnError) throw error;
    return null;
  }
  if (!data?.[0]?.is_active) return null;
  return {
    user,
    name: data[0].display_name || user.email || "Tài khoản",
    role: data[0].role_name as string,
    permissions: data[0].permissions as Permission[],
    can: (permission: Permission) =>
      (data[0].permissions as Permission[]).includes(permission),
  };
}
