export const PRODUCT_ANALYSIS_CACHE_SCHEMA = "analysis-v2";
export const PRODUCT_ANALYSIS_CACHE_PREFIX = "product-analysis-cache:v2:";
export const PRODUCT_ANALYSIS_CACHE_MAX_BYTES = 3 * 1024 * 1024;

export type ProductAnalysisCacheIdentity = {
  userId: string;
  permissionScope: string;
  widget: string;
  date?: string;
  from?: string;
  to?: string;
  filters?: Record<string, string | number | boolean | null>;
};

type CacheEnvelope<T> = {
  schema: typeof PRODUCT_ANALYSIS_CACHE_SCHEMA;
  accessedAt: number;
  value: T;
};

function stableFilters(filters: ProductAnalysisCacheIdentity["filters"]) {
  if (!filters) return "";
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(filters).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

export function productAnalysisCacheKey(
  identity: ProductAnalysisCacheIdentity,
) {
  const user = encodeURIComponent(identity.userId);
  const scope = encodeURIComponent(identity.permissionScope);
  const widget = encodeURIComponent(identity.widget);
  const period = identity.date
    ? `day:${identity.date}`
    : `range:${identity.from ?? ""}:${identity.to ?? ""}`;
  const filters = encodeURIComponent(stableFilters(identity.filters));
  return `${PRODUCT_ANALYSIS_CACHE_PREFIX}${user}:${scope}:${widget}:${period}:${filters}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseEnvelope<T>(raw: string | null): CacheEnvelope<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope<T>>;
    if (
      parsed.schema !== PRODUCT_ANALYSIS_CACHE_SCHEMA ||
      typeof parsed.accessedAt !== "number" ||
      !("value" in parsed)
    )
      return null;
    return parsed as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

export function readProductAnalysisCache<T>(
  identity: ProductAnalysisCacheIdentity,
): T | null {
  const storage = getStorage();
  if (!storage) return null;
  const key = productAnalysisCacheKey(identity);
  try {
    const raw = storage.getItem(key);
    const envelope = parseEnvelope<T>(raw);
    if (!envelope) {
      if (raw !== null) storage.removeItem(key);
      return null;
    }
    const touched: CacheEnvelope<T> = { ...envelope, accessedAt: Date.now() };
    try {
      storage.setItem(key, JSON.stringify(touched));
    } catch {
      // Reading remains useful even when touching the LRU entry cannot be saved.
    }
    return envelope.value;
  } catch {
    return null;
  }
}

function analysisEntries(storage: Storage) {
  const entries: { key: string; accessedAt: number; size: number }[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(PRODUCT_ANALYSIS_CACHE_PREFIX)) continue;
    const raw = storage.getItem(key);
    const envelope = parseEnvelope(raw);
    if (!envelope || raw === null) {
      storage.removeItem(key);
      index -= 1;
      continue;
    }
    entries.push({
      key,
      accessedAt: envelope.accessedAt,
      size: (key.length + raw.length) * 2,
    });
  }
  return entries;
}

export function writeProductAnalysisCache<T>(
  identity: ProductAnalysisCacheIdentity,
  value: T,
) {
  const storage = getStorage();
  if (!storage) return false;
  const key = productAnalysisCacheKey(identity);
  const envelope: CacheEnvelope<T> = {
    schema: PRODUCT_ANALYSIS_CACHE_SCHEMA,
    accessedAt: Date.now(),
    value,
  };
  let raw: string;
  try {
    raw = JSON.stringify(envelope);
  } catch {
    return false;
  }
  const size = (key.length + raw.length) * 2;
  if (size > PRODUCT_ANALYSIS_CACHE_MAX_BYTES) return false;

  try {
    const entries = analysisEntries(storage).filter(
      (entry) => entry.key !== key,
    );
    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    entries.sort((left, right) => left.accessedAt - right.accessedAt);
    while (
      totalBytes + size > PRODUCT_ANALYSIS_CACHE_MAX_BYTES &&
      entries.length > 0
    ) {
      const evicted = entries.shift()!;
      storage.removeItem(evicted.key);
      totalBytes -= evicted.size;
    }
    storage.setItem(key, raw);
    return true;
  } catch {
    const entries = analysisEntries(storage)
      .filter((entry) => entry.key !== key)
      .sort((left, right) => left.accessedAt - right.accessedAt);
    while (entries.length > 0) {
      try {
        storage.removeItem(entries.shift()!.key);
        storage.setItem(key, raw);
        return true;
      } catch {
        // Keep evicting least-recently-used analysis entries until it fits.
      }
    }
    return false;
  }
}

function clearUserEntries(userId: string, keepPermissionScope?: string) {
  const storage = getStorage();
  if (!storage) return;
  const userPrefix = `${PRODUCT_ANALYSIS_CACHE_PREFIX}${encodeURIComponent(userId)}:`;
  const allowedPrefix = keepPermissionScope
    ? `${userPrefix}${encodeURIComponent(keepPermissionScope)}:`
    : null;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (
        key?.startsWith(userPrefix) &&
        (!allowedPrefix || !key.startsWith(allowedPrefix))
      )
        storage.removeItem(key);
    }
  } catch {
    // Storage can be disabled or quota-limited; analysis reads still remain safe.
  }
}

export function clearProductAnalysisCacheForUser(userId: string) {
  clearUserEntries(userId);
}

export function clearProductAnalysisCacheForOtherScopes(
  userId: string,
  currentPermissionScope: string,
) {
  clearUserEntries(userId, currentPermissionScope);
}
