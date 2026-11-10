"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { AppTable } from "@/components/app-table";
import { FilterPanel } from "@/components/filter-panel";
import { mergeClassNames } from "@/lib/class-names";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Pencil,
  Plus,
  X,
  Boxes,
  Download,
  RotateCcw,
} from "lucide-react";
import { toast } from "react-toastify";
import { createClient } from "@/lib/data/client";
import { formatQuantity, formatVnd, todayLocal } from "@/lib/format";
import { DECIMAL_INPUT_STEP } from "@/lib/constants";
import { productCost } from "@/lib/products";
import type { PriceList, Product } from "@/lib/types";
import { AppSelect } from "@/components/app-select";
import { DateRangeInput } from "@/components/date-range-input";
import { NumberInputField } from "@/components/number-input-field";
import { SearchInputField } from "@/components/search-input-field";
import { FaTable } from "react-icons/fa6";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  type TooltipContentProps,
} from "recharts";
import { formatDateTime } from "@/lib/date";
import { usePreference } from "@/lib/preferences";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { useDebounce } from "@/lib/debounce";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCachedQuery } from "@/lib/query-cache";
import { useInitialTableLoading } from "@/lib/use-initial-table-loading";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import type { DataColumn } from "@/components/data-table";
import { MobileSortControl } from "@/components/mobile-sort-control";
import { MobileTableToolbarMetrics } from "@/components/mobile-table-toolbar-metrics";
import { attachProductBundleItems } from "@/lib/product-bundles";
import { createCsv, downloadCsvFile } from "@/lib/csv-export";
import { useStableCallback } from "@/lib/use-stable-callback";
import {
  DataExportFieldModal,
  DataExportMenu,
  type DataExportFieldGroup,
} from "@/components/data-export-controls";
import { usePathname, useRouter } from "next/navigation";
import { EntityDetailModal } from "@/components/entity-detail-modal";
import { ModalLayer } from "@/components/modal-layer";
import { useEntityDetailId } from "@/lib/use-entity-detail-id";
import {
  orderDetailsHref,
  mobileOrderDetailsHref,
  productManagementListHref,
  purchaseOrderDetailsHref,
} from "@/lib/management-navigation";
import { announceAppNavigationStart } from "@/lib/navigation-progress";
import {
  buildProductSalesTrend,
  formatProductSalesDate,
  type ProductSalesSummary,
  type ProductSalesTrendPoint,
} from "@/lib/product-sales-stats";

type Draft = {
  id?: string;
  kind: "product" | "combo";
  name: string;
  unit: string;
  stock: string;
  originalStock?: string;
  cost: string;
  prices: Record<string, string>;
  bundleItems: { product_id: string; quantity: string }[];
};
type Movement = {
  id: string;
  created_at: string;
  reason: string;
  quantity_change: number;
  stock_after: number | null;
  counterparty: string;
  actor_name: string;
  order_id: string | null;
  purchase_order_id: string | null;
  order_no: string | null;
  purchase_no: string | null;
  source_date: string | null;
  is_cancelled: boolean;
  stock_check_id: string | null;
};
type InventoryHistoryPage = {
  rows: Movement[];
  total: number;
  quantity_change_total: number;
};
const inventoryHistoryPageSize = 20;
const inventoryHistoryExportPageSize = 100;
type ExportProduct = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  is_active: boolean;
  cost: number | null;
  prices: Record<string, number>;
  quantity_sold: number;
};
type ExportField = {
  value: string;
  label: string;
  read: (product: ExportProduct) => string | number | null | undefined;
};
type ExportFormValues = {
  kind: "inventory" | "sales";
  from: string;
  to: string;
  fields: string[];
};
type ProductStatusFilter = "active" | "inactive" | "all";
const emptyDraft = (
  lists: PriceList[],
  kind: Draft["kind"] = "product",
): Draft => ({
  kind,
  name: "",
  unit: "cái",
  stock: "0",
  cost: "0",
  prices: Object.fromEntries(lists.map((item) => [item.id, "0"])),
  bundleItems: [],
});

function inventoryCapital(product: Product): number {
  return Number(product.stock || 0) * productCost(product);
}

type ProductSalesChartMetric = "quantity" | "revenue" | "gross_profit";

function ProductSalesChartTooltip({
  active,
  payload,
  metric,
  unit,
}: TooltipContentProps & {
  metric: ProductSalesChartMetric;
  unit: string;
}) {
  const point = payload?.[0]?.payload as ProductSalesTrendPoint | undefined;
  if (!active || !point) return null;

  const value =
    metric === "quantity"
      ? `${formatQuantity(point.quantity)} ${unit}`
      : metric === "revenue"
        ? formatVnd(point.revenue)
        : point.gross_profit === null
          ? "Chưa đủ dữ liệu giá vốn"
          : formatVnd(point.gross_profit);
  const label =
    metric === "quantity"
      ? "Số lượng bán"
      : metric === "revenue"
        ? "Doanh thu"
        : "Lợi nhuận gộp";

  return (
    <div
      role="tooltip"
      style={{
        display: "grid",
        gap: 4,
        padding: "8px 10px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface)",
        boxShadow: "0 4px 14px rgba(15, 23, 42, 0.14)",
        fontSize: 12,
      }}
    >
      <span className="muted">Ngày: {formatProductSalesDate(point.date)}</span>
      <b>
        {label}: {value}
      </b>
    </div>
  );
}

