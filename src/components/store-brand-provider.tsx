"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORE_NAME_STORAGE_KEY = "erp-preference:app:v1:storeName";
const DEFAULT_STORE_NAME = "ERP";
const STORE_NAME_CHARACTER_LIMIT = 20;
const storeNameSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("vi", { granularity: "grapheme" })
    : null;

function limitStoreName(value: string) {
  if (!storeNameSegmenter) {
    return Array.from(value).slice(0, STORE_NAME_CHARACTER_LIMIT).join("");
  }
  return Array.from(storeNameSegmenter.segment(value))
    .slice(0, STORE_NAME_CHARACTER_LIMIT)
    .map(({ segment }) => segment)
    .join("");
}

export function countStoreNameCharacters(value: string) {
  return storeNameSegmenter
    ? Array.from(storeNameSegmenter.segment(value)).length
    : Array.from(value).length;
}

type StoreBrandContextValue = {
  storeName: string;
  displayName: string;
  isLoaded: boolean;
  setStoreName(value: string): void;
};

const StoreBrandContext = createContext<StoreBrandContextValue>({
  storeName: DEFAULT_STORE_NAME,
  displayName: DEFAULT_STORE_NAME,
  isLoaded: false,
  setStoreName: () => undefined,
});

export function StoreBrandProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [storeName, setStoreNameState] = useState(DEFAULT_STORE_NAME);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_NAME_STORAGE_KEY);
      // Hydrate the browser-only preference after server markup is sent.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved !== null) setStoreNameState(limitStoreName(saved));
    } catch {
      // Keep the default name if browser storage is unavailable.
    }
    setIsLoaded(true);

    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key !== STORE_NAME_STORAGE_KEY) return;
      setStoreNameState(limitStoreName(event.newValue || DEFAULT_STORE_NAME));
    };
    window.addEventListener("storage", syncAcrossTabs);
    return () => window.removeEventListener("storage", syncAcrossTabs);
  }, []);

  const setStoreName = useCallback((value: string) => {
    const next = limitStoreName(value);
    setStoreNameState(next);
    try {
      localStorage.setItem(STORE_NAME_STORAGE_KEY, next);
    } catch {
      // The current app session still reflects the new name.
    }
  }, []);

  const value = useMemo(
    () => ({
      storeName,
      displayName: storeName.trim() || DEFAULT_STORE_NAME,
      isLoaded,
      setStoreName,
    }),
    [isLoaded, setStoreName, storeName],
  );

  return (
    <StoreBrandContext.Provider value={value}>
      {children}
    </StoreBrandContext.Provider>
  );
}

export function useStoreBrand() {
  return useContext(StoreBrandContext);
}
