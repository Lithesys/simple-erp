import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { AUTH_SESSION_COOKIE_OPTIONS } from "@/lib/supabase/auth-cookie-options";

export async function createRequestClient(request?: NextRequest) {
  const cookieStore = request ? null : await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request?.cookies.getAll() ?? cookieStore!.getAll();
        },
        setAll(values) {
          for (const { name, value, options } of values) {
            if (request) request.cookies.set(name, value);
            else cookieStore!.set(name, value, options);
          }
        },
      },
    },
  );
}
