"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getUserPermissions } from "@/lib/auth";
import { createClient } from "@/lib/data/client";
import { watchUserAccess } from "@/lib/watch-user-access";

export type UserAccess = NonNullable<
  Awaited<ReturnType<typeof getUserPermissions>>
>;

export function useUserAccess() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [access, setAccess] = useState<UserAccess | undefined>();

  useEffect(() => {
    return watchUserAccess({
      subscribe: (listener) => {
        const { data } = supabase.auth.onAuthStateChange(listener);
        return () => data.subscription.unsubscribe();
      },
      loadAccess: () => getUserPermissions({ throwOnError: true }),
      onAccess: (value) => setAccess(value ?? undefined),
      onSessionEnded: () => router.replace("/login"),
    });
  }, [router, supabase]);

  const signOut = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
          signal: AbortSignal.timeout(2000),
        });
      } catch {
        // Keep logout responsive if activity logging is unavailable.
      }
    }
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/login");
  }, [router, supabase]);

  return { access, signOut };
}
