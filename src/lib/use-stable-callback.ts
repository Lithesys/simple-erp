import { useCallback, useEffect, useRef } from "react";

/** Keeps an event handler's identity stable while calling its latest implementation. */
export function useStableCallback<
  Callback extends (...args: never[]) => unknown,
>(callback: Callback): Callback {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const stableCallback = useCallback(
    (...args: Parameters<Callback>) => callbackRef.current(...args),
    [],
  );

  return stableCallback as Callback;
}
