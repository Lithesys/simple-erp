"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { APP_NAVIGATION_START_EVENT } from "@/lib/navigation-progress";

export function useNavigationFeedback(pathname: string, isMobileRoute: boolean) {
  const [navigationPending, setNavigationPending] = useState(false);
  const navigationPendingRef = useRef(false);
  const navigationStartPathRef = useRef(pathname);
  const navigationStartedAtRef = useRef(0);
  const navigationFallbackTimerRef = useRef<number | null>(null);

  const finishNavigationFeedback = useCallback(() => {
    navigationPendingRef.current = false;
    if (navigationFallbackTimerRef.current !== null) {
      window.clearTimeout(navigationFallbackTimerRef.current);
      navigationFallbackTimerRef.current = null;
    }
    setNavigationPending(false);
  }, []);

  const beginNavigationFeedback = useCallback(() => {
    if (!isMobileRoute || navigationPendingRef.current) return;

    navigationPendingRef.current = true;
    navigationStartPathRef.current = pathname;
    navigationStartedAtRef.current = Date.now();
    setNavigationPending(true);

    navigationFallbackTimerRef.current = window.setTimeout(
      finishNavigationFeedback,
      10_000,
    );
  }, [finishNavigationFeedback, isMobileRoute, pathname]);

  useEffect(() => {
    window.addEventListener(
      APP_NAVIGATION_START_EVENT,
      beginNavigationFeedback,
    );
    window.addEventListener("popstate", beginNavigationFeedback);
    return () => {
      window.removeEventListener(
        APP_NAVIGATION_START_EVENT,
        beginNavigationFeedback,
      );
      window.removeEventListener("popstate", beginNavigationFeedback);
    };
  }, [beginNavigationFeedback]);

  useEffect(() => {
    if (
      !navigationPendingRef.current ||
      pathname === navigationStartPathRef.current
    ) {
      return;
    }

    const minimumVisibleMs = 600;
    const elapsedMs = Date.now() - navigationStartedAtRef.current;
    const timeout = window.setTimeout(
      finishNavigationFeedback,
      Math.max(0, minimumVisibleMs - elapsedMs),
    );

    return () => window.clearTimeout(timeout);
  }, [finishNavigationFeedback, pathname]);

  const handleShellNavigationClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (
        !isMobileRoute ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      ) {
        return;
      }

      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin === window.location.origin &&
        destination.pathname !== window.location.pathname
      ) {
        beginNavigationFeedback();
      }
    },
    [beginNavigationFeedback, isMobileRoute],
  );

  return {
    navigationPending,
    handleShellNavigationClick,
  };
}
