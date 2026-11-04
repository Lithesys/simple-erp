import { createBrowserClient } from "@supabase/ssr";
import { AUTH_SESSION_COOKIE_OPTIONS } from "@/lib/supabase/auth-cookie-options";

export function createClient() {
  if (browserClient) return browserClient;
  const desktopBuild = process.env.NEXT_PUBLIC_DESKTOP_BUILD === "true";
  const desktopOrigin =
    desktopBuild && typeof window !== "undefined"
      ? "http://127.0.0.1:43121"
      : undefined;
  browserClient = createBrowserClient(
    desktopOrigin ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "http://127.0.0.1:54321",
    desktopBuild
      ? "desktop-public-key"
      : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
          "supabase-not-configured",
    { cookieOptions: AUTH_SESSION_COOKIE_OPTIONS },
  );
  return browserClient;
}

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function isSupabaseConfigured() {
  if (process.env.NEXT_PUBLIC_DESKTOP_BUILD === "true") return true;
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
