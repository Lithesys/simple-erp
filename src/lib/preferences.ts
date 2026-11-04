"use client";

import { useEffect, useState } from "react";

export function usePreference<T>(key: string, initial: T) {
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`erp-preference:${key}`);
      // Restore a preference after hydration so server and client markup match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved !== null) setValue(JSON.parse(saved) as T);
    } catch {
      /* Invalid preferences fall back to the default. */
    }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (ready)
      localStorage.setItem(`erp-preference:${key}`, JSON.stringify(value));
  }, [key, ready, value]);
  return [value, setValue, ready] as const;
}
