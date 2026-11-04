"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
} from "recharts";
import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { AppPagination } from "@/components/app-pagination";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DataTable,
  type DataColumn,
  type DataTableSort,
} from "@/components/data-table";
import { DateRangeInput } from "@/components/date-range-input";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { MobileTableToolbarMetrics } from "@/components/mobile-table-toolbar-metrics";
import { canAccessPage } from "@/lib/access-control";
import { getUserPermissions } from "@/lib/auth";
import { addCalendarDays, getReportingDate } from "@/lib/dashboard-metrics";
import { formatDate } from "@/lib/date";
import { formatQuantity, formatVnd } from "@/lib/format";
import { productOrdersHref } from "@/lib/management-navigation";
import { announceAppNavigationStart } from "@/lib/navigation-progress";
import {
  clearProductAnalysisCacheForOtherScopes,
  clearProductAnalysisCacheForUser,
} from "@/lib/product-analysis-cache";
import {
  fetchProductAnalysisCombos,
  fetchProductAnalysisMetric,
  fetchProductAnalysisProductPage,
  readProductAnalysisComboCache,
  readProductAnalysisMetricCache,
  readProductAnalysisProductPageCache,
  type ProductAnalysisComboWidget,
  type ProductAnalysisMetric,
  type ProductAnalysisMetricWidget,
  type ProductAnalysisProductPage,
  type ProductAnalysisRankMetric,
} from "@/lib/product-analysis-api";
import {
  type ProductAnalysisMetricDay,
  type ProductAnalysisMetricTotal,
  type ProductAnalysisProduct,
  type ProductComboSuggestion,
  grossProfitPerUnitChartValue,
  productIdFromAnalysisKey,
} from "@/lib/product-analysis";
import { createClient } from "@/lib/data/client";
import type { Permission } from "@/lib/types";

type AnalysisRange = { from: string; to: string };
type AnalysisMetric = "quantity" | "revenue" | "gross_profit";
type AnalysisMode = "fast" | "slow";
type UserAccess = NonNullable<Awaited<ReturnType<typeof getUserPermissions>>>;
type PendingProductOrdersNavigation = {
  productId: string;
  productName: string;
  from: string;
  to: string;
};
type MetricSparkPoint = {
  label: string;
  date: string;
  value: number | null;
  quantity: number | null;
  revenue: number | null;
  grossProfit: number | null;
  missingCostLineCount: number;
  productCount: number | null;
  hasData: boolean;
};

const PAGE_SIZE = 10;
const PRODUCT_ANALYSIS_QUERY_STALE_TIME = 60_000;
const PRODUCT_ANALYSIS_QUERY_GC_TIME = 5 * 60_000;

function permissionScope(permissions: Permission[]) {
  const orderScope = permissions.includes("orders.read_all") ? "all" : "own";
  const costScope = permissions.includes("products.cost.read")
    ? "cost"
    : "sales";
  return `${orderScope}-${costScope}`;
}

function useProductAnalysisMetric(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  scope: string,
  metric: ProductAnalysisMetric,
  range: AnalysisRange,
  enabled: boolean,
) {
  const initialData = useMemo(
    () =>
      readProductAnalysisMetricCache(userId, scope, metric, range) ?? undefined,
    [metric, range, scope, userId],
  );
  return useQuery<ProductAnalysisMetricWidget>({
    queryKey: [
      "product-analysis",
      "metric",
      userId,
      scope,
      metric,
      range.from,
      range.to,
    ],
    enabled: Boolean(userId) && enabled,
    queryFn: () =>
      fetchProductAnalysisMetric(supabase, userId, scope, metric, range),
    initialData,
    initialDataUpdatedAt: 0,
    staleTime: PRODUCT_ANALYSIS_QUERY_STALE_TIME,
    gcTime: PRODUCT_ANALYSIS_QUERY_GC_TIME,
    refetchOnWindowFocus: false,
  });
}

