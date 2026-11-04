/** Shared server-side data/auth entry point for ERP routes. */
import { createClient as createSupabaseAuthClient } from "@supabase/supabase-js";
import { createRequestClient } from "@/lib/supabase/request";
import { createServiceClient } from "@/lib/supabase/server";

export { createRequestClient, createServiceClient };

export function createAuthClient(
  url: string,
  key: string,
  options: Parameters<typeof createSupabaseAuthClient>[2],
) {
  return createSupabaseAuthClient(url, key, options);
}
