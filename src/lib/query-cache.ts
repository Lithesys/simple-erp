import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";

export const QUERY_STALE_TIME = 30_000;

/** Cache a Supabase read under an authenticated-user-scoped, parameterized key. */
export async function fetchCachedQuery<T>(
  queryClient: QueryClient,
  supabase: SupabaseClient,
  key: QueryKey,
  queryFn: () => Promise<T>,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return queryClient.fetchQuery({
    queryKey: [...key, session?.user.id ?? "anonymous"],
    queryFn,
    staleTime: QUERY_STALE_TIME,
  });
}

export async function invalidateQuery(queryClient: QueryClient, key: QueryKey) {
  await queryClient.invalidateQueries({ queryKey: key });
}
