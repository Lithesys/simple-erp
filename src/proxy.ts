import { NextResponse, type NextRequest } from "next/server";
import { createSessionProxyClient } from "@/lib/data/proxy";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createSessionProxyClient(url, key, {
    getAll: () => request.cookies.getAll(),
    setAll(cookies) {
      cookies.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      cookies.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options),
      );
    },
  });
  try {
    await supabase.auth.getUser();
  } catch {
    // Keep the login and desktop recovery screens available during outages.
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