function useProductAnalysisProductPage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  scope: string,
  range: AnalysisRange,
  input: {
    query: string;
    metric: ProductAnalysisRankMetric;
    direction: "asc" | "desc";
    page: number;
    pageSize: number;
    showAll: boolean;
  },
  enabled: boolean,
) {
  const initialData = useMemo(
    () =>
      readProductAnalysisProductPageCache(userId, scope, range, input) ??
      undefined,
    [input, range, scope, userId],
  );
  return useQuery<ProductAnalysisProductPage>({
    queryKey: [
      "product-analysis",
      "ranking",
      userId,
      scope,
      range.from,
      range.to,
      input.query,
      input.metric,
      input.direction,
      input.page,
      input.pageSize,
      input.showAll,
    ],
    enabled: Boolean(userId) && enabled,
    queryFn: () =>
      fetchProductAnalysisProductPage(supabase, userId, scope, range, input),
    initialData,
    initialDataUpdatedAt: 0,
    staleTime: PRODUCT_ANALYSIS_QUERY_STALE_TIME,
    gcTime: PRODUCT_ANALYSIS_QUERY_GC_TIME,
    refetchOnWindowFocus: false,
  });
}

function useProductAnalysisCombos(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  scope: string,
  range: AnalysisRange,
  enabled: boolean,
) {
  const initialData = useMemo(
    () => readProductAnalysisComboCache(userId, scope, range) ?? undefined,
    [range, scope, userId],
  );
  return useQuery<ProductAnalysisComboWidget>({
    queryKey: [
      "product-analysis",
      "combos",
      userId,
      scope,
      range.from,
      range.to,
    ],
    enabled: Boolean(userId) && enabled,
    queryFn: () => fetchProductAnalysisCombos(supabase, userId, scope, range),
    initialData,
    initialDataUpdatedAt: 0,
    staleTime: PRODUCT_ANALYSIS_QUERY_STALE_TIME,
    gcTime: PRODUCT_ANALYSIS_QUERY_GC_TIME,
    refetchOnWindowFocus: false,
  });
}

function buildMetricTrend(
  days: ProductAnalysisMetricDay[],
  range: AnalysisRange,
  metric: ProductAnalysisMetric,
): MetricSparkPoint[] {
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const points: MetricSparkPoint[] = [];
  let date = range.from;
  for (let index = 0; date <= range.to && index < 366; index += 1) {
    const day = dayByDate.get(date);
    points.push({
      label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
      date,
      value:
        metric === "gross_profit_per_unit"
          ? grossProfitPerUnitChartValue(day)
          : (day?.value ?? null),
      quantity: day?.quantity ?? null,
      revenue: day?.revenue ?? null,
      grossProfit: day?.gross_profit ?? null,
      missingCostLineCount: day?.missing_cost_line_count ?? 0,
      productCount: day?.product_count ?? null,
      hasData: Boolean(day),
    });
    date = addCalendarDays(date, 1);
  }
  return points;
}

function metricLabel(metric: ProductAnalysisMetric) {
  switch (metric) {
    case "sold_product_count":
      return "Hàng hóa có bán";
    case "quantity":
      return "Số lượng bán";
    case "revenue_per_product":
      return "Doanh thu thuần / hàng hóa";
    case "gross_profit_per_unit":
      return "Lợi nhuận gộp / đơn vị bán";
  }
}

function formatMetricValue(metric: ProductAnalysisMetric, value: number | null) {
  if (value === null)
    return metric === "gross_profit_per_unit"
      ? "Chưa đủ dữ liệu giá vốn"
      : "—";
  return metric === "sold_product_count" || metric === "quantity"
    ? formatQuantity(value)
    : formatVnd(value);
}

