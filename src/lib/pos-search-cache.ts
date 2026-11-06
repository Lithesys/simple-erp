import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceList, Product } from "./types";
import type { Customer } from "./customers";
import {
  hasSearchDiacritics,
  matchesSearchPhrase,
  matchesSearchQuery,
  matchesSearchQueryWithDiacritics,
  normalizeSearchText,
  normalizeSearchTextWithDiacritics,
} from "./search";

const DATABASE_NAME = "lan-duy-linh-pos-search-v1";
const STORE_NAME = "records";

type CacheRecord<T> = { key: string; savedAt: number; value: T };
const customerIndexes = new Map<
  string,
  {
    savedAt: number;
    rows: {
      customer: Customer;
      text: string;
      textWithDiacritics: string;
    }[];
  }
>();
const loadedCaches = new Map<string, PosSearchData | null>();
export type PosSearchData = {
  products: Product[];
  priceLists: PriceList[];
  customers: Customer[];
  savedAt: number;
  customersSavedAt?: number;
};

export function searchProductsLocally<T extends Pick<Product, "name" | "sku">>(
  products: T[],
  query: string,
  limit = 8,
) {
  if (!query.trim()) return [];
  if (hasSearchDiacritics(query)) {
    const exactMatches = products.filter((product) =>
      matchesSearchQueryWithDiacritics(
        `${product.name} ${product.sku}`,
        query,
      ),
    );
    if (exactMatches.length) {
      const normalizedQuery = normalizeSearchTextWithDiacritics(query)
        .replace(/\s+/g, " ")
        .trim();
      return exactMatches
        .sort((first, second) => {
          const isExactPhrase = (product: T) =>
            [product.name, product.sku].some((value) =>
              normalizeSearchTextWithDiacritics(value)
                .replace(/\s+/g, " ")
                .includes(normalizedQuery),
            );
          return Number(isExactPhrase(second)) - Number(isExactPhrase(first));
        })
        .slice(0, limit);
    }
  }

  const phraseMatches = products.filter(
    (product) =>
      matchesSearchPhrase(product.name, query) ||
      matchesSearchPhrase(product.sku, query),
  );
  if (phraseMatches.length) {
    const normalizedQuery = normalizeSearchText(query)
      .replace(/\s+/g, " ")
      .trim();
    return phraseMatches
      .sort((first, second) => {
        const isExactPhrase = (product: T) =>
          [product.name, product.sku].some(
            (value) =>
              normalizeSearchText(value).replace(/\s+/g, " ").trim() ===
              normalizedQuery,
          );
        return Number(isExactPhrase(second)) - Number(isExactPhrase(first));
      })
      .slice(0, limit);
  }

  return products
    .filter((product) =>
      matchesSearchQuery(`${product.name} ${product.sku}`, query),
    )
    .slice(0, limit);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read<T>(key: string): Promise<CacheRecord<T> | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .get(key);
    request.onsuccess = () =>
      resolve((request.result as CacheRecord<T> | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function write<T>(key: string, value: T) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction
      .objectStore(STORE_NAME)
      .put({ key, value, savedAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function cacheKey(userId: string) {
  return `user:${userId}:pos-search`;
}

export function matchesCachedCustomerText(text: string, query: string) {
  return matchesSearchQuery(text, query);
}

export async function readPosSearchCache(userId: string) {
  if (loadedCaches.has(userId)) return loadedCaches.get(userId) ?? null;
  const cache = (await read<PosSearchData>(cacheKey(userId)))?.value ?? null;
  loadedCaches.set(userId, cache);
  return cache;
}

export async function readPosSearchProducts(supabase: SupabaseClient) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user.id) return null;
  const cache = await readPosSearchCache(session.user.id);
  return cache?.products ?? null;
}

export async function writePosSearchCache(
  userId: string,
  data: Omit<PosSearchData, "savedAt">,
) {
  const cache = { ...data, savedAt: Date.now() };
  await write(cacheKey(userId), cache);
  loadedCaches.set(userId, cache);
  customerIndexes.delete(userId);
}

export async function upsertPosSearchCustomer(
  supabase: SupabaseClient,
  customer: Customer,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user.id) return;
  const cache = await readPosSearchCache(session.user.id);
  if (!cache) return;
  await writePosSearchCache(session.user.id, {
    products: cache.products,
    priceLists: cache.priceLists,
    customers: [
      customer,
      ...cache.customers.filter((item) => item.id !== customer.id),
    ],
    customersSavedAt: Date.now(),
  });
}

export async function clearPosSearchCache(userId: string) {
  customerIndexes.delete(userId);
  loadedCaches.delete(userId);
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(cacheKey(userId));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function clearAllPosSearchCache() {
  customerIndexes.clear();
  loadedCaches.clear();
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function searchCachedCustomers(
  supabase: SupabaseClient,
  query: string,
  limit = 8,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user.id) return null;
  const cache = await readPosSearchCache(session.user.id);
  if (!cache?.customers.length) return null;
  let index = customerIndexes.get(session.user.id);
  if (!index || index.savedAt !== cache.savedAt) {
    index = {
      savedAt: cache.savedAt,
      rows: cache.customers.map((customer) => ({
        customer,
        text: normalizeSearchText(
          `${customer.name} ${customer.phone} ${customer.address}`,
        ),
        textWithDiacritics: normalizeSearchTextWithDiacritics(
          `${customer.name} ${customer.phone} ${customer.address}`,
        ),
      })),
    };
    customerIndexes.set(session.user.id, index);
  }
  const needle = normalizeSearchText(query);
  if (!needle)
    return index.rows.slice(0, limit).map(({ customer }) => customer);
  if (hasSearchDiacritics(query)) {
    const exactMatches = index.rows.filter(({ textWithDiacritics }) =>
      matchesSearchQueryWithDiacritics(textWithDiacritics, query),
    );
    if (exactMatches.length)
      return exactMatches.slice(0, limit).map(({ customer }) => customer);
  }
  return index.rows
    .filter(({ text }) => matchesCachedCustomerText(text, needle))
    .map(({ customer }) => customer)
    .slice(0, limit);
}

export async function syncPosSearchData(
  supabase: SupabaseClient,
  userId: string,
  products: Product[],
  priceLists: PriceList[],
  refreshCustomers = true,
) {
  const previous = await readPosSearchCache(userId);
  let customers = previous?.customers ?? [];
  let customersSavedAt = previous?.customersSavedAt ?? previous?.savedAt ?? 0;
  if (refreshCustomers || !previous) {
    customers = [];
    for (let offset = 0; ; offset += 100) {
      const result = await supabase.rpc("search_customers", {
        p_query: "",
        p_offset: offset,
        p_limit: 100,
      });
      if (result.error) throw result.error;
      const page = (result.data?.rows ?? []) as Customer[];
      customers.push(...page);
      if (
        customers.length >= Number(result.data?.total ?? 0) ||
        page.length < 100
      )
        break;
    }
    customersSavedAt = Date.now();
  }
  await writePosSearchCache(userId, {
    products,
    priceLists,
    customers,
    customersSavedAt,
  });
}
