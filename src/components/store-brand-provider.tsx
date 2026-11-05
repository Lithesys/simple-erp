"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";

const LEGACY_STORE_NAME_STORAGE_KEY = "erp-preference:app:v1:storeName";
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

function readLegacyStoreName() {
  try {
    const saved = localStorage.getItem(LEGACY_STORE_NAME_STORAGE_KEY);
    return saved === null ? null : limitStoreName(saved);
  } catch {
    return null;
  }
}

export function countStoreNameCharacters(value: string) {
  return storeNameSegmenter
    ? Array.from(storeNameSegmenter.segment(value)).length
    : Array.from(value).length;
}

type StoreNameSaveState = "saved" | "saving" | "error";

type StoreBrandContextValue = {
  storeName: string;
  displayName: string;
  isLoaded: boolean;
  storeNameSaveState: StoreNameSaveState;
  setStoreName(value: string): void;
};

const StoreBrandContext = createContext<StoreBrandContextValue>({
  storeName: DEFAULT_STORE_NAME,
  displayName: DEFAULT_STORE_NAME,
  isLoaded: false,
  storeNameSaveState: "saved",
  setStoreName: () => undefined,
});

export function StoreBrandProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [storeName, setStoreNameState] = useState(DEFAULT_STORE_NAME);
  const [isLoaded, setIsLoaded] = useState(false);
  const [storeNameSaveState, setStoreNameSaveState] =
    useState<StoreNameSaveState>("saved");
  const saveSequenceRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const legacyMigrationAttemptRef = useRef(false);

  const persistStoreName = useCallback((value: string, sequence: number) => {
    const supabase = createClient();
    const operation = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (sequence !== saveSequenceRef.current) return true;

        const { data: authData, error: authError } =
          await supabase.auth.getUser();
        if (authError || !authData.user) {
          throw new Error("A signed-in user is required to save settings.");
        }

        const { error } = await supabase.from("app_settings").upsert(
          {
            setting_key: "store_name",
            value,
            is_public: true,
            is_default: false,
            updated_at: new Date().toISOString(),
            updated_by: authData.user.id,
          },
          { onConflict: "setting_key" },
        );
        if (error) throw error;

        if (sequence === saveSequenceRef.current) {
          setStoreNameSaveState("saved");
          try {
            localStorage.removeItem(LEGACY_STORE_NAME_STORAGE_KEY);
          } catch {
            // A browser storage failure does not undo the database save.
          }
        }
        return true;
      })
      .catch(() => {
        if (sequence === saveSequenceRef.current) {
          setStoreNameSaveState("error");
        }
        return false;
      });

    saveQueueRef.current = operation.then(() => undefined);
    return operation;
  }, []);

  const setStoreName = useCallback(
    (value: string) => {
      const next = limitStoreName(value);
      setStoreNameState(next);
      const sequence = ++saveSequenceRef.current;
      setStoreNameSaveState("saving");

      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void persistStoreName(next, sequence);
      }, 450);
    },
    [persistStoreName],
  );

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    const loadStoreName = async () => {
      const sequence = ++loadSequenceRef.current;

      try {
        const { data, error } = await supabase
          .from("app_settings")
          .select("value, is_default")
          .eq("setting_key", "store_name")
          .maybeSingle();

        if (!active || sequence !== loadSequenceRef.current) return;
        if (error) throw error;

        const databaseName =
          typeof data?.value === "string"
            ? limitStoreName(data.value)
            : DEFAULT_STORE_NAME;
        const legacyName = readLegacyStoreName();
        const { data: authData } = await supabase.auth.getUser();
        if (!active || sequence !== loadSequenceRef.current) return;

        let nextName = databaseName;
        let shouldMigrateLegacyName = false;
        const settingIsDefault = data === null || data?.is_default === true;

        if (
          settingIsDefault &&
          legacyName &&
          legacyName !== DEFAULT_STORE_NAME
        ) {
          if (!authData.user) {
            // Keep the old name visible on the sign-in screen until an Admin
            // can migrate it into the shared database.
            nextName = legacyName;
          } else {
            const { data: canManageSettings, error: permissionError } =
              await supabase.rpc("user_has_permission", {
                p_permission: "accounts.manage",
              });
            if (!active || sequence !== loadSequenceRef.current) return;
            if (!permissionError && canManageSettings === true) {
              nextName = legacyName;
              shouldMigrateLegacyName = true;
            }
          }
        }

        setStoreNameState(nextName);
        setIsLoaded(true);
        setStoreNameSaveState("saved");

        if (shouldMigrateLegacyName && !legacyMigrationAttemptRef.current) {
          legacyMigrationAttemptRef.current = true;
          const saveSequence = ++saveSequenceRef.current;
          setStoreNameSaveState("saving");
          const wasSaved = await persistStoreName(nextName, saveSequence);
          if (active && !wasSaved) {
            legacyMigrationAttemptRef.current = false;
          }
        }
      } catch {
        if (!active || sequence !== loadSequenceRef.current) return;
        setStoreNameState(readLegacyStoreName() ?? DEFAULT_STORE_NAME);
        setIsLoaded(true);
        setStoreNameSaveState("error");
      }
    };

    void loadStoreName();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => void loadStoreName(), 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [persistStoreName]);

  const value = useMemo(
    () => ({
      storeName,
      displayName: storeName.trim() || DEFAULT_STORE_NAME,
      isLoaded,
      storeNameSaveState,
      setStoreName,
    }),
    [isLoaded, setStoreName, storeName, storeNameSaveState],
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