function metricSparklineDetails(
  metric: ProductAnalysisMetric,
  point: MetricSparkPoint,
) {
  switch (metric) {
    case "sold_product_count":
      return [
        {
          label: "Số lượng bán",
          value:
            point.quantity === null ? "—" : formatQuantity(point.quantity),
        },
      ];
    case "quantity":
      return [
        {
          label: "Hàng hóa có bán",
          value:
            point.productCount === null
              ? "—"
              : formatQuantity(point.productCount),
        },
      ];
    case "revenue_per_product":
      return [
        {
          label: "Doanh thu thuần",
          value: point.revenue === null ? "—" : formatVnd(point.revenue),
        },
        {
          label: "Hàng hóa có bán",
          value:
            point.productCount === null
              ? "—"
              : formatQuantity(point.productCount),
        },
      ];
    case "gross_profit_per_unit":
      return [
        {
          label: "Tổng lợi nhuận gộp",
          value:
            point.grossProfit === null
              ? point.missingCostLineCount > 0
                ? "Chưa đủ dữ liệu giá vốn"
                : "—"
              : formatVnd(point.grossProfit),
        },
        {
          label: "Số lượng bán",
          value:
            point.quantity === null ? "—" : formatQuantity(point.quantity),
        },
      ];
  }
}

function SparklineTooltip({
  active,
  payload,
  metric,
}: TooltipContentProps & {
  metric: ProductAnalysisMetric;
}) {
  const point = payload?.[0]?.payload as MetricSparkPoint | undefined;
  if (!active || !point?.hasData) return null;

  const dateLabel = `${point.date.slice(8, 10)}/${point.date.slice(5, 7)}/${point.date.slice(0, 4)}`;
  const details = metricSparklineDetails(metric, point);

  return (
    <div className="product-analysis-chart-tooltip" role="tooltip">
      <strong>{dateLabel}</strong>
      <span className="product-analysis-chart-tooltip-primary">
        {metricLabel(metric)}: {formatMetricValue(metric, point.value)}
      </span>
      {details.map((detail) => (
        <span key={detail.label}>
          {detail.label}: {detail.value}
        </span>
      ))}
    </div>
  );
}