function ProductSalesChart({
  title,
  metric,
  color,
  unit,
  data,
  loading,
}: {
  title: string;
  metric: ProductSalesChartMetric;
  color: string;
  unit: string;
  data: ProductSalesTrendPoint[] | null;
  loading: boolean;
}) {
  return (
    <article className="card" style={{ padding: 12, minWidth: 0 }}>
      <b style={{ fontSize: 13 }}>{title}</b>
      {loading || !data ? (
        <div
          className="muted"
          style={{ height: 150, display: "grid", placeItems: "center" }}
        >
          {loading ? "Đang tải…" : "Chưa có dữ liệu"}
        </div>
      ) : (
        <div style={{ width: "100%", height: 150, marginTop: 8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
            >
              <XAxis
                dataKey="date"
                tickFormatter={(date: string) =>
                  `${date.slice(8, 10)}/${date.slice(5, 7)}`
                }
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                height={22}
              />
              <Tooltip
                content={(props) => (
                  <ProductSalesChartTooltip
                    {...props}
                    metric={metric}
                    unit={unit}
                  />
                )}
                cursor={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey={metric}
                stroke={color}
                strokeWidth={2}
                fill={color}
                fillOpacity={0.13}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={{
                  r: 4,
                  fill: color,
                  stroke: "var(--surface)",
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}

export function ProductManagement({
  canCreate,
  canUpdate,
  canAdjustStock,
  canViewStockChecks,
  canUpdateCost,
  canViewCost,
  canArchive,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canAdjustStock: boolean;
  canViewStockChecks: boolean;
  canUpdateCost: boolean;
  canViewCost: boolean;
  canArchive: boolean;
}) {
  const pathname = usePathname();
  const isMobileRoute = pathname.startsWith("/mobile/");
  const detailModal = useEntityDetailId();
  const detailProductId = detailModal.id;
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Product[]>([]);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [componentOptions, setComponentOptions] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [apiTotals, setApiTotals] = useState({
    stockTotal: 0,
    inventoryCapital: 0,
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [stockFilter, setStockFilter] = useState<
    "all" | "in-stock" | "out-of-stock"
  >("all");
  const [businessStatusFilter, setBusinessStatusFilter] =
    useState<ProductStatusFilter>("active");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const productForm = useForm<Draft>({ defaultValues: emptyDraft([]) });
  const bundleItemFields = useFieldArray({
    control: productForm.control,
    name: "bundleItems",
  });
  const bundleItemsValue = useWatch({
    control: productForm.control,
    name: "bundleItems",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [detailProductLoading, setDetailProductLoading] = useState(false);
  const [detailProductError, setDetailProductError] = useState("");
  const [activeTab, setActiveTab] = useState<"history" | "stats">("history");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movementSummary, setMovementSummary] = useState({
    count: 0,
    quantityChange: 0,
  });
  const [movementDateRange, setMovementDateRange] = useState({
    from: "",
    to: "",
  });
  const [movementPage, setMovementPage] = useState(1);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyExportBusy, setHistoryExportBusy] = useState(false);
  const [statsBusy, setStatsBusy] = useState(false);
  const [salesStats, setSalesStats] = useState<{
    quantity: number;
    revenue: number;
    gross_profit: number | null;
    missing_cost_line_count: number;
    days: ProductSalesSummary["days"];
  } | null>(null);
  const expandedProductRef = useRef<string | null>(null);
  const historyRequestRef = useRef(0);
  const salesRequestRef = useRef(0);
  const [statsFrom, setStatsFrom] = useState(todayLocal());
  const [statsTo, setStatsTo] = useState(todayLocal());
  const [exportOpen, setExportOpen] = useState(false);
  const exportForm = useForm<ExportFormValues>({
    defaultValues: {
      kind: "inventory",
      from: todayLocal(),
      to: todayLocal(),
      fields: ["sku", "name", "unit", "stock"],
    },
  });
  const exportValues = exportForm.watch();
  const { kind: exportKind, from: exportFrom, to: exportTo } = exportValues;
  const [exportBusy, setExportBusy] = useState(false);
  const { loading, finishInitialLoad } = useInitialTableLoading();
  const [hiddenColumns, setHiddenColumns] = usePreference<string[]>(
    "products.hiddenColumns",
    [],
  );
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnOrderLoaded, setColumnOrderLoaded] = useState(false);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [sort, setSort] = usePreference<{
    key: string;
    direction: "asc" | "desc";
  } | null>("products.sort", null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const confirmAction = useRef<(() => Promise<void>) | null>(null);
  const priceWriteQueues = useRef(new Map<string, Promise<unknown>>());
  const enterBlurGuards = useRef(new Set<string>());
  const [savingCells, setSavingCells] = useState<string[]>([]);
  const filteredMovements = movements;
  const displayedMovementSummary = movementSummary;
  const salesTrend = buildProductSalesTrend(
    salesStats?.days ?? [],
    statsFrom,
    statsTo,
  );
  const movementPageCount = Math.max(
    1,
    Math.ceil(displayedMovementSummary.count / inventoryHistoryPageSize),
  );
  const invalidateProductCaches = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["products-summary"] }),
      queryClient.invalidateQueries({
        queryKey: ["product-inventory-history"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["product-inventory-history-summary"],
      }),
      queryClient.invalidateQueries({ queryKey: ["pos-products"] }),
      queryClient.invalidateQueries({ queryKey: ["purchase-products"] }),
      queryClient.invalidateQueries({ queryKey: ["product-prices"] }),
      queryClient.invalidateQueries({ queryKey: ["combo-component-options"] }),
      queryClient.invalidateQueries({ queryKey: ["product-bundle-items"] }),
      queryClient.invalidateQueries({
        queryKey: ["product-inventory-history"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["product-sales-summary-v2"],
      }),
    ]);

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const initialPage = Math.max(1, Number(params.get("page")) || 1);
    const initialSize = [20, 50, 100].includes(Number(params.get("size")))
      ? Number(params.get("size"))
      : 20;
    const initialSearch = params.get("q") || "";
    const initialStockFilter = (
      ["all", "in-stock", "out-of-stock"].includes(params.get("stock") || "")
        ? params.get("stock")
        : "all"
    ) as "all" | "in-stock" | "out-of-stock";
    const initialBusinessStatusFilter = (
      ["active", "inactive", "all"].includes(params.get("status") || "")
        ? params.get("status")
        : "active"
    ) as ProductStatusFilter;
    const sortableFields = ["sku", "name", "unit", "stock"] as const;
    const requestedSort = params.get("sort");
    const initialSort =
      requestedSort &&
      sortableFields.includes(requestedSort as (typeof sortableFields)[number])
        ? {
            key: requestedSort,
            direction:
              params.get("dir") === "desc"
                ? ("desc" as const)
                : ("asc" as const),
          }
        : { key: "name", direction: "asc" as const };
    setPage(initialPage);
    setSize(initialSize);
    setSearch(initialSearch);
    setStockFilter(initialStockFilter);
    setBusinessStatusFilter(initialBusinessStatusFilter);
    setSort(initialSort);
    try {
      const [productsResult, listsResult, summaryResult, componentsResult] =
        await Promise.all([
          fetchCachedQuery(
            queryClient,
            supabase,
            [
              "products",
              initialPage,
              initialSize,
              initialSearch,
              initialStockFilter,
              initialBusinessStatusFilter,
              initialSort?.key,
              initialSort?.direction,
              canViewCost,
            ],
            async () => {
              const pageResult = await supabase.rpc("get_products_page", {
                p_query: initialSearch,
                p_stock_filter: initialStockFilter,
                p_page: initialPage,
                p_page_size: initialSize,
                p_sort: initialSort?.key || "name",
                p_direction: initialSort?.direction || "asc",
                p_status_filter: initialBusinessStatusFilter,
              });
              if (pageResult.error) throw pageResult.error;
              const ids = (pageResult.data?.ids || []) as string[];
              const total = Number(pageResult.data?.total || 0);
              if (!ids.length) return { data: [], count: total };

              const productResult = await supabase
                .from("products")
                .select(
                  "id,sku,name,unit,stock,kind,is_active,product_prices(price,price_list_id)" +
                    (canViewCost ? ",product_costs(cost)" : ""),
                )
                .in("id", ids);
              if (productResult.error) throw productResult.error;
              const byId = new Map<string, { id: string }>(
                ((productResult.data || []) as { id: string }[]).map(
                  (product) => [product.id, product],
                ),
              );
              const pageProducts = ids
                .map((id) => byId.get(id))
                .filter(
                  (product): product is { id: string } => product !== undefined,
                );
              return {
                data: await attachProductBundleItems(
                  supabase,
                  pageProducts as unknown as Product[],
                ),
                count: total,
              };
            },
          ),
          fetchCachedQuery(
            queryClient,
            supabase,
            ["active-price-lists"],
            async () => {
              const result = await supabase
                .from("price_lists")
                .select("id,name,is_default,is_active")
                .eq("is_active", true)
                .order("name");
              if (result.error) throw result.error;
              return result.data;
            },
          ),
          fetchCachedQuery(
            queryClient,
            supabase,
            [
              "products-summary",
              initialSearch,
              initialStockFilter,
              initialBusinessStatusFilter,
              canViewCost,
            ],
            async () => {
              const result = await supabase.rpc("get_products_page_summary", {
                p_query: initialSearch,
                p_stock_filter: initialStockFilter,
                p_status_filter: initialBusinessStatusFilter,
              });
              if (result.error) throw result.error;
              return result.data as {
                count: number;
                stock_total: number;
                inventory_capital: number | null;
              };
            },
          ),
          fetchCachedQuery(
            queryClient,
            supabase,
            ["combo-component-options"],
            async () => {
              const all: Product[] = [];
              for (let offset = 0; ; offset += 500) {
                const result = await supabase
                  .from("products")
                  .select("id,sku,name,unit,stock,kind,is_active")
                  .eq("is_active", true)
                  .eq("kind", "product")
                  .order("name")
                  .range(offset, offset + 499);
                if (result.error) throw result.error;
                const batch = (result.data ?? []) as unknown as Product[];
                all.push(...batch);
                if (batch.length < 500) return all;
              }
            },
          ),
        ]);
      setRows((productsResult.data ?? []) as unknown as Product[]);
      setTotal(Number(summaryResult.count ?? productsResult.count ?? 0));
      setApiTotals({
        stockTotal: Number(summaryResult.stock_total || 0),
        inventoryCapital: Number(summaryResult.inventory_capital || 0),
      });
      setLists((listsResult ?? []) as PriceList[]);
      setComponentOptions((componentsResult ?? []) as Product[]);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : caught &&
              typeof caught === "object" &&
              "message" in caught &&
              typeof caught.message === "string"
            ? caught.message
            : "Không tải được hàng hóa.";
      setError(message);
    }
    finishInitialLoad();
  }, [canViewCost, finishInitialLoad, queryClient, setSort, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const syncFromUrl = () => {
      void load();
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, [load]);
  useEffect(() => {
    if (!detailProductId) {
      setDetailProduct(null);
      setDetailProductError("");
      setDetailProductLoading(false);
      return;
    }

    const listedProduct = rows.find(
      (product) => product.id === detailProductId,
    );
    if (listedProduct) {
      setDetailProduct(listedProduct);
      setDetailProductError("");
      setDetailProductLoading(false);
      return;
    }
    if (loading) return;

    let active = true;
    setDetailProduct(null);
    setDetailProductError("");
    setDetailProductLoading(true);
    void queryClient
      .fetchQuery({
        queryKey: ["product-detail-modal", detailProductId, canViewCost],
        staleTime: 30_000,
        queryFn: async () => {
          const result = await supabase
            .from("products")
            .select(
              "id,sku,name,unit,stock,kind,is_active,product_prices(price,price_list_id)" +
                (canViewCost ? ",product_costs(cost)" : ""),
            )
            .eq("id", detailProductId)
            .maybeSingle();
          if (result.error) throw result.error;
          if (!result.data) return null;
          const [product] = await attachProductBundleItems(supabase, [
            result.data as unknown as Product,
          ]);
          return product ?? null;
        },
      })
      .then((product) => {
        if (!active) return;
        if (product) setDetailProduct(product);
        else
          setDetailProductError(
            "Không tìm thấy hàng hóa hoặc bạn không có quyền xem.",
          );
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setDetailProductError(
          caught instanceof Error
            ? caught.message
            : "Không tải được chi tiết hàng hóa.",
        );
      })
      .finally(() => {
        if (active) setDetailProductLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canViewCost, detailProductId, loading, queryClient, rows, supabase]);
  useEffect(() => {
    if (!addMenuOpen) return;
    function closeAddMenu(event: PointerEvent) {
      if (!addMenuRef.current?.contains(event.target as Node))
        setAddMenuOpen(false);
    }
    window.addEventListener("pointerdown", closeAddMenu);
    return () => window.removeEventListener("pointerdown", closeAddMenu);
  }, [addMenuOpen]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get("q") || "";
    if (!loading && debouncedSearch !== current)
      updateUrl(1, size, debouncedSearch, stockFilter);
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps
  function updateUrl(
    nextPage: number,
    nextSize = size,
    nextSearch = search,
    nextStockFilter = stockFilter,
    nextSort = sort,
    nextBusinessStatusFilter = businessStatusFilter,
  ) {
    setPage(nextPage);
    setSize(nextSize);
    setSearch(nextSearch);
    setStockFilter(nextStockFilter);
    setBusinessStatusFilter(nextBusinessStatusFilter);
    const params = new URLSearchParams(window.location.search);
    if (nextPage > 1) params.set("page", String(nextPage));
    else params.delete("page");
    if (nextSize !== 20) params.set("size", String(nextSize));
    else params.delete("size");
    if (nextSearch) params.set("q", nextSearch);
    else params.delete("q");
    if (nextStockFilter !== "all") params.set("stock", nextStockFilter);
    else params.delete("stock");
    if (nextBusinessStatusFilter !== "active")
      params.set("status", nextBusinessStatusFilter);
    else params.delete("status");
    if (nextSort) {
      params.set("sort", nextSort.key);
      params.set("dir", nextSort.direction);
    } else {
      params.delete("sort");
      params.delete("dir");
    }
    window.history.replaceState(
      null,
      "",
      productManagementListHref(isMobileRoute, params, window.location.hash),
    );
    window.setTimeout(() => {
      void load();
    }, 0);
  }

  function startEdit(product?: Product, kind: Draft["kind"] = "product") {
    if (!product) {
      const nextDraft = emptyDraft(lists, kind);
      productForm.reset(nextDraft);
      setDraft(nextDraft);
      return;
    }
    const prices = Object.fromEntries(
      lists.map((list) => [
        list.id,
        String(
          product.product_prices?.find((item) => item.price_list_id === list.id)
            ?.price ?? 0,
        ),
      ]),
    );
    const nextDraft = {
      id: product.id,
      kind: product.kind || "product",
      name: product.name,
      unit: product.unit,
      stock: String(product.stock),
      originalStock: String(product.stock),
      cost: String(productCost(product)),
      prices,
      bundleItems: (product.bundle_items ?? []).map((item) => ({
        product_id: item.product_id,
        quantity: String(item.quantity_per_bundle),
      })),
    };
    const existingOptions = (product.bundle_items ?? []).map((item) => ({
      id: item.product_id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      stock: item.stock,
      is_active: item.is_active,
      kind: "product" as const,
      product_prices: [],
    }));
    if (existingOptions.length)
      setComponentOptions((current) => {
        const byId = new Map(current.map((option) => [option.id, option]));
        for (const option of existingOptions)
          if (!byId.has(option.id)) byId.set(option.id, option);
        return [...byId.values()];
      });
    productForm.reset(nextDraft);
    setDraft(nextDraft);
  }
  async function save(values: Draft) {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      if (!values.name.trim()) throw new Error("Vui lòng nhập tên hàng hóa.");
      const stock = Number(values.stock);
      const cost = Number(values.cost);
      const stockChangedByUser =
        Boolean(values.id) &&
        values.kind === "product" &&
        values.originalStock !== undefined &&
        stock !== Number(values.originalStock);
      if (stockChangedByUser && !canAdjustStock)
        throw new Error(
          "Cần quyền tạo và hoàn thành phiếu kiểm kho để điều chỉnh tồn.",
        );
      if (
        values.kind === "product" &&
        (!Number.isFinite(stock) || !Number.isFinite(cost) || cost < 0)
      )
        throw new Error("Số tồn hoặc giá vốn không hợp lệ.");
      const bundleItems = values.bundleItems ?? [];
      if (values.kind === "combo") {
        if (!bundleItems.length)
          throw new Error("Combo cần ít nhất một hàng hóa thành phần.");
        const selectedProducts = bundleItems.map((item) => item.product_id);
        if (
          selectedProducts.some((id) => !id) ||
          new Set(selectedProducts).size !== selectedProducts.length
        )
          throw new Error("Chọn mỗi hàng hóa thành phần một lần duy nhất.");
        if (
          bundleItems.some(
            (item) =>
              !Number.isFinite(Number(item.quantity)) ||
              Number(item.quantity) <= 0 ||
              Number(item.quantity) > 100000000,
          )
        )
          throw new Error("Số lượng hàng hóa trong combo không hợp lệ.");
      }

      let productId = values.id;
      const prices = lists.map((list) => ({
        price_list_id: list.id,
        price: Number(values.prices[list.id] || 0),
      }));
      if (prices.some((item) => !Number.isFinite(item.price) || item.price < 0))
        throw new Error("Giá combo hoặc hàng hóa không hợp lệ.");

      if (!productId && values.kind === "combo") {
        if (!canCreate) throw new Error("Tài khoản không có quyền tạo combo.");
        const result = await supabase.rpc("create_product_combo", {
          p_name: values.name.trim(),
          p_unit: values.unit.trim() || "cái",
          p_items: bundleItems.map((item) => ({
            product_id: item.product_id,
            quantity: Number(item.quantity),
          })),
          p_prices: prices,
        });
        if (result.error) throw result.error;
        productId = result.data as string;
      } else if (productId) {
        if (stockChangedByUser) {
          const { data: stockUpdate, error: stockError } = await supabase
            .from("products")
            .update({ stock })
            .eq("id", productId)
            .eq("stock", Number(values.originalStock))
            .select("id")
            .maybeSingle();
          if (stockError) throw stockError;
          if (!stockUpdate)
            throw new Error(
              "Tồn kho vừa thay đổi trong lúc bạn chỉnh sửa. Hãy tải lại hàng hóa rồi nhập số tồn thực tế lần nữa.",
            );
        }

        const productPatch: { name?: string; unit?: string } = {};
        const name = values.name.trim();
        const unit = values.unit.trim() || "cái";
        if (name !== draft.name) productPatch.name = name;
        if (unit !== draft.unit) productPatch.unit = unit;
        if (Object.keys(productPatch).length) {
          const { error: updateError } = await supabase
            .from("products")
            .update(productPatch)
            .eq("id", productId);
          if (updateError) throw updateError;
        }
      } else {
        if (!canCreate)
          throw new Error("Tài khoản không có quyền tạo hàng hóa.");
        const { data, error: insertError } = await supabase
          .from("products")
          .insert({
            name: values.name.trim(),
            unit: values.unit.trim() || "cái",
            stock,
            kind: "product",
          })
          .select("id")
          .single();
        if (insertError) throw insertError;
        productId = data.id;
        const persistedDraft = { ...values, id: productId };
        productForm.setValue("id", productId);
        setDraft(persistedDraft);
      }

      if (values.kind !== "combo" || values.id) {
        for (const list of lists) {
          const price = Number(values.prices[list.id] || 0);
          const wasCreatedWithThisSave = !values.id;
          const priceChanged =
            wasCreatedWithThisSave ||
            (Object.prototype.hasOwnProperty.call(draft.prices, list.id) &&
              price !== Number(draft.prices[list.id] || 0));
          if (!priceChanged) continue;
          const { error: priceError } = await supabase
            .from("product_prices")
            .upsert(
              { product_id: productId, price_list_id: list.id, price },
              { onConflict: "product_id,price_list_id" },
            );
          if (priceError) throw priceError;
        }
      }
      const costChanged = !values.id || cost !== Number(draft.cost || 0);
      if (canUpdateCost && values.kind === "product" && costChanged) {
        const { error: costError } = await supabase
          .from("product_costs")
          .upsert(
            { product_id: productId, cost },
            { onConflict: "product_id" },
          );
        if (costError) throw costError;
      }
      const bundleItemsChanged =
        draft.bundleItems.length !== bundleItems.length ||
        draft.bundleItems.some(
          (item, index) =>
            item.product_id !== bundleItems[index]?.product_id ||
            Number(item.quantity) !== Number(bundleItems[index]?.quantity),
        );
      if (values.kind === "combo" && values.id && bundleItemsChanged) {
        const { error: bundleError } = await supabase.rpc(
          "save_product_combo_items",
          {
            p_bundle_product_id: productId,
            p_items: bundleItems.map((item) => ({
              product_id: item.product_id,
              quantity: Number(item.quantity),
            })),
          },
        );
        if (bundleError) throw bundleError;
      }
      setRows((current) =>
        current.map((row) => {
          if (row.id !== productId) return row;
          return {
            ...row,
            name: values.name.trim(),
            unit: values.unit.trim() || "cái",
            stock: values.kind === "product" ? stock : row.stock,
            product_prices: [
              ...(row.product_prices || []).filter(
                (currentPrice) =>
                  !prices.some(
                    (price) =>
                      price.price_list_id === currentPrice.price_list_id,
                  ),
              ),
              ...prices.map((price) => ({
                price_list_id: price.price_list_id,
                price: price.price,
              })),
            ],
            ...(canUpdateCost && values.kind === "product"
              ? { product_costs: { cost } }
              : {}),
          };
        }),
      );
      setDetailProduct((current) =>
        current === null || productId === undefined || current.id !== productId
          ? current
          : {
              ...current,
              name: values.name.trim(),
              unit: values.unit.trim() || "cái",
              stock: values.kind === "product" ? stock : current.stock,
              product_prices: [
                ...(current.product_prices || []).filter(
                  (currentPrice) =>
                    !prices.some(
                      (price) =>
                        price.price_list_id === currentPrice.price_list_id,
                    ),
                ),
                ...prices.map((price) => ({
                  price_list_id: price.price_list_id,
                  price: price.price,
                })),
              ],
              ...(canUpdateCost && values.kind === "product"
                ? { product_costs: { cost } }
                : {}),
            },
      );
      setDraft(null);
      await invalidateProductCaches();
      await load();
    } catch (caught) {
      await invalidateProductCaches();
      setError(
        caught instanceof Error ? caught.message : "Không lưu được hàng hóa.",
      );
    }
    setBusy(false);
  }
  async function archive(product: Product) {
    confirmAction.current = async () => {
      const { error: updateError } = await supabase.rpc("archive_product", {
        p_product_id: product.id,
      });
      if (updateError) setError(updateError.message);
      else {
        await invalidateProductCaches();
        await load();
      }
    };
    setConfirmRequest({
      title: "Ngừng kinh doanh hàng hóa?",
      message: `Ngừng "${product.name}"? Lịch sử đơn hàng sẽ được giữ nguyên.`,
      confirmLabel: "Ngừng kinh doanh",
    });
  }

  async function reactivate(product: Product) {
    confirmAction.current = async () => {
      const { error: updateError } = await supabase.rpc("reactivate_product", {
        p_product_id: product.id,
      });
      if (updateError) setError(updateError.message);
      else {
        await invalidateProductCaches();
        await load();
      }
    };
    setConfirmRequest({
      title: "Kinh doanh lại hàng hóa?",
      message: `Mở bán lại "${product.name}"? Lịch sử hàng hóa sẽ được giữ nguyên.`,
      confirmLabel: "Kinh doanh lại",
    });
  }

  async function savePriceCell(
    product: Product,
    key: string,
    priceListId: string | null,
    oldValue: number,
    input: HTMLInputElement,
  ) {
    const next = Number(input.value.replace(/,/g, "").trim());
    if (!Number.isFinite(next) || next < 0) {
      input.value = formatVnd(oldValue).replace(/[^\d]/g, "");
      setError("Giá phải là số không âm.");
      return;
    }
    if (next === oldValue) return;
    setSavingCells((current) =>
      current.includes(key) ? current : [...current, key],
    );
    setError("");
    const queueKey = `${product.id}:${priceListId || "cost"}`;
    const previous =
      priceWriteQueues.current.get(queueKey) || Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(async () => {
        if (priceListId) {
          const { error: writeError } = await supabase
            .from("product_prices")
            .upsert(
              {
                product_id: product.id,
                price_list_id: priceListId,
                price: next,
              },
              { onConflict: "product_id,price_list_id" },
            );
          if (writeError) throw writeError;
        } else {
          const { error: writeError } = await supabase
            .from("product_costs")
            .upsert(
              { product_id: product.id, cost: next },
              { onConflict: "product_id" },
            );
          if (writeError) throw writeError;
        }
        return next;
      });
    priceWriteQueues.current.set(queueKey, write);
    try {
      await write;
      await invalidateProductCaches();
      setRows((current) =>
        current.map((row) =>
          row.id !== product.id
            ? row
            : priceListId
              ? {
                  ...row,
                  product_prices: [
                    ...(row.product_prices || []).filter(
                      (entry) => entry.price_list_id !== priceListId,
                    ),
                    { price_list_id: priceListId, price: next },
                  ],
                }
              : { ...row, product_costs: { cost: next } },
        ),
      );
      setDetailProduct((current) =>
        current?.id !== product.id
          ? current
          : priceListId
            ? {
                ...current,
                product_prices: [
                  ...(current.product_prices || []).filter(
                    (entry) => entry.price_list_id !== priceListId,
                  ),
                  { price_list_id: priceListId, price: next },
                ],
              }
            : { ...current, product_costs: { cost: next } },
      );
      toast.success("Đã cập nhật giá hàng hóa.", { autoClose: 2000 });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không lưu được giá.",
      );
    } finally {
      if (priceWriteQueues.current.get(queueKey) === write)
        priceWriteQueues.current.delete(queueKey);
      setSavingCells((current) => current.filter((value) => value !== key));
    }
  }

  function inlineMoneyCell(
    product: Product,
    listId: string | null,
    value: number,
  ) {
    const key = `${product.id}:${listId || "cost"}`;
    return (
      <AppInput
        className="field inline-money-cell"
        data-row-click-ignore
        aria-label={
          listId
            ? `Giá ${lists.find((list) => list.id === listId)?.name || ""} của ${product.name}`
            : `Giá vốn của ${product.name}`
        }
        defaultValue={new Intl.NumberFormat("en-US").format(value)}
        disabled={listId === null ? !canUpdateCost : !canUpdate}
        title={savingCells.includes(key) ? "Đang lưu…" : undefined}
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            const input = event.currentTarget;
            const inputs = [
              ...document.querySelectorAll<HTMLInputElement>(
                ".inline-money-cell:not(:disabled)",
              ),
            ];
            const index = inputs.indexOf(input);
            enterBlurGuards.current.add(key);
            void savePriceCell(product, key, listId, value, input).then(() => {
              input.value = new Intl.NumberFormat("en-US").format(
                Number(input.value.replace(/,/g, "")) || 0,
              );
              inputs[index + 1]?.focus();
            });
          }
        }}
        onBlur={(event) => {
          if (enterBlurGuards.current.delete(key)) return;
          const input = event.currentTarget;
          void savePriceCell(product, key, listId, value, input).then(() => {
            input.value = new Intl.NumberFormat("en-US").format(
              Number(input.value.replace(/,/g, "")) || value,
            );
          });
        }}
      />
    );
  }

  const toggleExpanded = useCallback(
    (product: Product) => {
      if (expandedId === product.id) {
        expandedProductRef.current = null;
        historyRequestRef.current += 1;
        salesRequestRef.current += 1;
        setExpandedId(null);
        setHistoryBusy(false);
        setStatsBusy(false);
        return;
      }
      expandedProductRef.current = product.id;
      historyRequestRef.current += 1;
      salesRequestRef.current += 1;
      setExpandedId(product.id);
      setActiveTab("history");
      setMovements([]);
      setMovementSummary({ count: 0, quantityChange: 0 });
      setMovementPage(1);
      setSalesStats(null);
      setError("");
      setStatsFrom(todayLocal());
      setStatsTo(todayLocal());
      setHistoryBusy(true);
      setStatsBusy(false);
    },
    [expandedId],
  );

  const loadInventoryHistoryPage = useCallback(async () => {
    if (!expandedId || activeTab !== "history") return;

    const productId = expandedId;
    const historyRequest = ++historyRequestRef.current;
    setHistoryBusy(true);
    try {
      const pageData = await fetchCachedQuery(
        queryClient,
        supabase,
        [
          "product-inventory-history",
          productId,
          movementPage,
          inventoryHistoryPageSize,
          movementDateRange.from,
          movementDateRange.to,
        ],
        async () => {
          const result = await supabase.rpc(
            "get_product_inventory_history_page",
            {
              p_product_id: productId,
              p_page: movementPage,
              p_page_size: inventoryHistoryPageSize,
              p_from: movementDateRange.from || null,
              p_to: movementDateRange.to || null,
            },
          );
          if (result.error) throw result.error;
          return result.data as unknown as InventoryHistoryPage;
        },
      );
      if (
        historyRequestRef.current !== historyRequest ||
        expandedProductRef.current !== productId
      )
        return;
      setMovements(pageData.rows || []);
      setMovementSummary({
        count: Number(pageData.total || 0),
        quantityChange: Number(pageData.quantity_change_total || 0),
      });
    } catch (caught) {
      if (
        historyRequestRef.current !== historyRequest ||
        expandedProductRef.current !== productId
      )
        return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Không tải được nhật ký tồn kho.",
      );
    } finally {
      if (
        historyRequestRef.current === historyRequest &&
        expandedProductRef.current === productId
      )
        setHistoryBusy(false);
    }
  }, [
    activeTab,
    expandedId,
    movementDateRange.from,
    movementDateRange.to,
    movementPage,
    queryClient,
    supabase,
  ]);

  useEffect(() => {
    void loadInventoryHistoryPage();
  }, [loadInventoryHistoryPage]);

  useEffect(() => {
    if (movementPage > movementPageCount) setMovementPage(movementPageCount);
  }, [movementPage, movementPageCount]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const legacyProductId = params.get("openProduct");
    if (!legacyProductId) return;
    detailModal.replace(detailProductId || legacyProductId, ["openProduct"]);
  }, [detailModal, detailProductId]);

  useEffect(() => {
    if (!detailProductId) {
      if (expandedId) {
        expandedProductRef.current = null;
        historyRequestRef.current += 1;
        salesRequestRef.current += 1;
        setExpandedId(null);
        setHistoryBusy(false);
        setStatsBusy(false);
      }
      return;
    }
    if (expandedId === detailProductId) return;
    const product =
      (detailProduct?.id === detailProductId ? detailProduct : null) ||
      rows.find((row) => row.id === detailProductId);
    if (product) void toggleExpanded(product);
  }, [detailProduct, detailProductId, expandedId, rows, toggleExpanded]);

  function openProduct(product: Product) {
    if (detailProductId === product.id) return;
    detailModal.open(product.id);
  }

  function closeProductDetail() {
    detailModal.close();
    expandedProductRef.current = null;
    historyRequestRef.current += 1;
    salesRequestRef.current += 1;
    setExpandedId(null);
    setHistoryBusy(false);
    setStatsBusy(false);
  }

  function openMovementSource(movement: Movement) {
    if (movement.stock_check_id && canViewStockChecks) {
      const query = new URLSearchParams({ id: movement.stock_check_id });
      announceAppNavigationStart();
      router.push(
        `${isMobileRoute ? "/mobile/stock-check" : "/stock-check"}?${query}`,
      );
      return;
    }
    if (movement.order_id) {
      announceAppNavigationStart();
      router.push(
        isMobileRoute
          ? mobileOrderDetailsHref(movement.order_id)
          : orderDetailsHref(
              movement.order_id,
              movement.order_no,
              movement.source_date,
            ),
      );
      return;
    }

    if (movement.purchase_order_id) {
      announceAppNavigationStart();
      router.push(
        purchaseOrderDetailsHref(
          movement.purchase_order_id,
          movement.purchase_no,
        ),
      );
    }
  }

  const exportInventoryHistory = useStableCallback(async (product: Product) => {
    setHistoryExportBusy(true);
    let movementsToExport: Movement[] = [];
    try {
      const firstPageResult = await supabase.rpc(
        "get_product_inventory_history_page",
        {
          p_product_id: product.id,
          p_page: 1,
          p_page_size: inventoryHistoryExportPageSize,
          p_from: movementDateRange.from || null,
          p_to: movementDateRange.to || null,
        },
      );
      if (firstPageResult.error) throw firstPageResult.error;
      const firstPage = firstPageResult.data as unknown as InventoryHistoryPage;
      movementsToExport = firstPage.rows || [];
      const totalPages = Math.ceil(
        Number(firstPage.total || 0) / inventoryHistoryExportPageSize,
      );
      for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
        const result = await supabase.rpc(
          "get_product_inventory_history_page",
          {
            p_product_id: product.id,
            p_page: pageNumber,
            p_page_size: inventoryHistoryExportPageSize,
            p_from: movementDateRange.from || null,
            p_to: movementDateRange.to || null,
          },
        );
        if (result.error) throw result.error;
        const pageData = result.data as unknown as InventoryHistoryPage;
        movementsToExport.push(...(pageData.rows || []));
      }
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Không thể tải nhật ký tồn kho để xuất.",
      );
      setHistoryExportBusy(false);
      return;
    }
    if (!movementsToExport.length) {
      toast.info("Không có giao dịch tồn kho trong khoảng ngày đã chọn.");
      setHistoryExportBusy(false);
      return;
    }
    const columns = [
      {
        key: "created_at",
        label: "Thời gian",
        read: (movement: Movement) => formatDateTime(movement.created_at),
      },
      {
        key: "counterparty",
        label: "Khách / đơn nhập",
        read: (movement: Movement) => movement.counterparty,
      },
      {
        key: "quantity_change",
        label: "Thay đổi",
        read: (movement: Movement) =>
          `${formatQuantity(Number(movement.quantity_change))} · ${movement.reason}`,
      },
      {
        key: "stock_after",
        label: "Tồn sau giao dịch",
        read: (movement: Movement) =>
          movement.stock_after == null
            ? "—"
            : formatQuantity(Number(movement.stock_after)),
      },
      {
        key: "actor_name",
        label: "Người thực hiện",
        read: (movement: Movement) => movement.actor_name,
      },
    ];
    const productCode = product.sku.replace(/[^a-zA-Z0-9_-]/g, "-");
    const from = movementDateRange.from || "tat-ca";
    const to = movementDateRange.to || "tat-ca";
    downloadCsvFile(
      `nhat-ky-ton-kho-${productCode}-${from}-${to}.csv`,
      createCsv(columns, movementsToExport),
    );
    toast.success(`Đã xuất ${movementsToExport.length} giao dịch tồn kho.`);
    setHistoryExportBusy(false);
  });
  const handleInventoryHistoryExport = useStableCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const productId = event.currentTarget.dataset.productId;
      const product = rows.find((row) => row.id === productId);
      if (product) exportInventoryHistory(product);
    },
  );

  function changeInventoryHistoryPage(nextPage: number) {
    setMovements([]);
    setHistoryBusy(true);
    setMovementPage(nextPage);
  }

  async function loadSalesStats(productId: string, from: string, to: string) {
    if (!from || !to) return;
    const request = ++salesRequestRef.current;
    setStatsBusy(true);
    let data: unknown = null;
    let statsError: Error | null = null;
    try {
      data = await fetchCachedQuery(
        queryClient,
        supabase,
        ["product-sales-summary-v2", productId, from, to],
        async () => {
          const result = await supabase.rpc("get_product_sales_summary", {
            p_product_id: productId,
            p_from: from,
            p_to: to,
          });
          if (result.error) throw result.error;
          return result.data;
        },
      );
    } catch (caught) {
      statsError =
        caught instanceof Error
          ? caught
          : new Error("Không tải được thống kê bán.");
    }
    if (
      salesRequestRef.current !== request ||
      expandedProductRef.current !== productId
    )
      return;
    setStatsBusy(false);
    if (statsError) setError(statsError.message);
    else setSalesStats(data as ProductSalesSummary);
  }

  function changeStatsRange(from: string, to: string) {
    setStatsFrom(from);
    setStatsTo(to);
    if (expandedId && from && to) void loadSalesStats(expandedId, from, to);
    else {
      salesRequestRef.current += 1;
      setStatsBusy(false);
      setSalesStats(null);
    }
  }

  const exportFields: ExportField[] = [
    { value: "sku", label: "Mã hàng hóa", read: (item) => item.sku },
    { value: "name", label: "Tên hàng hóa", read: (item) => item.name },
    { value: "unit", label: "Đơn vị tính", read: (item) => item.unit },
    { value: "stock", label: "Tồn kho", read: (item) => item.stock },
    {
      value: "status",
      label: "Trạng thái",
      read: (item) => (item.is_active ? "Đang kinh doanh" : "Ngừng kinh doanh"),
    },
    ...(canViewCost
      ? [
          {
            value: "cost",
            label: "Giá vốn",
            read: (item: ExportProduct) => item.cost,
          },
          {
            value: "inventoryCapital",
            label: "Vốn tồn kho",
            read: (item: ExportProduct) =>
              Number(item.stock || 0) * Number(item.cost || 0),
          },
        ]
      : []),
    ...lists.map((list) => ({
      value: "price:" + list.id,
      label: "Giá · " + list.name,
      read: (item: ExportProduct) => item.prices?.[list.id],
    })),
    ...(exportKind === "sales"
      ? [
          {
            value: "quantity_sold",
            label: "Số lượng đã bán trong kỳ",
            read: (item: ExportProduct) => item.quantity_sold,
          },
        ]
      : []),
  ];
  const exportFieldByKey = new Map(
    exportFields.map((field) => [field.value, field] as const),
  );
  const productDetailGroups: DataExportFieldGroup[] = [
    {
      key: "product",
      label: "Hàng hóa",
      fields: ["sku", "name", "unit", "stock", "status"].flatMap((key) => {
        const field = exportFieldByKey.get(key);
        return field ? [{ key, label: field.label }] : [];
      }),
    },
    {
      key: "cost",
      label: "Giá vốn",
      fields: ["cost", "inventoryCapital"].flatMap((key) => {
        const field = exportFieldByKey.get(key);
        return field ? [{ key, label: field.label }] : [];
      }),
    },
    {
      key: "prices",
      label: "Giá bán",
      fields: exportFields
        .filter((field) => field.value.startsWith("price:"))
        .map((field) => ({ key: field.value, label: field.label })),
    },
    {
      key: "sales",
      label: "Bán hàng",
      fields: ["quantity_sold"].flatMap((key) => {
        const field = exportFieldByKey.get(key);
        return field ? [{ key, label: field.label }] : [];
      }),
    },
  ].filter((group) => group.fields.length > 0);
  const tableColumns: DataColumn<Product>[] = [
    {
      key: "sku",
      label: "Mã hàng",
      sortable: true,
      render: () => null,
      value: (product) => product.sku,
    },
    {
      key: "name",
      label: "Tên hàng",
      sortable: true,
      render: () => null,
      value: (product) => product.name,
    },
    {
      key: "unit",
      label: "Đơn vị",
      sortable: true,
      render: () => null,
      value: (product) => product.unit,
    },
    {
      key: "stock",
      label: "Tồn kho",
      sortable: true,
      render: () => null,
      value: (product) => Number(product.stock),
    },
    ...lists.map((list) => ({
      key: "price:" + list.id,
      label: list.name,
      sortable: false,
      render: () => null,
      value: (product: Product) =>
        Number(
          product.product_prices?.find(
            (price) => price.price_list_id === list.id,
          )?.price ?? 0,
        ),
    })),
    ...(canViewCost
      ? [
          {
            key: "cost",
            label: "Giá vốn",
            sortable: false,
            render: () => null,
            value: (product: Product) => Number(productCost(product)),
          },
          {
            key: "inventoryCapital",
            label: "Vốn tồn kho",
            sortable: false,
            render: () => null,
            value: (product: Product) => inventoryCapital(product),
          },
        ]
      : []),
  ];
  useEffect(() => {
    try {
      const saved = localStorage.getItem("erp-table-order:products");
      // Restore a client-side table preference after hydration.
      setColumnOrder(
        saved
          ? (JSON.parse(saved) as string[])
          : ["sku", "name", "unit", "stock"],
      );
    } catch {
      setColumnOrder(["sku", "name", "unit", "stock"]);
    }
    setColumnOrderLoaded(true);
  }, []);
  useEffect(() => {
    if (columnOrderLoaded)
      localStorage.setItem(
        "erp-table-order:products",
        JSON.stringify(columnOrder),
      );
  }, [columnOrder, columnOrderLoaded]);
  const availableColumnKeys = tableColumns.map((column) => column.key);
  const orderedColumnKeys = [
    ...columnOrder.filter((key) => availableColumnKeys.includes(key)),
    ...availableColumnKeys.filter((key) => !columnOrder.includes(key)),
  ];
  const orderedColumns = orderedColumnKeys
    .map((key) => tableColumns.find((column) => column.key === key))
    .filter((column): column is DataColumn<Product> => Boolean(column));
  const visibleColumns = orderedColumns.filter(
    (column) => !hiddenColumns.includes(column.key),
  );
  const selectedDetailProduct =
    detailProduct?.id === detailProductId ? detailProduct : null;
  const visibleProducts =
    selectedDetailProduct &&
    !rows.some((row) => row.id === selectedDetailProduct.id)
      ? [...rows, selectedDetailProduct]
      : rows;
  const renderedProducts = visibleProducts;
  const visibleStockTotal = apiTotals.stockTotal;
  const visibleInventoryCapital = apiTotals.inventoryCapital;
  function moveProductColumn(
    source: string,
    target: string,
    edge: "before" | "after",
  ) {
    if (source === target) return;
    setColumnOrder((current) => {
      const order = [...orderedColumnKeys];
      const from = order.indexOf(source);
      if (from < 0 || !order.includes(target)) return current;
      order.splice(from, 1);
      const to = order.indexOf(target);
      order.splice(to + (edge === "after" ? 1 : 0), 0, source);
      return order;
    });
  }
  const setProductSort = (nextSort: {
    key: string;
    direction: "asc" | "desc";
  }) => {
    setSort(nextSort);
    updateUrl(page, size, search, stockFilter, nextSort);
  };

  const loadAllFilteredProducts = useStableCallback(async () => {
    const ids: string[] = [];
    let matchCount = 0;
    for (let pageNumber = 1; ; pageNumber += 1) {
      const result = await supabase.rpc("get_products_page", {
        p_query: debouncedSearch,
        p_stock_filter: stockFilter,
        p_page: pageNumber,
        p_page_size: 100,
        p_sort: sort?.key || "name",
        p_direction: sort?.direction || "asc",
        p_status_filter: businessStatusFilter,
      });
      if (result.error) throw result.error;
      const pageData = result.data as {
        ids?: string[];
        total?: number;
      } | null;
      const nextIds = pageData?.ids ?? [];
      matchCount = Number(pageData?.total ?? 0);
      if (!nextIds.length) break;
      ids.push(...nextIds);
      if (ids.length >= matchCount) break;
    }

    const allProducts: Product[] = [];
    const select =
      "id,sku,name,unit,stock,kind,is_active,product_prices(price,price_list_id)" +
      (canViewCost ? ",product_costs(cost)" : "");
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const result = await supabase
        .from("products")
        .select(select)
        .in("id", batch);
      if (result.error) throw result.error;
      const byId = new Map<string, Product>(
        ((result.data || []) as unknown as Product[]).map((product) => [
          product.id,
          product,
        ]),
      );
      allProducts.push(
        ...batch
          .map((id) => byId.get(id))
          .filter((product): product is Product => Boolean(product)),
      );
    }
    return allProducts;
  });

  const exportProductOverview = useStableCallback(async () => {
    if (exportBusy || !visibleColumns.length) return;
    setExportBusy(true);
    setError("");
    try {
      const products = await loadAllFilteredProducts();
      const csv = createCsv(
        visibleColumns.map((column) => ({
          key: column.key,
          label: column.label,
          read: (product: Product) => column.value?.(product) ?? "",
        })),
        products,
      );
      downloadCsvFile(`hang-hoa-tong-quan-${todayLocal()}.csv`, csv);
      toast.success(`Đã xuất ${products.length} hàng hóa.`);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Không xuất được hàng hóa.";
      setError(message);
      toast.error(message);
    } finally {
      setExportBusy(false);
    }
  });

  const exportProducts = useStableCallback(
    async (values: ExportFormValues, selectedFieldKeys: string[]) => {
      if (exportBusy || selectedFieldKeys.length === 0) return;
      setExportBusy(true);
      setError("");
      const from = values.kind === "sales" ? values.from : null;
      const to = values.kind === "sales" ? values.to : null;
      try {
        const [data, filteredProducts] = await Promise.all([
          fetchCachedQuery(
            queryClient,
            supabase,
            ["product-export", from, to, canViewCost],
            async () => {
              const result = await supabase.rpc("export_products", {
                p_from: from,
                p_to: to,
              });
              if (result.error) throw result.error;
              return result.data;
            },
          ),
          loadAllFilteredProducts(),
        ]);
        const byId = new Map(
          ((data || []) as ExportProduct[]).map((product) => [
            product.id,
            product,
          ]),
        );
        const exported = filteredProducts
          .map((product) => byId.get(product.id))
          .filter((product): product is ExportProduct => Boolean(product));
        const fields = exportFields.filter((field) =>
          selectedFieldKeys.includes(field.value),
        );
        const csv = createCsv(
          fields.map((field) => ({
            key: field.value,
            label: field.label,
            read: field.read,
          })),
          exported,
        );
        downloadCsvFile(
          `hang-hoa-${values.kind}-${from || "hien-tai"}${to ? `-${to}` : ""}.csv`,
          csv,
        );
        setExportOpen(false);
        toast.success(`Đã xuất ${exported.length} hàng hóa.`);
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Không xuất được hàng hóa.";
        setError(message);
        toast.error(message);
      } finally {
        setExportBusy(false);
      }
    },
  );

  const handleExportProductOverview = useStableCallback(() => {
    void exportProductOverview();
  });
  const handleOpenProductExport = useStableCallback(() => {
    setError("");
    exportForm.reset({
      kind: "inventory",
      from: todayLocal(),
      to: todayLocal(),
      fields: ["sku", "name", "unit", "stock"],
    });
    setExportOpen(true);
  });
  const handleCancelProductExport = useStableCallback(() =>
    setExportOpen(false),
  );
  const handleExportProducts = useStableCallback((selectedKeys: string[]) =>
    exportProducts(exportForm.getValues(), selectedKeys),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Hàng hóa</h1>
          <p>Quản lý sản phẩm, tồn kho và giá bán theo bảng giá.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <DataExportMenu
            disabled={loading || !columnOrderLoaded}
            busy={exportBusy}
            onOverview={handleExportProductOverview}
            onDetails={handleOpenProductExport}
          />
          {canCreate && (
            <div className="product-add-menu" ref={addMenuRef}>
              <AppButton
                variant="default"
                aria-label="Thêm hàng hóa"
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
                onClick={() => setAddMenuOpen((open) => !open)}
              >
                <Plus size={16} />
                <span className="mobile-button-label">Thêm</span>
                <ChevronDown size={14} />
              </AppButton>
              {addMenuOpen && (
                <div className="product-add-menu__items" role="menu">
                  <AppButton
                    variant="ghost"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAddMenuOpen(false);
                      startEdit(undefined, "product");
                    }}
                  >
                    Hàng hóa
                  </AppButton>
                  <AppButton
                    variant="ghost"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAddMenuOpen(false);
                      startEdit(undefined, "combo");
                    }}
                  >
                    Combo
                  </AppButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {error && !draft && (
        <div className="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div className="product-workspace">
        <FilterPanel ariaLabel="Bộ lọc hàng hóa" icon={<Boxes size={17} />}>
          <label className="filter-label" htmlFor="product-search">
            Tìm hàng hóa
          </label>
          <div className="product-search">
            <SearchInputField
              id="product-search"
              showSearchIcon={false}
              aria-label="Tìm hàng hóa"
              placeholder="Tên hàng hóa"
              value={search}
              onChange={setSearch}
              onClear={() => setSearch("")}
            />
          </div>
          <fieldset className="filter-group">
            <legend>Tình trạng tồn kho</legend>
            <label className="filter-option">
              <AppInput
                type="radio"
                name="stock-filter"
                checked={stockFilter === "all"}
                onChange={() => updateUrl(1, size, search, "all")}
              />
              Tất cả hàng hóa
            </label>
            <label className="filter-option">
              <AppInput
                type="radio"
                name="stock-filter"
                checked={stockFilter === "in-stock"}
                onChange={() => updateUrl(1, size, search, "in-stock")}
              />
              Còn hàng
            </label>
            <label className="filter-option">
              <AppInput
                type="radio"
                name="stock-filter"
                checked={stockFilter === "out-of-stock"}
                onChange={() => updateUrl(1, size, search, "out-of-stock")}
              />
              Hết hàng
            </label>
          </fieldset>
          <fieldset className="filter-group">
            <legend>Tình trạng kinh doanh</legend>
            <label className="filter-option">
              <AppInput
                type="radio"
                name="product-status-filter"
                checked={businessStatusFilter === "active"}
                onChange={() =>
                  updateUrl(1, size, search, stockFilter, sort, "active")
                }
              />
              Đang kinh doanh
            </label>
            <label className="filter-option">
              <AppInput
                type="radio"
                name="product-status-filter"
                checked={businessStatusFilter === "inactive"}
                onChange={() =>
                  updateUrl(1, size, search, stockFilter, sort, "inactive")
                }
              />
              Ngừng kinh doanh
            </label>
            <label className="filter-option">
              <AppInput
                type="radio"
                name="product-status-filter"
                checked={businessStatusFilter === "all"}
                onChange={() =>
                  updateUrl(1, size, search, stockFilter, sort, "all")
                }
              />
              Tất cả trạng thái
            </label>
          </fieldset>
          <AppButton
            variant="ghost"
            className="filter-reset filter-clear-button"
            onClick={() => updateUrl(1, size, "", "all", sort, "active")}
          >
            Xóa bộ lọc
          </AppButton>
        </FilterPanel>
        <div
          className={mergeClassNames(
            "product-results",
            isMobileRoute && "mobile-product-list",
          )}
        >
          {loading ? (
            <LoadingSkeleton rows={8} />
          ) : (
            <section className="card table-wrap">
              <MobileTableToolbarMetrics
                metrics={[
                  { label: "Mặt hàng", value: total },
                  {
                    label: "Tổng tồn kho",
                    value: formatQuantity(visibleStockTotal),
                  },
                  ...(canViewCost
                    ? [
                        {
                          label: "Tổng vốn tồn kho",
                          value: formatVnd(visibleInventoryCapital),
                        },
                      ]
                    : []),
                ]}
              />
              <AppTable
                className="product-list-mobile-table"
                toolbarSummary={
                  <div className="product-table-tools-summary">
                    <span>
                      <b>{total}</b> mặt hàng
                    </span>
                    <span>
                      Tổng tồn kho: <b>{formatQuantity(visibleStockTotal)}</b>
                    </span>
                    {canViewCost && (
                      <span>
                        Tổng vốn tồn kho:{" "}
                        <b>{formatVnd(visibleInventoryCapital)}</b>
                      </span>
                    )}
                  </div>
                }
                tools={
                  <div className="data-table-tools-actions">
                    <MobileSortControl
                      columns={tableColumns.map(({ key, label, sortable }) => ({
                        key,
                        label,
                        sortable,
                      }))}
                      sort={sort ?? { key: "name", direction: "asc" }}
                      onChange={setProductSort}
                    />
                    <AppButton
                      variant="default"
                      type="button"
                      iconLeft={<FaTable />}
                      className="column-menu-trigger"
                      aria-label="Hiện cột"
                      aria-expanded={columnMenuOpen}
                      onClick={() => setColumnMenuOpen((value) => !value)}
                    >
                      <span className="column-menu-trigger-label">Cột</span>
                    </AppButton>
                    {columnMenuOpen && (
                      <div
                        className="column-menu"
                        role="group"
                        aria-label="Hiện cột"
                      >
                        {tableColumns.map((column) => (
                          <label key={column.key}>
                            <AppInput
                              type="checkbox"
                              checked={!hiddenColumns.includes(column.key)}
                              onChange={(event) =>
                                setHiddenColumns((current) =>
                                  event.target.checked
                                    ? current.filter(
                                        (key) => key !== column.key,
                                      )
                                    : current.includes(column.key)
                                      ? current
                                      : [...current, column.key],
                                )
                              }
                            />
                            {column.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                }
              >
                <AppTable.Header
                  columns={visibleColumns.map((column) => ({
                    ...column,
                    total:
                      column.key === "stock"
                        ? formatQuantity(visibleStockTotal)
                        : column.key === "inventoryCapital"
                          ? formatVnd(visibleInventoryCapital)
                          : undefined,
                  }))}
                  sort={sort}
                  onSortChange={setProductSort}
                  onColumnMove={moveProductColumn}
                  totalRows={total}
                  trailingHeaderCell={<th />}
                />
                <tbody>
                  {renderedProducts.map((product) => (
                    <Fragment key={product.id}>
                      <tr
                        className={mergeClassNames(
                          "product-row mobile-unified-card",
                          isMobileRoute && "mobile-unified-card--interactive",
                          isMobileRoute &&
                            detailModal.activeId === product.id &&
                            "mobile-unified-card--selected",
                          !isMobileRoute &&
                            detailProductId === product.id &&
                            "product-detail-source-row",
                        )}
                        style={
                          !rows.some((row) => row.id === product.id) ||
                          (!isMobileRoute && detailProductId === product.id)
                            ? { display: "none" }
                            : undefined
                        }
                        onClick={(event) => {
                          if (
                            event.target instanceof Element &&
                            event.target.closest(
                              "button, a, input, select, textarea, [role='button'], [data-row-click-ignore]",
                            )
                          )
                            return;
                          openProduct(product);
                        }}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openProduct(product);
                          }
                        }}
                        tabIndex={0}
                        aria-label={
                          isMobileRoute
                            ? `Xem chi tiết ${product.name}`
                            : undefined
                        }
                        aria-expanded={
                          !isMobileRoute && expandedId === product.id
                            ? true
                            : undefined
                        }
                      >
                        {visibleColumns.some(
                          (column) => column.key === "sku",
                        ) && (
                          <td className="muted product-mobile-hidden">
                            {product.sku}
                          </td>
                        )}
                        {(visibleColumns.some(
                          (column) => column.key === "name",
                        ) ||
                          isMobileRoute) && (
                          <td
                            className="product-mobile-name"
                            style={{ fontWeight: 600 }}
                          >
                            {product.name}
                            {product.kind === "combo" && (
                              <span className="product-kind-badge">Combo</span>
                            )}
                          </td>
                        )}
                        {visibleColumns.some(
                          (column) => column.key === "unit",
                        ) && (
                          <td className="product-mobile-hidden">
                            {product.unit}
                          </td>
                        )}
                        {(visibleColumns.some(
                          (column) => column.key === "stock",
                        ) ||
                          isMobileRoute) && (
                          <td className="product-mobile-stock">
                            {formatQuantity(product.stock)}
                          </td>
                        )}
                        {lists
                          .filter(
                            (list) =>
                              !hiddenColumns.includes("price:" + list.id),
                          )
                          .map((list) => (
                            <td
                              key={list.id}
                              className="money-cell product-mobile-hidden"
                            >
                              {inlineMoneyCell(
                                product,
                                list.id,
                                Number(
                                  product.product_prices?.find(
                                    (item) => item.price_list_id === list.id,
                                  )?.price ?? 0,
                                ),
                              )}
                            </td>
                          ))}
                        {canViewCost && !hiddenColumns.includes("cost") && (
                          <td className="money-cell product-mobile-hidden">
                            {inlineMoneyCell(
                              product,
                              null,
                              Number(productCost(product)),
                            )}
                          </td>
                        )}
                        {canViewCost &&
                          !hiddenColumns.includes("inventoryCapital") && (
                            <td className="money-cell product-mobile-hidden">
                              {formatVnd(inventoryCapital(product))}
                            </td>
                          )}
                        <td className="product-mobile-actions">
                          <div className="action-list">
                            {canUpdate && (
                              <AppButton
                                variant="ghost"
                                iconOnly
                                title="Chỉnh sửa hàng hóa"
                                aria-label={`Chỉnh sửa ${product.name}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startEdit(product);
                                }}
                              >
                                <Pencil size={16} />
                                <span className="product-mobile-action-label">
                                  Hàng hoá
                                </span>
                              </AppButton>
                            )}
                            {canArchive &&
                              (product.is_active ? (
                                <AppButton
                                  variant="danger"
                                  iconOnly
                                  title="Ngừng kinh doanh"
                                  aria-label={
                                    "Ngừng kinh doanh " + product.name
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void archive(product);
                                  }}
                                >
                                  <X size={16} />
                                  <span className="product-mobile-action-label">
                                    Ngừng kinh doanh
                                  </span>
                                </AppButton>
                              ) : (
                                <AppButton
                                  variant="ghost"
                                  iconOnly
                                  title="Kinh doanh lại"
                                  aria-label={"Kinh doanh lại " + product.name}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void reactivate(product);
                                  }}
                                >
                                  <RotateCcw size={16} />
                                  <span className="product-mobile-action-label">
                                    Kinh doanh lại
                                  </span>
                                </AppButton>
                              ))}
                          </div>
                        </td>
                      </tr>
                      {expandedId === product.id && (
                        <tr
                          className="product-mobile-expanded-row"
                          style={
                            detailProductId === product.id
                              ? { display: "none" }
                              : undefined
                          }
                        >
                          <td
                            colSpan={visibleColumns.length + 1}
                            style={{ padding: 0 }}
                          >
                            <EntityDetailModal
                              open={detailProductId === product.id}
                              onClose={closeProductDetail}
                              panelClassName="product-detail-modal"
                              ariaLabel={`Chi tiết hàng hóa ${product.name}`}
                            >
                              <div className="product-expanded">
                                <div className="modal-title">
                                  <div>
                                    <h2>{product.name}</h2>
                                    <span className="muted">{product.sku}</span>
                                  </div>
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                    }}
                                  >
                                    {canUpdate && (
                                      <AppButton
                                        variant="ghost"
                                        type="button"
                                        title="Chỉnh sửa hàng hóa"
                                        aria-label="Chỉnh sửa hàng hóa"
                                        onClick={() => startEdit(product)}
                                      >
                                        <Pencil size={16} />
                                      </AppButton>
                                    )}
                                    <AppButton
                                      variant="ghost"
                                      type="button"
                                      className="mobile-dialog-close"
                                      aria-label="Đóng chi tiết hàng hóa"
                                      iconLeft={<X aria-hidden="true" />}
                                      onClick={closeProductDetail}
                                    />
                                  </div>
                                </div>
                                <div
                                  className="stock-tabs"
                                  role="tablist"
                                  aria-label="Thông tin hàng hóa"
                                >
                                  <AppButton
                                    variant="ghost"
                                    type="button"
                                    className={mergeClassNames(
                                      "stock-tab",
                                      activeTab === "history" && "active",
                                    )}
                                    role="tab"
                                    aria-selected={activeTab === "history"}
                                    onClick={() => setActiveTab("history")}
                                  >
                                    Nhật ký tồn kho
                                  </AppButton>
                                  <AppButton
                                    variant="ghost"
                                    type="button"
                                    className={mergeClassNames(
                                      "stock-tab",
                                      activeTab === "stats" && "active",
                                    )}
                                    role="tab"
                                    aria-selected={activeTab === "stats"}
                                    onClick={() => {
                                      setActiveTab("stats");
                                      void loadSalesStats(
                                        product.id,
                                        statsFrom || todayLocal(),
                                        statsTo || todayLocal(),
                                      );
                                    }}
                                  >
                                    Thống kê bán
                                  </AppButton>
                                </div>
                                {activeTab === "history" ? (
                                  <>
                                    <div className="product-history-toolbar">
                                      <DateRangeInput
                                        start={movementDateRange.from}
                                        end={movementDateRange.to}
                                        ariaLabel={`Lọc nhật ký tồn kho của ${product.name}`}
                                        onChange={(from, to) => {
                                          setMovementPage(1);
                                          setMovements([]);
                                          setMovementSummary({
                                            count: 0,
                                            quantityChange: 0,
                                          });
                                          setHistoryBusy(true);
                                          setMovementDateRange({ from, to });
                                        }}
                                      />
                                      <AppButton
                                        variant="default"
                                        type="button"
                                        disabled={historyExportBusy}
                                        data-product-id={product.id}
                                        aria-label={`Xuất nhật ký tồn kho ${product.name}`}
                                        className="product-history-export-button"
                                        onClick={handleInventoryHistoryExport}
                                        iconLeft={<Download size={15} />}
                                      >
                                        <span>Xuất</span>
                                      </AppButton>
                                    </div>
                                    {isMobileRoute ? (
                                      <div className="inventory-history-mobile">
                                        <div className="inventory-history-summary">
                                          <span>
                                            <strong>
                                              {displayedMovementSummary.count}
                                            </strong>{" "}
                                            giao dịch
                                          </span>
                                          <span>
                                            Thay đổi{" "}
                                            <strong>
                                              {formatQuantity(
                                                displayedMovementSummary.quantityChange,
                                              )}
                                            </strong>
                                          </span>
                                        </div>
                                        <div className="inventory-history-cards">
                                          {filteredMovements.map((movement) => {
                                            const hasSource = Boolean(
                                              movement.order_id ||
                                              movement.purchase_order_id ||
                                              (movement.stock_check_id &&
                                                canViewStockChecks),
                                            );
                                            return (
                                              <article
                                                key={movement.id}
                                                className={mergeClassNames(
                                                  "inventory-history-card mobile-unified-card",
                                                  hasSource &&
                                                    "inventory-history-card--interactive mobile-unified-card--interactive",
                                                  movement.is_cancelled &&
                                                    "inventory-history-card--cancelled mobile-unified-card--cancelled",
                                                )}
                                                role={
                                                  hasSource
                                                    ? "button"
                                                    : undefined
                                                }
                                                tabIndex={
                                                  hasSource ? 0 : undefined
                                                }
                                                title={
                                                  hasSource
                                                    ? "Mở chứng từ liên quan"
                                                    : undefined
                                                }
                                                onClick={() => {
                                                  if (hasSource)
                                                    openMovementSource(
                                                      movement,
                                                    );
                                                }}
                                                onKeyDown={(event) => {
                                                  if (
                                                    !hasSource ||
                                                    (event.key !== "Enter" &&
                                                      event.key !== " ")
                                                  )
                                                    return;
                                                  event.preventDefault();
                                                  openMovementSource(movement);
                                                }}
                                              >
                                                <div className="inventory-history-card-heading">
                                                  <time
                                                    dateTime={
                                                      movement.created_at
                                                    }
                                                  >
                                                    {formatDateTime(
                                                      movement.created_at,
                                                    )}
                                                  </time>
                                                  <strong className="inventory-history-counterparty">
                                                    {movement.is_cancelled
                                                      ? "Đã huỷ"
                                                      : movement.counterparty}
                                                  </strong>
                                                </div>
                                                <div className="inventory-history-metrics">
                                                  <div className="inventory-history-change">
                                                    <span>Thay đổi</span>
                                                    <strong>
                                                      {formatQuantity(
                                                        Number(
                                                          movement.quantity_change,
                                                        ),
                                                      )}
                                                    </strong>
                                                  </div>
                                                  <div>
                                                    <span>
                                                      Tồn sau giao dịch
                                                    </span>
                                                    <strong>
                                                      {movement.stock_after ==
                                                      null
                                                        ? "—"
                                                        : formatQuantity(
                                                            Number(
                                                              movement.stock_after,
                                                            ),
                                                          )}
                                                    </strong>
                                                  </div>
                                                </div>
                                                <div className="inventory-history-detail">
                                                  <span>Lý do</span>
                                                  <span>{movement.reason}</span>
                                                </div>
                                                <div className="inventory-history-detail">
                                                  <span>Người thực hiện</span>
                                                  <span>
                                                    {movement.actor_name}
                                                  </span>
                                                </div>
                                              </article>
                                            );
                                          })}
                                          {!filteredMovements.length && (
                                            <p className="muted inventory-history-empty">
                                              {historyBusy
                                                ? "Đang tải nhật ký…"
                                                : movementDateRange.from ||
                                                    movementDateRange.to
                                                  ? "Không có giao dịch trong khoảng ngày đã chọn."
                                                  : "Chưa có giao dịch tồn kho."}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="table-wrap">
                                        <AppTable style={{ minWidth: 600 }}>
                                          <thead>
                                            <tr>
                                              <th>Thời gian</th>
                                              <th>Khách / đơn nhập</th>
                                              <th>Thay đổi</th>
                                              <th>Tồn sau giao dịch</th>
                                              <th>Người thực hiện</th>
                                            </tr>
                                            <tr className="table-summary-row">
                                              <th>
                                                Tổng (
                                                {displayedMovementSummary.count}{" "}
                                                giao dịch)
                                              </th>
                                              <th></th>
                                              <th>
                                                {formatQuantity(
                                                  displayedMovementSummary.quantityChange,
                                                )}
                                              </th>
                                              <th></th>
                                              <th></th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {filteredMovements.map(
                                              (movement) => {
                                                const hasSource = Boolean(
                                                  movement.order_id ||
                                                  movement.purchase_order_id ||
                                                  (movement.stock_check_id &&
                                                    canViewStockChecks),
                                                );
                                                return (
                                                  <tr
                                                    key={movement.id}
                                                    aria-label={
                                                      hasSource
                                                        ? "Mở chứng từ liên quan"
                                                        : undefined
                                                    }
                                                    tabIndex={
                                                      hasSource ? 0 : undefined
                                                    }
                                                    title={
                                                      hasSource
                                                        ? "Mở chứng từ liên quan"
                                                        : undefined
                                                    }
                                                    style={
                                                      hasSource
                                                        ? { cursor: "pointer" }
                                                        : undefined
                                                    }
                                                    onClick={() => {
                                                      if (hasSource)
                                                        openMovementSource(
                                                          movement,
                                                        );
                                                    }}
                                                    onKeyDown={(event) => {
                                                      if (
                                                        !hasSource ||
                                                        (event.key !==
                                                          "Enter" &&
                                                          event.key !== " ")
                                                      )
                                                        return;
                                                      event.preventDefault();
                                                      openMovementSource(
                                                        movement,
                                                      );
                                                    }}
                                                  >
                                                    <td>
                                                      {formatDateTime(
                                                        movement.created_at,
                                                      )}
                                                    </td>
                                                    <td>
                                                      {movement.counterparty}
                                                    </td>
                                                    <td>
                                                      {formatQuantity(
                                                        Number(
                                                          movement.quantity_change,
                                                        ),
                                                      )}{" "}
                                                      · {movement.reason}
                                                    </td>
                                                    <td>
                                                      {movement.stock_after ==
                                                      null
                                                        ? "—"
                                                        : formatQuantity(
                                                            Number(
                                                              movement.stock_after,
                                                            ),
                                                          )}
                                                    </td>
                                                    <td>
                                                      {movement.actor_name}
                                                    </td>
                                                  </tr>
                                                );
                                              },
                                            )}
                                            {!filteredMovements.length && (
                                              <tr>
                                                <td
                                                  colSpan={5}
                                                  className="muted"
                                                  style={{
                                                    textAlign: "center",
                                                  }}
                                                >
                                                  {historyBusy
                                                    ? "Đang tải nhật ký…"
                                                    : movementDateRange.from ||
                                                        movementDateRange.to
                                                      ? "Không có giao dịch trong khoảng ngày đã chọn."
                                                      : "Chưa có giao dịch tồn kho."}
                                                </td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </AppTable>
                                      </div>
                                    )}
                                    {displayedMovementSummary.count >
                                      inventoryHistoryPageSize && (
                                      <div className="pagination">
                                        <div>
                                          {displayedMovementSummary.count} giao
                                          dịch · Trang {movementPage} /{" "}
                                          {movementPageCount}
                                        </div>
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                          }}
                                        >
                                          <AppButton
                                            variant="secondary"
                                            type="button"
                                            aria-label="Trang nhật ký tồn kho trước"
                                            disabled={
                                              historyBusy || movementPage <= 1
                                            }
                                            style={{
                                              minHeight: 32,
                                              padding: "0 8px",
                                            }}
                                            onClick={() =>
                                              changeInventoryHistoryPage(
                                                Math.max(1, movementPage - 1),
                                              )
                                            }
                                          >
                                            <ChevronLeft size={15} />
                                          </AppButton>
                                          <AppButton
                                            variant="secondary"
                                            type="button"
                                            aria-label="Trang nhật ký tồn kho tiếp"
                                            disabled={
                                              historyBusy ||
                                              movementPage >= movementPageCount
                                            }
                                            style={{
                                              minHeight: 32,
                                              padding: "0 8px",
                                            }}
                                            onClick={() =>
                                              changeInventoryHistoryPage(
                                                Math.min(
                                                  movementPageCount,
                                                  movementPage + 1,
                                                ),
                                              )
                                            }
                                          >
                                            <ChevronRight size={15} />
                                          </AppButton>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div style={{ display: "grid", gap: 12 }}>
                                    <DateRangeInput
                                      start={statsFrom}
                                      end={statsTo}
                                      ariaLabel="Khoảng thời gian thống kê bán"
                                      onChange={changeStatsRange}
                                    />
                                    <div
                                      className="card"
                                      style={{
                                        padding: 14,
                                        display: "grid",
                                        gridTemplateColumns:
                                          "repeat(auto-fit, minmax(min(100%, 175px), 1fr))",
                                        gap: 12,
                                      }}
                                    >
                                      <div>
                                        <div
                                          className="muted"
                                          style={{ fontSize: 12 }}
                                        >
                                          Số lượng bán trong kỳ
                                        </div>
                                        <b>
                                          {salesStats
                                            ? formatQuantity(
                                                Number(salesStats.quantity),
                                              ) +
                                              " " +
                                              product.unit
                                            : statsBusy
                                              ? "Đang tải…"
                                              : "—"}
                                        </b>
                                      </div>
                                      <div>
                                        <div
                                          className="muted"
                                          style={{ fontSize: 12 }}
                                        >
                                          Doanh thu trong kỳ
                                        </div>
                                        <b>
                                          {salesStats
                                            ? formatVnd(
                                                Number(salesStats.revenue),
                                              )
                                            : statsBusy
                                              ? "Đang tải…"
                                              : "—"}
                                        </b>
                                      </div>
                                      {canViewCost && (
                                        <div>
                                          <div
                                            className="muted"
                                            style={{ fontSize: 12 }}
                                          >
                                            Tổng lợi nhuận trong kỳ
                                          </div>
                                          <b>
                                            {salesStats
                                              ? salesStats.missing_cost_line_count >
                                                0
                                                ? "Chưa đủ dữ liệu giá vốn"
                                                : salesStats.gross_profit ===
                                                      null ||
                                                    salesStats.gross_profit ===
                                                      undefined
                                                  ? "—"
                                                  : formatVnd(
                                                      Number(
                                                        salesStats.gross_profit,
                                                      ),
                                                    )
                                              : statsBusy
                                                ? "Đang tải…"
                                                : "—"}
                                          </b>
                                        </div>
                                      )}
                                    </div>
                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns:
                                          "repeat(auto-fit, minmax(min(100%, 230px), 1fr))",
                                        gap: 12,
                                      }}
                                    >
                                      <ProductSalesChart
                                        title="Doanh thu trong kỳ"
                                        metric="revenue"
                                        color="#2563eb"
                                        unit={product.unit}
                                        data={salesStats ? salesTrend : null}
                                        loading={statsBusy}
                                      />
                                      {canViewCost && (
                                        <ProductSalesChart
                                          title="Lợi nhuận trong kỳ"
                                          metric="gross_profit"
                                          color="#15803d"
                                          unit={product.unit}
                                          data={salesStats ? salesTrend : null}
                                          loading={statsBusy}
                                        />
                                      )}
                                      <ProductSalesChart
                                        title="Số lượng bán trong kỳ"
                                        metric="quantity"
                                        color="#a16207"
                                        unit={product.unit}
                                        data={salesStats ? salesTrend : null}
                                        loading={statsBusy}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </EntityDetailModal>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {renderedProducts.length === 0 && (
                    <tr>
                      <td
                        colSpan={Math.max(
                          6,
                          5 + lists.length + (canViewCost ? 2 : 0),
                        )}
                        className="muted"
                        style={{ textAlign: "center", padding: 36 }}
                      >
                        Chưa có hàng hóa phù hợp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AppTable>
              <div className="pagination">
                <div>
                  Trang {page} · {total} kết quả
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <div style={{ width: 120 }}>
                    <AppSelect
                      ariaLabel="Số hàng hóa trên trang"
                      value={size}
                      options={[20, 50, 100].map((value) => ({
                        value: String(value),
                        label: value + " / trang",
                      }))}
                      onChange={(value) => updateUrl(1, Number(value))}
                    />
                  </div>
                  <AppButton
                    variant="secondary"

                    style={{ minHeight: 32, padding: "0 8px" }}
                    disabled={page <= 1}
                    onClick={() => updateUrl(page - 1)}
                  >
                    <ChevronLeft size={15} />
                  </AppButton>
                  <AppButton
                    variant="secondary"

                    style={{ minHeight: 32, padding: "0 8px" }}
                    disabled={page * size >= total}
                    onClick={() => updateUrl(page + 1)}
                  >
                    <ChevronRight size={15} />
                  </AppButton>
                </div>
              </div>
            </section>
          )}
          <EntityDetailModal
            open={Boolean(
              detailProductId &&
              (detailProductLoading ||
                detailProductError ||
                !selectedDetailProduct),
            )}
            onClose={closeProductDetail}
            panelClassName="product-detail-modal"
            ariaLabel="Chi tiết hàng hóa"
          >
            <div className="product-detail-loading">
              {detailProductLoading
                ? "Đang tải chi tiết hàng hóa…"
                : detailProductError ||
                  "Không tìm thấy hàng hóa hoặc không có quyền xem."}
            </div>
          </EntityDetailModal>
          <ConfirmDialog
            request={confirmRequest}
            onCancel={() => {
              confirmAction.current = null;
              setConfirmRequest(null);
            }}
            onConfirm={() => {
              const action = confirmAction.current;
              confirmAction.current = null;
              setConfirmRequest(null);
              if (action) void action();
            }}
          />
          {exportOpen && (
            <DataExportFieldModal
              title="Xuất hàng hóa"
              description="Chọn loại dữ liệu và các cột cần tải xuống."
              groups={productDetailGroups}
              defaultSelectedKeys={exportForm.getValues().fields}
              busy={exportBusy}
              submitDisabled={
                exportKind === "sales" && (!exportFrom || !exportTo)
              }
              error={error}
              onCancel={handleCancelProductExport}
              onExport={handleExportProducts}
            >
              <div className="form-label">Loại dữ liệu</div>
              <div className="data-export-product-types">
                <AppButton
                  variant={exportKind === "inventory" ? "primary" : "secondary"}
                  type="button"
                  onClick={() => exportForm.setValue("kind", "inventory")}
                >
                  Tồn kho hiện tại
                </AppButton>
                <AppButton
                  variant={exportKind === "sales" ? "primary" : "secondary"}
                  type="button"
                  onClick={() => exportForm.setValue("kind", "sales")}
                >
                  Số lượng đã bán
                </AppButton>
              </div>
              {exportKind === "sales" && (
                <DateRangeInput
                  start={exportFrom}
                  end={exportTo}
                  ariaLabel="Khoảng thời gian xuất số lượng bán"
                  onChange={(from, to) => {
                    exportForm.setValue("from", from);
                    exportForm.setValue("to", to);
                  }}
                />
              )}
            </DataExportFieldModal>
          )}
        </div>
      </div>
      {draft && (
        <ModalLayer
          className="modal-backdrop"
          onEscape={() => {
            setDraft(null);
            setError("");
          }}
        >
          <section className="modal card">
            <div className="modal-title">
              <h2>
                {draft.id
                  ? draft.kind === "combo"
                    ? "Chỉnh sửa combo"
                    : "Chỉnh sửa hàng hóa"
                  : draft.kind === "combo"
                    ? "Thêm combo"
                    : "Thêm hàng hóa"}
              </h2>
              <AppButton
                variant="ghost"

                onClick={() => {
                  setDraft(null);
                  setError("");
                }}
              >
                <X size={18} />
              </AppButton>
            </div>
            <form onSubmit={productForm.handleSubmit(save)}>
              <div className="modal-form">
                <label className="form-label span-2">
                  {draft.kind === "combo" ? "Tên combo" : "Tên hàng hóa"}
                  <AppInput
                    className="field"
                    required
                    autoFocus
                    {...productForm.register("name", { required: true })}
                  />
                </label>
                <label className="form-label">
                  Đơn vị tính
                  <AppInput
                    className="field"
                    {...productForm.register("unit")}
                    placeholder="cái, kg, lít…"
                  />
                </label>
                {draft.kind === "product" && (
                  <label className="form-label span-2">
                    Tồn kho
                    <Controller
                      control={productForm.control}
                      name="stock"
                      rules={{
                        required: true,
                        validate: (value) =>
                          Number.isFinite(Number(value)) ||
                          "Số tồn không hợp lệ.",
                      }}
                      render={({ field }) => (
                        <NumberInputField
                          step={DECIMAL_INPUT_STEP}
                          allowNegative
                          value={field.value}
                          disabled={Boolean(draft.id) && !canAdjustStock}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </label>
                )}
                {canUpdateCost && draft.kind === "product" && (
                  <label className="form-label span-2">
                    Giá vốn (VNĐ)
                    <Controller
                      control={productForm.control}
                      name="cost"
                      rules={{
                        required: true,
                        validate: (value) =>
                          (Number.isFinite(Number(value)) &&
                            Number(value) >= 0) ||
                          "Giá vốn không hợp lệ.",
                      }}
                      render={({ field }) => (
                        <NumberInputField
                          min={0}
                          step={1}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </label>
                )}
                {draft.kind === "combo" && (
                  <div className="form-label span-2 product-bundle-editor">
                    <div className="product-bundle-editor__heading">
                      <span>Hàng hóa thành phần</span>
                      <AppButton
                        variant="secondary"
                        type="button"
                        onClick={() =>
                          bundleItemFields.append({
                            product_id: "",
                            quantity: "1",
                          })
                        }
                      >
                        <Plus size={14} /> Thêm hàng hóa
                      </AppButton>
                    </div>
                    {bundleItemFields.fields.length === 0 && (
                      <p className="muted product-bundle-editor__empty">
                        Chọn hàng hóa có sẵn và số lượng cần dùng cho mỗi combo.
                      </p>
                    )}
                    {bundleItemFields.fields.map((field, index) => {
                      const selectedId = bundleItemsValue?.[index]?.product_id;
                      const usedIds = new Set(
                        (bundleItemsValue ?? [])
                          .map((item, itemIndex) =>
                            itemIndex === index ? "" : item.product_id,
                          )
                          .filter(Boolean),
                      );
                      return (
                        <div className="product-bundle-row" key={field.id}>
                          <Controller
                            control={productForm.control}
                            name={`bundleItems.${index}.product_id`}
                            rules={{ required: "Chọn hàng hóa thành phần." }}
                            render={({ field: selectField }) => (
                              <select
                                className="field"
                                aria-label={`Hàng hóa thành phần ${index + 1}`}
                                value={selectField.value}
                                onChange={selectField.onChange}
                              >
                                <option value="">Chọn hàng hóa</option>
                                {componentOptions.map((option) => (
                                  <option
                                    key={option.id}
                                    value={option.id}
                                    disabled={
                                      !option.is_active ||
                                      (usedIds.has(option.id) &&
                                        option.id !== selectedId)
                                    }
                                  >
                                    {option.name} · {option.sku}
                                    {option.is_active
                                      ? ""
                                      : " · Ngừng kinh doanh"}
                                  </option>
                                ))}
                              </select>
                            )}
                          />
                          <Controller
                            control={productForm.control}
                            name={`bundleItems.${index}.quantity`}
                            rules={{
                              required: true,
                              validate: (value) =>
                                (Number.isFinite(Number(value)) &&
                                  Number(value) > 0) ||
                                "Số lượng phải lớn hơn 0.",
                            }}
                            render={({ field: quantityField }) => (
                              <NumberInputField
                                ariaLabel={`Số lượng hàng hóa thành phần ${index + 1}`}
                                min={0}
                                step={DECIMAL_INPUT_STEP}
                                value={quantityField.value}
                                onChange={quantityField.onChange}
                              />
                            )}
                          />
                          <AppButton
                            variant="ghost"
                            type="button"
                            aria-label={`Xóa hàng hóa thành phần ${index + 1}`}
                            onClick={() => bundleItemFields.remove(index)}
                          >
                            <X size={16} />
                          </AppButton>
                        </div>
                      );
                    })}
                    <small className="muted">
                      Số lượng thành phần hỗ trợ tối đa 3 chữ số thập phân.
                    </small>
                  </div>
                )}
                {draft.kind === "combo" && (
                  <p className="muted span-2 product-bundle-cost-note">
                    Giá vốn combo được tính từ giá vốn các hàng hóa thành phần
                    tại thời điểm bán.
                  </p>
                )}
                {lists.map((list) => (
                  <label className="form-label" key={list.id}>
                    {list.name} (VNĐ)
                    <Controller
                      control={productForm.control}
                      name={`prices.${list.id}`}
                      rules={{
                        required: true,
                        validate: (value) =>
                          (Number.isFinite(Number(value)) &&
                            Number(value) >= 0) ||
                          `Giá trong bảng "${list.name}" không hợp lệ.`,
                      }}
                      render={({ field }) => (
                        <NumberInputField
                          min={0}
                          step={1}
                          value={field.value ?? "0"}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </label>
                ))}
              </div>
              {error && (
                <div className="alert" style={{ marginTop: 14 }}>
                  {error}
                </div>
              )}
              <div className="form-actions">
                <AppButton
                  variant="secondary"
                  type="button"

                  onClick={() => setDraft(null)}
                >
                  Hủy
                </AppButton>
                <AppButton variant="primary" disabled={busy}>
                  {busy
                    ? "Đang lưu…"
                    : draft.kind === "combo"
                      ? "Lưu combo"
                      : "Lưu hàng hóa"}
                </AppButton>
              </div>
            </form>
          </section>
        </ModalLayer>
      )}
    </>
  );
}
