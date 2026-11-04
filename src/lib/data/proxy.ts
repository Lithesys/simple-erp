import { createServerClient } from "@supabase/ssr";
import { AUTH_SESSION_COOKIE_OPTIONS } from "@/lib/supabase/auth-cookie-options";

export function createSessionProxyClient(
  url: string,
  key: string,
  cookies: NonNullable<Parameters<typeof createServerClient>[2]>["cookies"],
) {
  return createServerClient(url, key, {
    cookieOptions: AUTH_SESSION_COOKIE_OPTIONS,
    cookies,
  });
}