function Sparkline({
  data,
  color,
  metric,
}: {
  data: MetricSparkPoint[];
  color: string;
  metric: ProductAnalysisMetric;
}) {
  return (
    <div className="product-analysis-sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.13}
            isAnimationActive={false}
            connectNulls={false}
            activeDot={{ r: 4, fill: color, stroke: "var(--surface)", strokeWidth: 2 }}
          />
          <Tooltip
            content={(props) => <SparklineTooltip {...props} metric={metric} />}
            cursor={false}
            filterNull={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function kpiValue(
  metric: ProductAnalysisMetric,
  total: ProductAnalysisMetricTotal | null | undefined,
  isPending: boolean,
) {
  if (!total) return isPending ? "Đang tải…" : "—";
  switch (metric) {
    case "sold_product_count":
      return formatQuantity(total.value ?? 0);
    case "quantity":
      return formatQuantity(total.value ?? 0);
    case "revenue_per_product":
      return formatVnd(total.value ?? 0);
    case "gross_profit_per_unit":
      if (total.missing_cost_line_count > 0) return "Chưa đủ dữ liệu giá vốn";
      if (total.denominator === 0) return "—";
      return formatVnd(total.value ?? 0);
  }
}

function MetricKpi({
  label,
  metric,
  color,
  query,
  range,
}: {
  label: string;
  metric: ProductAnalysisMetric;
  color: string;
  query: UseQueryResult<ProductAnalysisMetricWidget>;
  range: AnalysisRange;
}) {
  const total = query.data?.total;
  const value = kpiValue(metric, total, query.isPending);
  const cachedDays = query.data?.days ?? [];
  const refreshingCachedData = query.isFetching && cachedDays.length > 0;
  return (
    <article className="card product-analysis-kpi">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Sparkline
        data={buildMetricTrend(cachedDays, range, metric)}
        color={color}
        metric={metric}
      />
      {query.isError && (
        <div className="product-analysis-widget-message" role="alert">
          <span>Chưa làm mới được; số liệu cache vẫn được giữ.</span>
          <AppButton
            type="button"
            variant="ghost"
            onClick={() => void query.refetch()}
          >
            Thử lại
          </AppButton>
        </div>
      )}
      {!query.isError && refreshingCachedData && (
        <span className="product-analysis-widget-status" role="status">
          Đang kiểm tra phiên bản ngày…
        </span>
      )}
      {!total && query.data && !query.isError && (
        <span className="product-analysis-widget-status" role="status">
          Đang lấy số tổng hợp của khoảng ngày.
        </span>
      )}
    </article>
  );
}

function formatProductMetric(product: ProductAnalysisProduct, metric: string) {
  if (metric === "quantity") return formatQuantity(product.quantity);
  if (metric === "revenue") return formatVnd(product.revenue);
  return product.gross_profit === null ? "—" : formatVnd(product.gross_profit);
}

function metricValue(product: ProductAnalysisProduct, key: string) {
  if (key === "product_name") return product.product_name;
  if (key === "quantity") return product.quantity;
  if (key === "revenue") return product.revenue;
  if (key === "stock") return product.stock;
  return product.gross_profit;
}

function widgetError(
  query: UseQueryResult<unknown>,
  message: string,
  retry: () => void,
) {
  if (!query.isError) return null;
  return (
    <div className="product-analysis-widget-error" role="alert">
      <span>{message}; dữ liệu đang có vẫn được giữ.</span>
      <AppButton type="button" variant="ghost" onClick={retry}>
        Thử lại
      </AppButton>
    </div>
  );
}

export default function ProductAnalysisPage() {
  const today = getReportingDate();
  const pathname = usePathname();
  const router = useRouter();
  const isMobileRoute = pathname.startsWith("/mobile/");
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const [authUserId, setAuthUserId] = useState<string | null | undefined>(
    undefined,
  );
  const accessQuery = useQuery<UserAccess | null>({
    queryKey: ["product-analysis-access", authUserId ?? "signed-out"],
    queryFn: () => getUserPermissions({ throwOnError: true }),
    enabled: authUserId !== undefined,
    staleTime: PRODUCT_ANALYSIS_QUERY_STALE_TIME,
    refetchOnWindowFocus: false,
  });
  const access =
    authUserId && accessQuery.data?.user.id === authUserId
      ? accessQuery.data
      : null;
  const accessResolved =
    authUserId !== undefined &&
    (accessQuery.data === null || access?.user.id === authUserId);
  const [range, setRange] = useState<AnalysisRange>({
    from: `${today.slice(0, 7)}-01`,
    to: today,
  });
  const [mode, setMode] = useState<AnalysisMode>("fast");
  const [metric, setMetric] = useState<AnalysisMetric>("quantity");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(0);
  const [tableSort, setTableSort] = useState<DataTableSort>({
    key: "quantity",
    direction: "desc",
  });
  const [pendingProductOrdersNavigation, setPendingProductOrdersNavigation] =
    useState<PendingProductOrdersNavigation | null>(null);

  useEffect(() => {
    let currentUserId: string | null = null;
    const { data } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        const nextUserId = session?.user.id ?? null;
        setAuthUserId(nextUserId);

        if (event === "SIGNED_OUT" || !session) {
          if (currentUserId) clearProductAnalysisCacheForUser(currentUserId);
          if (currentUserId) {
            queryClient.removeQueries({
              predicate: (cachedQuery) =>
                cachedQuery.queryKey[0] === "product-analysis" &&
                cachedQuery.queryKey[2] === currentUserId,
            });
          }
          queryClient.removeQueries({
            predicate: (cachedQuery) =>
              cachedQuery.queryKey[0] === "product-analysis-access",
          });
        } else if (
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "USER_UPDATED"
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["product-analysis-access", nextUserId],
            exact: true,
          });
        }

        currentUserId = nextUserId;
      },
    );
    return () => {
      data.subscription.unsubscribe();
    };
  }, [queryClient, supabase]);

  const userId = access?.user.id ?? "";
  const scope = access ? permissionScope(access.permissions) : "";
  useEffect(() => {
    if (!userId || !scope) return;
    clearProductAnalysisCacheForOtherScopes(userId, scope);
    queryClient.removeQueries({
      predicate: (cachedQuery) =>
        cachedQuery.queryKey[0] === "product-analysis" &&
        cachedQuery.queryKey[2] === userId &&
        cachedQuery.queryKey[3] !== scope,
    });
  }, [queryClient, scope, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const hasPageAccess = Boolean(
    access && canAccessPage("productAnalysis", access.permissions),
  );
  const canViewOrders = Boolean(
    access && canAccessPage("orders", access.permissions),
  );
  const canViewProfit = Boolean(
    access?.permissions.includes("products.cost.read"),
  );
  const quantityKpi = useProductAnalysisMetric(
    supabase,
    userId,
    scope,
    "quantity",
    range,
    hasPageAccess,
  );
  const productCountKpi = useProductAnalysisMetric(
    supabase,
    userId,
    scope,
    "sold_product_count",
    range,
    hasPageAccess,
  );
  const revenuePerProductKpi = useProductAnalysisMetric(
    supabase,
    userId,
    scope,
    "revenue_per_product",
    range,
    hasPageAccess,
  );
  const grossProfitPerUnitKpi = useProductAnalysisMetric(
    supabase,
    userId,
    scope,
    "gross_profit_per_unit",
    range,
    hasPageAccess && canViewProfit,
  );

  const profitAvailable = Boolean(
    canViewProfit &&
    grossProfitPerUnitKpi.data?.total &&
    grossProfitPerUnitKpi.data.total.missing_cost_line_count === 0,
  );
  const displayedMetric: AnalysisMetric =
    metric === "gross_profit" && !profitAvailable ? "quantity" : metric;
  const selectedRankMetric: ProductAnalysisRankMetric = displayedMetric;
  const tableInput = useMemo(
    () => ({
      query: debouncedQuery,
      metric: selectedRankMetric,
      direction: tableSort.direction,
      page,
      pageSize: PAGE_SIZE,
      showAll,
    }),
    [debouncedQuery, page, selectedRankMetric, showAll, tableSort.direction],
  );
  const tableQuery = useProductAnalysisProductPage(
    supabase,
    userId,
    scope,
    range,
    tableInput,
    hasPageAccess,
  );
  const comboQuery = useProductAnalysisCombos(
    supabase,
    userId,
    scope,
    range,
    hasPageAccess,
  );

  const totals = {
    quantity: quantityKpi.data?.total?.quantity ?? null,
    revenue: revenuePerProductKpi.data?.total?.revenue ?? null,
  };

  const productColumns = useMemo<DataColumn<ProductAnalysisProduct>[]>(() => {
    const metricLabel =
      displayedMetric === "quantity"
        ? "Số lượng bán"
        : displayedMetric === "revenue"
          ? "Doanh thu thuần"
          : "Lợi nhuận gộp";
    return [
      {
        key: "product_name",
        label: "Hàng hóa",
        title: "Hàng hóa",
        sortable: false,
        value: (product) => product.product_name,
        render: (product) => (
          <div className="product-analysis-name-cell">
            <strong>{product.product_name}</strong>
            <span>
              Tồn hiện tại:{" "}
              {product.stock === null ? "—" : formatQuantity(product.stock)}
            </span>
          </div>
        ),
      },
      {
        key: displayedMetric,
        label: metricLabel,
        title: metricLabel,
        sortable: true,
        align: "right",
        value: (product) =>
          metricValue(product, displayedMetric) as number | null,
        render: (product) => formatProductMetric(product, displayedMetric),
      },
      {
        key: "stock",
        label: "Tồn hiện tại",
        title: "Tồn hiện tại",
        sortable: false,
        align: "right",
        value: (product) => product.stock,
        render: (product) =>
          product.stock === null ? "—" : formatQuantity(product.stock),
      },
    ];
  }, [displayedMetric]);

  const comboColumns = useMemo<DataColumn<ProductComboSuggestion>[]>(
    () => [
      {
        key: "pair",
        label: "Sản phẩm thường mua cùng",
        title: "Sản phẩm thường mua cùng",
        sortable: false,
        render: (combo) => (
          <div className="product-analysis-combo-pair">
            <span>{combo.first_product}</span>
            <span aria-hidden="true">+</span>
            <span>{combo.second_product}</span>
          </div>
        ),
      },
      {
        key: "co_order_count",
        label: "Đơn có cả hai",
        title: "Đơn có cả hai",
        sortable: false,
        align: "right",
        value: (combo) => combo.co_order_count,
        render: (combo) => formatQuantity(combo.co_order_count),
      },
    ],
    [],
  );

  function selectMetric(nextMetric: AnalysisMetric) {
    setMetric(nextMetric);
    setTableSort({
      key: nextMetric,
      direction: mode === "fast" ? "desc" : "asc",
    });
    setPage(0);
  }

  function confirmProductOrders(product: ProductAnalysisProduct) {
    const productId = productIdFromAnalysisKey(product.key);
    if (!canViewOrders || !productId) return;
    setPendingProductOrdersNavigation({
      productId,
      productName: product.product_name,
      from: range.from,
      to: range.to,
    });
  }

  function openProductOrders() {
    const pending = pendingProductOrdersNavigation;
    setPendingProductOrdersNavigation(null);
    if (!pending) return;
    announceAppNavigationStart();
    router.push(
      productOrdersHref(
        pending.productId,
        pending.productName,
        pending.from,
        pending.to,
        isMobileRoute,
      ),
    );
  }

  if (accessQuery.isError)
    return (
      <div className="alert" role="alert">
        Không kiểm tra được quyền truy cập. Tải lại trang để thử lại.
      </div>
    );
  if (
    !accessResolved ||
    accessQuery.isPending ||
    (!hasPageAccess && accessQuery.isFetching)
  )
    return <LoadingSkeleton rows={6} />;
  if (!hasPageAccess)
    return (
      <div className="alert">
        Tài khoản không có quyền xem phân tích hàng hóa.
      </div>
    );

  const productRows = tableQuery.data?.rows ?? [];
  const comboRows = comboQuery.data?.rows ?? [];
  const selectedProductCount = tableQuery.data?.totalRows ?? 0;
  const decileCount = tableQuery.data?.decileRows ?? 0;

  return (
    <div className="product-analysis-page">
      <div className="page-heading product-analysis-heading">
        <div>
          <h1>Phân tích hàng hóa</h1>
          <p>Hiệu quả bán hàng và sản phẩm thường được mua cùng nhau.</p>
        </div>
        <DateRangeInput
          start={range.from}
          end={range.to}
          className="field date-range-field product-analysis-date-range"
          ariaLabel="Khoảng thời gian phân tích hàng hóa"
          onChange={(from, to) => {
            setRange({ from, to });
            setPage(0);
          }}
        />
      </div>

      <div className="product-analysis-data-note" role="note">
        Số lượng bán và doanh thu thuần chưa trừ hàng trả vì hệ thống hiện chưa
        lưu dữ liệu trả hàng. Số lượng dùng theo dòng hóa đơn, giữ nguyên phần
        lẻ và số lượng Combo đã bán.
      </div>

      <section className="product-analysis-kpis" aria-label="Chỉ số hàng hóa">
        <MetricKpi
          label="Hàng hóa có bán"
          metric="sold_product_count"
          color="var(--primary)"
          query={productCountKpi}
          range={range}
        />
        <MetricKpi
          label="Số lượng bán"
          metric="quantity"
          color="var(--chart-blue, var(--primary))"
          query={quantityKpi}
          range={range}
        />
        <MetricKpi
          label="Doanh thu thuần / hàng hóa"
          metric="revenue_per_product"
          color="var(--success, #2f9e67)"
          query={revenuePerProductKpi}
          range={range}
        />
        {canViewProfit && (
          <MetricKpi
            label="Lợi nhuận gộp / đơn vị bán"
            metric="gross_profit_per_unit"
            color="var(--warning, #d59c27)"
            query={grossProfitPerUnitKpi}
            range={range}
          />
        )}
      </section>

      <div className="product-analysis-section-grid">
        <section className="card product-analysis-placeholder">
          <div className="product-analysis-section-heading">
            <div>
              <h2>Nhóm hàng bán chạy</h2>
              <p>Top 10% theo doanh thu thuần</p>
            </div>
            <span className="product-analysis-status">
              Chưa có dữ liệu nhóm
            </span>
          </div>
          <div className="product-analysis-empty-state">
            <strong>Chưa thể phân tích theo nhóm hàng</strong>
            <span>
              Danh mục sản phẩm hiện chưa có trường nhóm hàng để tổng hợp.
            </span>
          </div>
        </section>
        <section className="card product-analysis-placeholder">
          <div className="product-analysis-section-heading">
            <div>
              <h2>Gợi ý theo khu vực</h2>
              <p>Sản phẩm phù hợp với thị trường địa phương</p>
            </div>
            <span className="product-analysis-status">Chưa kết nối</span>
          </div>
          <div className="product-analysis-empty-state">
            <strong>Nguồn dữ liệu thị trường chưa được kết nối</strong>
            <span>
              Trang không hiển thị gợi ý khu vực khi chưa có nguồn dữ liệu đối
              chiếu.
            </span>
          </div>
        </section>
      </div>

      <section className="card product-analysis-card product-analysis-products">
        <div className="product-analysis-section-heading product-analysis-table-heading">
          <div>
            <h2>Hiệu quả theo hàng hóa</h2>
            <p>Top 10% sản phẩm theo chỉ số đang chọn</p>
          </div>
          <div
            className="product-analysis-controls"
            role="group"
            aria-label="Kiểu xếp hạng"
          >
            <AppButton
              type="button"
              variant={mode === "fast" ? "primary" : "secondary"}
              aria-pressed={mode === "fast"}
              onClick={() => {
                setMode("fast");
                setTableSort({ key: displayedMetric, direction: "desc" });
                setPage(0);
              }}
            >
              Bán chạy
            </AppButton>
            <AppButton
              type="button"
              variant={mode === "slow" ? "primary" : "secondary"}
              aria-pressed={mode === "slow"}
              onClick={() => {
                setMode("slow");
                setTableSort({ key: displayedMetric, direction: "asc" });
                setPage(0);
              }}
            >
              Bán chậm
            </AppButton>
          </div>
        </div>
        <div className="product-analysis-toolbar">
          <div
            className="product-analysis-metric-tabs"
            role="group"
            aria-label="Xếp hạng theo chỉ số"
          >
            <AppButton
              type="button"
              variant={metric === "quantity" ? "primary" : "secondary"}
              aria-pressed={metric === "quantity"}
              onClick={() => selectMetric("quantity")}
            >
              Số lượng bán
            </AppButton>
            <AppButton
              type="button"
              variant={metric === "revenue" ? "primary" : "secondary"}
              aria-pressed={metric === "revenue"}
              onClick={() => selectMetric("revenue")}
            >
              Doanh thu thuần
            </AppButton>
            {canViewProfit && (
              <AppButton
                type="button"
                variant={metric === "gross_profit" ? "primary" : "secondary"}
                aria-pressed={metric === "gross_profit"}
                disabled={!profitAvailable}
                onClick={() => selectMetric("gross_profit")}
              >
                Lợi nhuận gộp
              </AppButton>
            )}
          </div>
          <label className="product-analysis-search">
            <span className="sr-only">Tìm hàng hóa</span>
            <AppInput
              className="field"
              type="search"
              value={query}
              placeholder="Tìm hàng hóa"
              aria-label="Tìm hàng hóa"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        {canViewProfit &&
          grossProfitPerUnitKpi.data?.total &&
          grossProfitPerUnitKpi.data.total.missing_cost_line_count > 0 && (
            <p className="product-analysis-inline-note">
              Một số dòng bán chưa có snapshot giá vốn; lợi nhuận gộp đang tạm
              ẩn để tránh hiển thị số thiếu.
            </p>
          )}
        {widgetError(
          tableQuery,
          "Không làm mới được bảng hàng hóa",
          () => void tableQuery.refetch(),
        )}
        <MobileTableToolbarMetrics
          className="product-analysis-mobile-metrics"
          metrics={[
            {
              label: "Số lượng bán",
              value:
                totals.quantity === null
                  ? "—"
                  : formatQuantity(totals.quantity),
            },
            {
              label: "Doanh thu thuần",
              value: totals.revenue === null ? "—" : formatVnd(totals.revenue),
            },
          ]}
        />
        <div className="product-analysis-data-table">
          {tableQuery.isPending && !tableQuery.data ? (
            <LoadingSkeleton rows={5} />
          ) : (
            <DataTable
              rows={productRows}
              columns={productColumns}
              rowKey={(product) => product.key}
              onRowClick={confirmProductOrders}
              isRowClickable={(product) =>
                canViewOrders && Boolean(productIdFromAnalysisKey(product.key))
              }
              empty={
                <span>
                  Không có hàng hóa phù hợp với khoảng thời gian và bộ lọc.
                </span>
              }
              storageKey="analysis-products-sales"
              title={`Hàng hóa ${mode === "fast" ? "bán chạy" : "bán chậm"}`}
              toolbarSummary={`${formatQuantity(selectedProductCount)} hàng hóa`}
              showSummaryRow={false}
              serverSort={{
                value: tableSort,
                onChange: (nextSort) => {
                  setTableSort(nextSort);
                  if (
                    nextSort.key === "quantity" ||
                    nextSort.key === "revenue" ||
                    nextSort.key === "gross_profit"
                  ) {
                    if (nextSort.key === "gross_profit" && !profitAvailable)
                      return;
                    setMetric(nextSort.key);
                  }
                  setPage(0);
                },
              }}
              totalRows={selectedProductCount}
            />
          )}
        </div>
        <div className="product-analysis-table-footer">
          <span>
            {debouncedQuery
              ? "Kết quả tìm kiếm"
              : showAll
                ? "Toàn bộ hàng hóa"
                : `Top ${formatQuantity(decileCount)} hàng hóa`}
            {tableQuery.isFetching && tableQuery.data ? " · Đang cập nhật" : ""}
          </span>
          <div className="product-analysis-footer-actions">
            {!debouncedQuery && (
              <AppButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowAll((current) => !current);
                  setPage(0);
                }}
              >
                {showAll ? "Thu gọn top 10%" : "Xem chi tiết"}
              </AppButton>
            )}
            <AppPagination
              page={page}
              pageSize={PAGE_SIZE}
              totalRows={selectedProductCount}
              onPageChange={setPage}
              disabled={tableQuery.isFetching}
            />
          </div>
        </div>
      </section>

      <section className="card product-analysis-card product-analysis-combos">
        <div className="product-analysis-section-heading">
          <div>
            <h2>Hàng thường được mua cùng</h2>
            <p>Cặp sản phẩm cùng xuất hiện trong đơn hoàn tất</p>
          </div>
        </div>
        {widgetError(
          comboQuery,
          "Không làm mới được bảng mua cùng",
          () => void comboQuery.refetch(),
        )}
        <div className="product-analysis-data-table">
          {comboQuery.isPending && !comboQuery.data ? (
            <LoadingSkeleton rows={3} />
          ) : (
            <DataTable
              rows={comboRows}
              columns={comboColumns}
              rowKey={(combo) => combo.key}
              empty={
                <span>Chưa có đủ dữ liệu đơn hàng để tìm cặp sản phẩm.</span>
              }
              storageKey="analysis-products-combos"
              title="Sản phẩm mua cùng"
              toolbarSummary={`${formatQuantity(comboRows.length)} cặp sản phẩm`}
              showSummaryRow={false}
              serverSort={{ value: null, onChange: () => undefined }}
              totalRows={comboRows.length}
            />
          )}
        </div>
        <div className="product-analysis-table-footer">
          <span>
            Tối đa 10 cặp có tần suất cao nhất
            {comboQuery.isFetching && comboQuery.data ? " · Đang cập nhật" : ""}
          </span>
        </div>
      </section>
      <ConfirmDialog
        request={
          pendingProductOrdersNavigation
            ? {
                title: `Xem những hóa đơn có ${pendingProductOrdersNavigation.productName}?`,
                message: `Danh sách sẽ được lọc từ ${formatDate(
                  pendingProductOrdersNavigation.from,
                )} tới ${formatDate(pendingProductOrdersNavigation.to)}`,
                confirmLabel: "Xem hóa đơn",
                confirmVariant: "primary",
                showCloseButton: true,
              }
            : null
        }
        onCancel={() => setPendingProductOrdersNavigation(null)}
        onConfirm={openProductOrders}
      />
    </div>
  );
}
