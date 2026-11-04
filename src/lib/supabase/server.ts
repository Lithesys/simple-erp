import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createServiceClient() {
  const desktopBuild = process.env.ERP_DESKTOP_BUILD === "true";
  const desktopMode = process.env.ERP_DESKTOP_MODE;
  const remoteSupabase = desktopMode === "supabase";
  const url = remoteSupabase
    ? process.env.NEXT_PUBLIC_SUPABASE_URL
    : desktopBuild
      ? process.env.ERP_DESKTOP_GATEWAY_URL
      : process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = remoteSupabase
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : desktopBuild
      ? process.env.ERP_DESKTOP_SERVICE_KEY
      : process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Thiếu cấu hình kết nối Supabase phía máy chủ.");
  const global =
    desktopBuild && !remoteSupabase
      ? {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            headers.set(
              "x-desktop-service-key",
              process.env.ERP_DESKTOP_SERVICE_KEY || "",
            );
            return fetch(input, { ...init, headers });
          },
        }
      : undefined;
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(global ? { global } : {}),
  });
}
