import type { SupabaseClient } from "@supabase/supabase-js";
import { addCalendarDays, getReportingDate } from "@/lib/dashboard-metrics";
import {
  readProductAnalysisCache,
  writeProductAnalysisCache,
  type ProductAnalysisCacheIdentity,
} from "@/lib/product-analysis-cache";
import type {
  ProductAnalysisMetricDay,
  ProductAnalysisMetricTotal,
  ProductAnalysisProduct,
  ProductComboSuggestion,
} from "@/lib/product-analysis";

export type ProductAnalysisMetric =
  | "sold_product_count"
  | "quantity"
  | "revenue_per_product"
  | "gross_profit_per_unit";

export type ProductAnalysisRankMetric = "quantity" | "revenue" | "gross_profit";

export type ProductAnalysisMetricWidget = {
  days: ProductAnalysisMetricDay[];
  total: ProductAnalysisMetricTotal | null;
  versions: Record<string, number>;
  fromCache: boolean;
};

export type ProductAnalysisProductRow = ProductAnalysisProduct & {
  missing_cost_line_count: number;
};

export type ProductAnalysisProductPage = {
  rows: ProductAnalysisProductRow[];
  totalRows: number;
  decileRows: number;
  versions: Record<string, number>;
  catalogVersion: number;
  fromCache: boolean;
};

export type ProductAnalysisComboWidget = {
  rows: ProductComboSuggestion[];
  versions: Record<string, number>;
  catalogVersion: number;
  fromCache: boolean;
};

type ApiMetricResponse = {
  versions: Record<string, number>;
  days: ProductAnalysisMetricDay[];
  total: ProductAnalysisMetricTotal;
};

type ApiProductPageResponse = {
  needs_refresh: boolean;
  versions: Record<string, number>;
  catalog_version: number;
  rows?: ProductAnalysisProductRow[];
  total_rows?: number;
  decile_rows?: number;
};

type ApiComboResponse = {
  needs_refresh: boolean;
  versions: Record<string, number>;
  catalog_version: number;
  rows?: ProductComboSuggestion[];
};

type Period = { from: string; to: string };

const EMPTY_VERSIONS: Record<string, number> = {};

function dailyIdentity(
  userId: string,
  permissionScope: string,
  metric: ProductAnalysisMetric,
  date: string,
): ProductAnalysisCacheIdentity {
  return {
    userId,
    permissionScope,
    widget: `metric-day:${metric}`,
    date,
    filters: { formula: "gross-profit-per-sold-unit-v2" },
  };
}

function metricPeriodIdentity(
  userId: string,
  permissionScope: string,
  metric: ProductAnalysisMetric,
  period: Period,
): ProductAnalysisCacheIdentity {
  return {
    userId,
    permissionScope,
    widget: `metric-total:${metric}`,
    from: period.from,
    to: period.to,
    filters: { formula: "gross-profit-per-sold-unit-v2" },
  };
}

function dateRange(from: string, to: string) {
  if (!from || !to || to < from) return [];
  const dates: string[] = [];
  let date = from;
  for (let index = 0; date <= to && index < 3661; index += 1) {
    dates.push(date);
    date = addCalendarDays(date, 1);
  }
  return dates;
}

function metricRangeCacheIsPersistent(period: Period) {
  return period.to < getReportingDate();
}

function productRangeIdentity(
  userId: string,
  permissionScope: string,
  period: Period,
  filters: Record<string, string | number | boolean>,
): ProductAnalysisCacheIdentity {
  return {
    userId,
    permissionScope,
    widget: "product-ranking",
    from: period.from,
    to: period.to,
    filters: { ...filters, formula: "gross-profit-per-sold-unit-v2" },
  };
}

function comboRangeIdentity(
  userId: string,
  permissionScope: string,
  period: Period,
): ProductAnalysisCacheIdentity {
  return {
    userId,
    permissionScope,
    widget: "bought-together",
    from: period.from,
    to: period.to,
    filters: { formula: "gross-profit-per-sold-unit-v2" },
  };
}

function cachedMetricWidget(
  userId: string,
  permissionScope: string,
  metric: ProductAnalysisMetric,
  period: Period,
): ProductAnalysisMetricWidget | undefined {
  if (!userId) return undefined;
  const dates = dateRange(period.from, period.to);
  if (dates.length === 0) return undefined;
  const cachedDays: ProductAnalysisMetricDay[] = [];
  const versions: Record<string, number> = {};
  for (const date of dates) {
    if (date >= getReportingDate()) continue;
    const value = readProductAnalysisCache<ProductAnalysisMetricDay>(
      dailyIdentity(userId, permissionScope, metric, date),
    );
    if (!value) continue;
    cachedDays.push(value);
    versions[date] = value.version;
  }
  const cachedTotal = metricRangeCacheIsPersistent(period)
    ? readProductAnalysisCache<{
        total: ProductAnalysisMetricTotal;
        versions: Record<string, number>;
      }>(metricPeriodIdentity(userId, permissionScope, metric, period))
    : null;
  if (!cachedTotal && cachedDays.length === 0) return undefined;
  return {
    days: cachedDays.sort((left, right) => left.date.localeCompare(right.date)),
    total: cachedTotal?.total ?? null,
    versions,
    fromCache: true,
  };
}

