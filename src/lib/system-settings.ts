"use client";

import { useEffect, useState } from "react";

const AUTO_PRINT_STORAGE_PREFIX = "erp-preference:system:v1:autoPrint:";
const SILENT_PRINT_STORAGE_KEY = "erp-preference:system:v1:silentPrint";

export function getSilentPrintSetting() {
  try {
    return localStorage.getItem(SILENT_PRINT_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function useSilentPrintSetting() {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SILENT_PRINT_STORAGE_KEY);
      // Settings hydrate from browser storage after server markup is sent.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnabled(saved === null ? true : JSON.parse(saved) === true);
    } catch {
      setEnabled(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(SILENT_PRINT_STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // Printing can continue with the in-memory preference if storage fails.
    }
  }, [enabled, loaded]);

  return [enabled, setEnabled, loaded] as const;
}

export function useAutoPrintSetting(userId: string | null) {
  const [enabled, setEnabled] = useState(true);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const storageKey = userId ? `${AUTO_PRINT_STORAGE_PREFIX}${userId}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      // Settings hydrate from browser storage after server markup is sent.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnabled(saved === null ? true : JSON.parse(saved) === true);
    } catch {
      setEnabled(true);
    }
    setLoadedStorageKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || loadedStorageKey !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(enabled));
    } catch {
      // A browser storage limit should not block settings or invoice editing.
    }
  }, [enabled, loadedStorageKey, storageKey]);

  return [
    enabled,
    setEnabled,
    Boolean(storageKey && loadedStorageKey === storageKey),
  ] as const;
}
