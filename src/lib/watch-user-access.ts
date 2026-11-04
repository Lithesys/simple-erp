import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const ACCESS_RETRY_DELAY_MS = 5_000;
const MAX_ACCESS_RETRIES = 3;

export type AuthStateListener = (
  event: AuthChangeEvent,
  session: Session | null,
) => void;

export function watchUserAccess<T>({
  subscribe,
  loadAccess,
  onAccess,
  onSessionEnded,
}: {
  subscribe: (listener: AuthStateListener) => () => void;
  loadAccess: () => Promise<T | null>;
  onAccess: (access: T | null) => void;
  onSessionEnded: () => void;
}) {
  let active = true;
  let generation = 0;
  let retryCount = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const refreshAccess = () => {
    const requestGeneration = ++generation;

    void loadAccess()
      .then((access) => {
        if (!active || requestGeneration !== generation) return;
        retryCount = 0;
        onAccess(access);
        if (!access) onSessionEnded();
      })
      .catch(() => {
        if (
          !active ||
          requestGeneration !== generation ||
          retryCount >= MAX_ACCESS_RETRIES
        )
          return;
        retryCount += 1;
        refreshTimer = setTimeout(() => {
          refreshTimer = undefined;
          if (active && requestGeneration === generation) refreshAccess();
        }, ACCESS_RETRY_DELAY_MS);
      });
  };

  const unsubscribe = subscribe((event, session) => {
    generation += 1;
    retryCount = 0;
    if (refreshTimer !== undefined) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }

    if (event === "SIGNED_OUT" || !session) {
      onAccess(null);
      onSessionEnded();
      return;
    }

    const eventGeneration = generation;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (!active || eventGeneration !== generation) return;
      refreshAccess();
    }, 0);
  });

  refreshAccess();

  return () => {
    active = false;
    generation += 1;
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    unsubscribe();
  };
}