export function readProductAnalysisMetricCache(
  userId: string,
  permissionScope: string,
  metric: ProductAnalysisMetric,
  period: Period,
) {
  return cachedMetricWidget(userId, permissionScope, metric, period);
}

export async function fetchProductAnalysisMetric(
  supabase: SupabaseClient,
  userId: string,
  permissionScope: string,
  metric: ProductAnalysisMetric,
  period: Period,
): Promise<ProductAnalysisMetricWidget> {
  const cached = cachedMetricWidget(userId, permissionScope, metric, period);
  const { data, error } = await supabase.rpc(
    "get_product_analysis_metric_days",
    {
      p_metric: metric,
      p_from: period.from,
      p_to: period.to,
      p_cached_versions: cached?.versions ?? EMPTY_VERSIONS,
    },
  );
  if (error) throw error;
  const response = data as unknown as ApiMetricResponse;
  const merged = new Map((cached?.days ?? []).map((day) => [day.date, day]));
  for (const day of response.days ?? []) {
    merged.set(day.date, day);
    if (day.date < getReportingDate()) {
      writeProductAnalysisCache(
        dailyIdentity(userId, permissionScope, metric, day.date),
        day,
      );
    }
  }
  if (metricRangeCacheIsPersistent(period)) {
    writeProductAnalysisCache(
      metricPeriodIdentity(userId, permissionScope, metric, period),
      { total: response.total, versions: response.versions },
    );
  }
  return {
    days: [...merged.values()].sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
    total: response.total,
    versions: response.versions,
    fromCache: false,
  };
}

export function readProductAnalysisProductPageCache(
  userId: string,
  permissionScope: string,
  period: Period,
  filters: Record<string, string | number | boolean>,
) {
  if (!userId || !metricRangeCacheIsPersistent(period)) return undefined;
  return readProductAnalysisCache<ProductAnalysisProductPage>(
    productRangeIdentity(userId, permissionScope, period, filters),
  );
}

export async function fetchProductAnalysisProductPage(
  supabase: SupabaseClient,
  userId: string,
  permissionScope: string,
  period: Period,
  input: {
    query: string;
    metric: ProductAnalysisRankMetric;
    direction: "asc" | "desc";
    page: number;
    pageSize: number;
    showAll: boolean;
  },
): Promise<ProductAnalysisProductPage> {
  const identity = productRangeIdentity(userId, permissionScope, period, input);
  const cached = metricRangeCacheIsPersistent(period)
    ? readProductAnalysisCache<ProductAnalysisProductPage>(identity)
    : undefined;
  const { data, error } = await supabase.rpc("get_product_analysis_products", {
    p_from: period.from,
    p_to: period.to,
    p_query: input.query,
    p_metric: input.metric,
    p_direction: input.direction,
    p_page: input.page,
    p_page_size: input.pageSize,
    p_show_all: input.showAll,
    p_cached_versions: cached?.versions ?? EMPTY_VERSIONS,
    p_cached_catalog_version: cached?.catalogVersion ?? null,
  });
  if (error) throw error;
  const response = data as unknown as ApiProductPageResponse;
  if (!response.needs_refresh) {
    if (cached) return { ...cached, fromCache: true };
    throw new Error("Không có dữ liệu cache để tiếp tục làm mới bảng.");
  }
  const result: ProductAnalysisProductPage = {
    rows: response.rows ?? [],
    totalRows: response.total_rows ?? 0,
    decileRows: response.decile_rows ?? 0,
    versions: response.versions ?? EMPTY_VERSIONS,
    catalogVersion: response.catalog_version ?? 0,
    fromCache: false,
  };
  if (metricRangeCacheIsPersistent(period))
    writeProductAnalysisCache(identity, result);
  return result;
}

export function readProductAnalysisComboCache(
  userId: string,
  permissionScope: string,
  period: Period,
) {
  if (!userId || !metricRangeCacheIsPersistent(period)) return undefined;
  return readProductAnalysisCache<ProductAnalysisComboWidget>(
    comboRangeIdentity(userId, permissionScope, period),
  );
}

export async function fetchProductAnalysisCombos(
  supabase: SupabaseClient,
  userId: string,
  permissionScope: string,
  period: Period,
): Promise<ProductAnalysisComboWidget> {
  const identity = comboRangeIdentity(userId, permissionScope, period);
  const cached = metricRangeCacheIsPersistent(period)
    ? readProductAnalysisCache<ProductAnalysisComboWidget>(identity)
    : undefined;
  const { data, error } = await supabase.rpc("get_product_analysis_combos", {
    p_from: period.from,
    p_to: period.to,
    p_cached_versions: cached?.versions ?? EMPTY_VERSIONS,
    p_cached_catalog_version: cached?.catalogVersion ?? null,
  });
  if (error) throw error;
  const response = data as unknown as ApiComboResponse;
  if (!response.needs_refresh) {
    if (cached) return { ...cached, fromCache: true };
    throw new Error(
      "Không có dữ liệu cache để tiếp tục làm mới bảng mua cùng.",
    );
  }
  const result: ProductAnalysisComboWidget = {
    rows: response.rows ?? [],
    versions: response.versions ?? EMPTY_VERSIONS,
    catalogVersion: response.catalog_version ?? 0,
    fromCache: false,
  };
  if (metricRangeCacheIsPersistent(period))
    writeProductAnalysisCache(identity, result);
  return result;
}
