import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProductAnalysisCacheForOtherScopes,
  clearProductAnalysisCacheForUser,
  productAnalysisCacheKey,
  readProductAnalysisCache,
  writeProductAnalysisCache,
  PRODUCT_ANALYSIS_CACHE_MAX_BYTES,
  PRODUCT_ANALYSIS_CACHE_PREFIX,
} from "./product-analysis-cache";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  constructor(private readonly maxBytes = PRODUCT_ANALYSIS_CACHE_MAX_BYTES) {}

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    const usedBytes = [...this.values.entries()]
      .filter(([existingKey]) => existingKey !== key)
      .reduce(
        (sum, [existingKey, existingValue]) =>
          sum + (existingKey.length + existingValue.length) * 2,
        0,
      );
    if (usedBytes + (key.length + value.length) * 2 > this.maxBytes)
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    this.values.set(key, value);
  }
}

const cacheIdentity = {
  userId: "user-1",
  permissionScope: "all-cost",
  widget: "quantity",
  date: "2026-10-27",
  filters: { mode: "sales", page: 0 },
};

let storage: MemoryStorage;

describe("product analysis local cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keys entries by account, permissions, widget, date and filters", () => {
    expect(productAnalysisCacheKey(cacheIdentity)).not.toBe(
      productAnalysisCacheKey({
        ...cacheIdentity,
        permissionScope: "own-cost",
      }),
    );
    expect(productAnalysisCacheKey(cacheIdentity)).not.toBe(
      productAnalysisCacheKey({ ...cacheIdentity, widget: "revenue" }),
    );
    expect(productAnalysisCacheKey(cacheIdentity)).not.toBe(
      productAnalysisCacheKey({ ...cacheIdentity, date: "2026-10-28" }),
    );
    expect(productAnalysisCacheKey(cacheIdentity)).not.toBe(
      productAnalysisCacheKey({
        ...cacheIdentity,
        filters: { mode: "sales", page: 1 },
      }),
    );
  });

  it("reads valid aggregates and drops malformed entries", () => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    writeProductAnalysisCache(cacheIdentity, { quantity: 1.25 });
    expect(readProductAnalysisCache(cacheIdentity)).toEqual({ quantity: 1.25 });

    const key = productAnalysisCacheKey({ ...cacheIdentity, widget: "broken" });
    storage.setItem(key, "not-json");
    expect(
      readProductAnalysisCache({ ...cacheIdentity, widget: "broken" }),
    ).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it("evicts least recently used analysis data to stay inside the 3 MiB limit", () => {
    storage = new MemoryStorage(1550);
    vi.stubGlobal("window", { localStorage: storage });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T00:00:00Z"));

    const oldest = { ...cacheIdentity, widget: "oldest" };
    const recent = { ...cacheIdentity, widget: "recent" };
    writeProductAnalysisCache(oldest, { data: "old" });
    vi.advanceTimersByTime(10);
    writeProductAnalysisCache(recent, { data: "new" });
    vi.advanceTimersByTime(10);
    readProductAnalysisCache(oldest);
    writeProductAnalysisCache(
      { ...cacheIdentity, widget: "large" },
      { data: "x".repeat(350) },
    );

    expect(readProductAnalysisCache(oldest)).toEqual({ data: "old" });
    expect(readProductAnalysisCache(recent)).toBeNull();
    expect(
      [...Array(storage.length)].reduce((sum, _, index) => {
        const key = storage.key(index)!;
        return sum + (key.length + (storage.getItem(key)?.length ?? 0)) * 2;
      }, 0),
    ).toBeLessThanOrEqual(PRODUCT_ANALYSIS_CACHE_MAX_BYTES);
  });

  it("clears one user's old permission scope and all of that user's entries on logout", () => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    writeProductAnalysisCache(cacheIdentity, { quantity: 1 });
    writeProductAnalysisCache(
      { ...cacheIdentity, permissionScope: "own-cost" },
      { quantity: 2 },
    );

    clearProductAnalysisCacheForOtherScopes("user-1", "own-cost");
    expect(readProductAnalysisCache(cacheIdentity)).toBeNull();
    expect(
      readProductAnalysisCache({
        ...cacheIdentity,
        permissionScope: "own-cost",
      }),
    ).toEqual({ quantity: 2 });

    clearProductAnalysisCacheForUser("user-1");
    expect(storage.key(0)).toBeNull();
    expect(PRODUCT_ANALYSIS_CACHE_PREFIX).toContain("product-analysis-cache");
  });
});
