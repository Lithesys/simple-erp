"use client";

import { useCallback, useRef, useState } from "react";

/** Keep table content mounted while background queries refresh it. */
export function useInitialTableLoading() {
  const [loading, setLoading] = useState(true);
  const hasFinishedInitialLoad = useRef(false);

  const finishInitialLoad = useCallback(() => {
    if (hasFinishedInitialLoad.current) return;
    hasFinishedInitialLoad.current = true;
    setLoading(false);
  }, []);

  return { loading, finishInitialLoad };
}
