"use client";

import { AppButton } from "@/components/app-button";
import { AppBadge } from "@/components/app-badge";
import { AppInput } from "@/components/app-input";
import { SearchInputField } from "@/components/search-input-field";
import { mergeClassNames } from "@/lib/class-names";
import { AppTable } from "@/components/app-table";
import { ReceiptPrint } from "@/components/receipt-print";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "react-toastify";
import { createClient } from "@/lib/data/client";
import { formatQuantity, formatVnd } from "@/lib/format";
import { DECIMAL_INPUT_STEP } from "@/lib/constants";
import { AppSelect } from "@/components/app-select";
import { CustomerPicker } from "@/components/customer-picker";
import { DateRangeInput } from "@/components/date-range-input";
import {
  DataTable,
  type DataColumn,
  type DataTableSort,
} from "@/components/data-table";
import { MobileSortControl } from "@/components/mobile-sort-control";
import { MobileTableToolbarMetrics } from "@/components/mobile-table-toolbar-metrics";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";
import { NumberInputField } from "@/components/number-input-field";
import { formatDateTime } from "@/lib/date";
import { printPage } from "@/lib/print-page";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import {
  productDetailsHrefForRoute,
  type OrderMetricColumn,
} from "@/lib/management-navigation";
import { EntityDetailModal } from "@/components/entity-detail-modal";
import { useEntityDetailId } from "@/lib/use-entity-detail-id";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import { useDebounce } from "@/lib/debounce";
import { fetchCachedQuery } from "@/lib/query-cache";
import { useInitialTableLoading } from "@/lib/use-initial-table-loading";
import { usePreference } from "@/lib/preferences";
import { useAutoPrintSetting } from "@/lib/system-settings";
import { sortOrderItemsForDisplay } from "@/lib/order-item-order";
import {
  attachProductBundleItems,
  hasSellableBundleItems,
} from "@/lib/product-bundles";
import {
  readPosSearchProducts,
  searchProductsLocally,
} from "@/lib/pos-search-cache";
import type { Product } from "@/lib/types";
import { Controller, useForm } from "react-hook-form";
import { createCsv } from "@/lib/csv-export";
import { useStableCallback } from "@/lib/use-stable-callback";
import {
  DataExportFieldModal,
  DataExportMenu,
} from "@/components/data-export-controls";

function downloadOrdersCsv(filename: string, csv: string) {
  const blobUrl = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

type OrderStatus = "completed" | "cancelled";
type Order = {
  id: string;
  order_no: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  note?: string;
  price_list_name: string;
  price_list_id?: string | null;
  subtotal: number;
  discount: number;
  total: number;
  created_at: string;
  cashier_id: string;
  status: OrderStatus;
  profit?: number | null;
  order_profit_snapshots?: { profit: number } | null;
};
type Line = {
  id: string;
  display_order: number;
  product_id: string | null;
  sku: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  is_new?: boolean;
  components?: {
    product_id: string | null;
    sku: string;
    product_name: string;
    unit: string;
    quantity_per_bundle: number;
  }[];
};
type OrderEditValues = {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  discount: string;
  priceListId: string;
  items: Line[];
};
type OrderEditPriceList = { id: string; name: string };
type OrderFilters = {
  invoice: string;
  customer: string;
  productSkus: string[];
  productId: string;
  productName: string;
  statuses: OrderStatus[];
  from: string;
  to: string;
  fromTime: string;
  toTime: string;
};
type OrderSummary = {
  count: number;
  subtotal: number;
  discount: number;
  total: number;
  profit: number;
};
type ProductFilterOption = { sku: string; product_name: string };
type OrderExportField = {
  key: string;
  label: string;
  read: (order: Order, item: OrderExportLine | null) => unknown;
};
type OrderExportLine = {
  id: string;
  order_id: string;
  display_order: number;
  sku: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};
type OrderExportRow = { order: Order; item: OrderExportLine | null };
const todayBangkok = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const defaultOrderFilters = (): OrderFilters => ({
  invoice: "",
  customer: "",
  productSkus: [],
  productId: "",
  productName: "",
  statuses: ["completed", "cancelled"],
  from: todayBangkok(),
  to: todayBangkok(),
  fromTime: "",
  toTime: "",
});
const readTimeParam = (params: URLSearchParams, key: string) => {
  const value = params.get(key) || "";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
};
const isValidOrderTimeRange = (filters: OrderFilters) =>
  !filters.fromTime ||
  !filters.toTime ||
  filters.from !== filters.to ||
  filters.fromTime <= filters.toTime;
const PRODUCT_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const defaultOrdersSort: DataTableSort = {
  key: "created_at",
  direction: "desc",
};
const safeFilterText = (value: string) =>
  value.trim().replace(/[%_,()."\\]/g, "");
const normalizeOrderUnitPrice = (value: number | string) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function OrdersManagement({
  canReadAll,
  canReadProducts,
  canViewProfit,
  canCancel,
  canEdit,
  canSearchCustomers,
  userId,
}: {
  canReadAll: boolean;
  canReadProducts: boolean;
  canViewProfit: boolean;
  canCancel: boolean;
  canEdit: boolean;
  canSearchCustomers: boolean;
  userId: string;
}) {
  const pathname = usePathname();
  const isMobileRoute = pathname.startsWith("/mobile/");
  const detailModal = useEntityDetailId();
  const detailOrderId = detailModal.id;
  const isMobileDetailRoute = Boolean(detailOrderId && isMobileRoute);
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [savedSort, setSort] = usePreference<DataTableSort | null>(
    "table.orders.sort",
    defaultOrdersSort,
  );
  const sort = savedSort ?? defaultOrdersSort;
  const [filters, setFilters] = useState<OrderFilters>(() =>
    defaultOrderFilters(),
  );
  const [draftFilters, setDraftFilters] = useState<OrderFilters>(() =>
    defaultOrderFilters(),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [detailExportOpen, setDetailExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [visibleTableColumnKeys, setVisibleTableColumnKeys] = useState<
    string[]
  >([]);
  const [focusedMetricColumn, setFocusedMetricColumn] =
    useState<OrderMetricColumn | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productOptions, setProductOptions] = useState<ProductFilterOption[]>(
    [],
  );
  const [cachedProducts, setCachedProducts] = useState<
    { sku: string; name: string }[]
  >([]);
  const [editProductCatalog, setEditProductCatalog] = useState<Product[]>([]);
  const [editProductCatalogReady, setEditProductCatalogReady] = useState(false);
  const [editProductSearch, setEditProductSearch] = useState("");
  const [activeEditProductIndex, setActiveEditProductIndex] = useState(0);
  const [loadedProductSearch, setLoadedProductSearch] = useState<string | null>(
    null,
  );
  const [draftContact, setDraftContact] = useState({
    name: "",
    phone: "",
    address: "",
  });
  const debouncedProductSearch = useDebounce(productSearch);
  const localProductOptions = useMemo(
    () =>
      searchProductsLocally(cachedProducts, productSearch).map((product) => ({
        sku: product.sku,
        product_name: product.name,
      })),
    [cachedProducts, productSearch],
  );
  const editProductOptions = useMemo(
    () => searchProductsLocally(editProductCatalog, editProductSearch, 8),
    [editProductCatalog, editProductSearch],
  );
  const visibleProductOptions = useMemo(() => {
    const options = new Map<string, ProductFilterOption>();
    for (const product of localProductOptions)
      if (!options.has(product.sku)) options.set(product.sku, product);
    const currentRemoteOptions =
      loadedProductSearch === safeFilterText(debouncedProductSearch) &&
      safeFilterText(productSearch) === safeFilterText(debouncedProductSearch)
        ? productOptions
        : [];
    for (const product of currentRemoteOptions)
      if (!options.has(product.sku)) options.set(product.sku, product);
    return [...options.values()];
  }, [
    debouncedProductSearch,
    loadedProductSearch,
    localProductOptions,
    productOptions,
    productSearch,
  ]);
  const productOptionsLoading =
    visibleProductOptions.length === 0 &&
    (loadedProductSearch !== safeFilterText(debouncedProductSearch) ||
      safeFilterText(productSearch) !== safeFilterText(debouncedProductSearch));
  const [selected, setSelected] = useState<Order | null>(null);
  const loadedDetailOrderIdRef = useRef<string | null>(null);
  const detailRequestIdRef = useRef(0);
  const [detailLoading, setDetailLoading] = useState(Boolean(detailOrderId));
  const [error, setError] = useState("");
  const orderEditForm = useForm<OrderEditValues>({
    defaultValues: {
      customerName: "",
      customerPhone: "",
      customerAddress: "",
      discount: "0",
      priceListId: "",
      items: [],
    },
  });
  const items = orderEditForm.watch("items");
  const editPriceListId = orderEditForm.watch("priceListId");
  const [orderEditPriceLists, setOrderEditPriceLists] = useState<
    OrderEditPriceList[]
  >([]);
  const [priceListsLoading, setPriceListsLoading] = useState(false);
  const [autoPrint, , autoPrintSettingReady] = useAutoPrintSetting(userId);
  const orderEditPriceListOptions = orderEditPriceLists.map((priceList) => ({
    value: priceList.id,
    label: priceList.name,
  }));
  if (
    selected?.price_list_id &&
    !orderEditPriceLists.some(
      (priceList) => priceList.id === selected.price_list_id,
    )
  ) {
    orderEditPriceListOptions.unshift({
      value: selected.price_list_id,
      label: `${selected.price_list_name} (hiện tại)`,
    });
  }
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const confirmAction = useRef<(() => Promise<void>) | null>(null);
  const filterRootRef = useRef<HTMLElement>(null);
  const [originalItems, setOriginalItems] = useState<Line[]>([]);
  const [summary, setSummary] = useState<OrderSummary>({
    count: 0,
    subtotal: 0,
    discount: 0,
    total: 0,
    profit: 0,
  });
  const [cancelling, setCancelling] = useState(false);
  const { loading, finishInitialLoad } = useInitialTableLoading();
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  useEffect(() => {
    if (!editing) return;
    let current = true;
    setPriceListsLoading(true);
    void supabase
      .from("price_lists")
      .select("id,name")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .then((result: { data: unknown; error: unknown }) => {
        if (!current) return;
        if (result.error) {
          setError("Không tải được danh sách bảng giá.");
          return;
        }
        setOrderEditPriceLists(
          (result.data ?? []) as OrderEditPriceList[],
        );
      })
      .finally(() => {
        if (current) setPriceListsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [editing, supabase]);
  const load = useCallback(
    async (
      nextPage = page,
      nextSize = size,
      nextFilters: OrderFilters = filters,
      nextSort: DataTableSort = sort,
    ) => {
      const urlPage = Math.max(1, nextPage);
      const urlSize = nextSize;
      const productId = PRODUCT_ID_PATTERN.test(nextFilters.productId)
        ? nextFilters.productId
        : "";
      const urlFilters: OrderFilters = {
        ...nextFilters,
        productSkus: [...nextFilters.productSkus].sort(),
        productId,
        productName: productId ? nextFilters.productName : "",
      };
      const activeSort =
        !canViewProfit && nextSort.key === "profit"
          ? { key: "created_at", direction: "desc" as const }
          : nextSort;
      const lower = (urlPage - 1) * urlSize;
      const profitJoin = canViewProfit
        ? ",order_profit_snapshots" +
          (activeSort.key === "profit" ? "!inner" : "") +
          "(profit)"
        : "";
      const invoice = safeFilterText(urlFilters.invoice);
      const customer = safeFilterText(urlFilters.customer);
      const selectedColumns =
        "id,order_no,customer_name,customer_phone,customer_address,note,price_list_name,subtotal,discount,total,created_at,cashier_id,status" +
        profitJoin;
      const key = [
        "orders",
        userId,
        canReadAll,
        urlPage,
        urlSize,
        invoice,
        customer,
        urlFilters.productSkus,
        urlFilters.productId,
        urlFilters.statuses,
        urlFilters.from,
        urlFilters.to,
        urlFilters.fromTime,
        urlFilters.toTime,
        activeSort.key,
        activeSort.direction,
      ];
      try {
        const result = await queryClient.fetchQuery({
          queryKey: key,
          staleTime: 30_000,
          queryFn: async () => {
            const pageResponse = await supabase.rpc("orders_page_filtered", {
              p_invoice_query: invoice,
              p_customer_query: customer,
              p_product_skus: urlFilters.productSkus,
              p_product_id: urlFilters.productId || null,
              p_statuses: urlFilters.statuses,
              p_from: urlFilters.from || null,
              p_to: urlFilters.to || null,
              p_from_time: urlFilters.fromTime || null,
              p_to_time: urlFilters.toTime || null,
              p_sort: activeSort.key,
              p_direction: activeSort.direction,
              p_offset: lower,
              p_limit: urlSize,
            });
            if (pageResponse.error) throw pageResponse.error;
            const ids = (pageResponse.data?.ids || []) as string[];
            const count = Number(pageResponse.data?.total || 0);
            if (!ids.length) return { data: [], count };

            const response = await supabase
              .from("orders")
              .select(selectedColumns)
              .in("id", ids);
            if (response.error) throw response.error;
            const byId = new Map(
              ((response.data || []) as Order[]).map((order) => [
                order.id,
                order,
              ]),
            );
            return {
              data: ids
                .map((id) => byId.get(id))
                .filter((order): order is Order => order !== undefined),
              count,
            };
          },
        });
        setRows(
          (result.data as Order[]).map((order) => ({
            ...order,
            profit: order.order_profit_snapshots?.profit ?? null,
          })),
        );
        setTotal(result.count);
        setError("");
        const summaryData = await queryClient.fetchQuery({
          queryKey: [
            "orders-summary-filtered",
            userId,
            canReadAll,
            invoice,
            customer,
            urlFilters.productSkus,
            urlFilters.productId,
            urlFilters.statuses,
            urlFilters.from,
            urlFilters.to,
            urlFilters.fromTime,
            urlFilters.toTime,
          ],
          staleTime: 30_000,
          queryFn: async () => {
            const response = await supabase.rpc("orders_summary_filtered", {
              p_invoice_query: invoice,
              p_customer_query: customer,
              p_product_skus: urlFilters.productSkus,
              p_product_id: urlFilters.productId || null,
              p_statuses: urlFilters.statuses,
              p_from: urlFilters.from || null,
              p_to: urlFilters.to || null,
              p_from_time: urlFilters.fromTime || null,
              p_to_time: urlFilters.toTime || null,
            });
            if (response.error) throw response.error;
            return response.data as {
              count: number;
              subtotal: number;
              discount: number;
              total: number;
              profit: number | null;
            };
          },
        });
        setSummary({
          ...summaryData,
          profit: Number(summaryData.profit || 0),
        });
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Không tải được đơn hàng.",
        );
      }
      setPage(urlPage);
      setSize(urlSize);
      setFilters(urlFilters);
      setDraftFilters(urlFilters);
      setDraftContact({ name: urlFilters.customer, phone: "", address: "" });
      finishInitialLoad();
      const next = new URLSearchParams();
      if (urlPage > 1) next.set("page", String(urlPage));
      if (urlSize !== 20) next.set("size", String(urlSize));
      if (urlFilters.invoice) next.set("invoice", urlFilters.invoice);
      if (urlFilters.customer) next.set("customer", urlFilters.customer);
      for (const sku of urlFilters.productSkus) next.append("sku", sku);
      if (urlFilters.productId) next.set("productId", urlFilters.productId);
      if (urlFilters.productName)
        next.set("productName", urlFilters.productName);
      const currentParams = new URLSearchParams(window.location.search);
      const requestedOrderId =
        currentParams.get("id") || currentParams.get("orderId");
      if (requestedOrderId) next.set("id", requestedOrderId);
      if (urlFilters.statuses.length)
        for (const status of urlFilters.statuses) next.append("status", status);
      else next.set("status", "all");
      if (urlFilters.from) next.set("from", urlFilters.from);
      if (urlFilters.to) next.set("to", urlFilters.to);
      if (urlFilters.fromTime) next.set("fromTime", urlFilters.fromTime);
      if (urlFilters.toTime) next.set("toTime", urlFilters.toTime);
      const requestedMetricColumn = currentParams.get("metricColumn");
      if (
        !isMobileRoute &&
        (requestedMetricColumn === "subtotal" ||
          requestedMetricColumn === "discount" ||
          (requestedMetricColumn === "profit" && canViewProfit))
      ) {
        next.set("metricColumn", requestedMetricColumn);
      }
      next.set("sort", activeSort.key);
      next.set("dir", activeSort.direction);
      window.history.replaceState(
        null,
        "",
        window.location.pathname +
          (next.size ? "?" + next.toString() : "") +
          window.location.hash,
      );
    },
    [
      canReadAll,
      canViewProfit,
      filters,
      finishInitialLoad,
      page,
      sort,
      queryClient,
      size,
      supabase,
      userId,
      isMobileRoute,
    ],
  );
  const initialLoad = useRef(false);
  useEffect(() => {
    function readUrlState() {
      const params = new URLSearchParams(window.location.search);
      const parsedSize = Number(params.get("size"));
      const defaults = defaultOrderFilters();
      const requestedStatuses = params.getAll("status");
      const statuses = requestedStatuses.includes("all")
        ? []
        : requestedStatuses.filter(
            (status): status is OrderStatus =>
              status === "completed" || status === "cancelled",
          );
      const urlFilters: OrderFilters = {
        invoice: params.get("invoice") || "",
        customer: params.get("customer") || "",
        productSkus: [...new Set(params.getAll("sku"))].sort(),
        productId: PRODUCT_ID_PATTERN.test(params.get("productId") || "")
          ? params.get("productId") || ""
          : "",
        productName: params.get("productName") || "",
        statuses: requestedStatuses.length ? statuses : defaults.statuses,
        from: params.get("from") || defaults.from,
        to: params.get("to") || defaults.to,
        fromTime: readTimeParam(params, "fromTime"),
        toTime: readTimeParam(params, "toTime"),
      };
      const requestedMetricColumn = params.get("metricColumn");
      setFocusedMetricColumn(
        !isMobileRoute &&
          (requestedMetricColumn === "subtotal" ||
            requestedMetricColumn === "discount" ||
            (requestedMetricColumn === "profit" && canViewProfit))
          ? requestedMetricColumn
          : null,
      );
      const sortableFields = [
        "order_no",
        "created_at",
        "customer",
        "status",
        "price_list",
        "discount",
        "total",
        ...(canViewProfit ? ["profit"] : []),
      ];
      const requestedSort = params.get("sort");
      const nextSort =
        requestedSort && sortableFields.includes(requestedSort)
          ? {
              key: requestedSort,
              direction:
                params.get("dir") === "asc"
                  ? ("asc" as const)
                  : ("desc" as const),
            }
          : sort;
      if (sort.key !== nextSort.key || sort.direction !== nextSort.direction)
        setSort(nextSort);
      void load(
        Math.max(1, Number(params.get("page")) || 1),
        [20, 50, 100].includes(parsedSize) ? parsedSize : 20,
        urlFilters,
        nextSort,
      );
    }
    if (!initialLoad.current) {
      const timer = window.setTimeout(() => {
        initialLoad.current = true;
        readUrlState();
      }, 0);
      window.addEventListener("popstate", readUrlState);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("popstate", readUrlState);
      };
    }
    window.addEventListener("popstate", readUrlState);
    return () => window.removeEventListener("popstate", readUrlState);
  }, [canViewProfit, isMobileRoute, load, setSort, sort]);
  useEffect(() => {
    if (!filtersOpen) return;
    let active = true;
    void readPosSearchProducts(supabase)
      .then((products) => {
        if (!active || !products) return;
        setCachedProducts(
          products
            .filter((product) => product.is_active)
            .map(({ sku, name }) => ({ sku, name })),
        );
      })
      .catch(() => {
        // The local cache is an optional instant-search layer.
      });
    const term = safeFilterText(debouncedProductSearch);
    queryClient
      .fetchQuery({
        queryKey: ["order-product-filter-options", userId, term],
        staleTime: 30_000,
        queryFn: async () => {
          const result = await supabase.rpc("search_order_products", {
            p_query: term,
          });
          if (result.error) throw result.error;
          return result.data || [];
        },
      })
      .then((result) => {
        if (!active) return;
        const unique = new Map<string, ProductFilterOption>();
        for (const row of result as ProductFilterOption[])
          if (!unique.has(row.sku)) unique.set(row.sku, row);
        setProductOptions([...unique.values()]);
        setLoadedProductSearch(term);
      })
      .catch(() => {
        if (active) {
          setProductOptions([]);
          setLoadedProductSearch(term);
        }
      });
    return () => {
      active = false;
    };
  }, [debouncedProductSearch, filtersOpen, queryClient, supabase, userId]);
  useEffect(() => {
    if (!editing || !canReadProducts) {
      setEditProductSearch("");
      return;
    }
    let active = true;
    setEditProductCatalogReady(false);
    void (async () => {
      const cached = await readPosSearchProducts(supabase).catch(() => null);
      if (!active) return;
      if (cached?.length) {
        setEditProductCatalog(cached.filter((product) => product.is_active));
        setEditProductCatalogReady(true);
        return;
      }
      const products = await queryClient.fetchQuery({
        queryKey: ["pos-products"],
        staleTime: 30_000,
        queryFn: async () => {
          const all: Product[] = [];
          for (let offset = 0; ; offset += 500) {
            const result = await supabase
              .from("products")
              .select(
                "id,sku,name,unit,stock,kind,is_active,product_prices(price,price_list_id)",
              )
              .eq("is_active", true)
              .order("name")
              .range(offset, offset + 499);
            if (result.error) throw result.error;
            const batch = (result.data ?? []) as unknown as Product[];
            all.push(...batch);
            if (batch.length < 500)
              return attachProductBundleItems(supabase, all);
          }
        },
      });
      if (!active) return;
      setEditProductCatalog(products as Product[]);
      setEditProductCatalogReady(true);
    })().catch(() => {
      if (!active) return;
      setEditProductCatalog([]);
      setEditProductCatalogReady(true);
    });
    return () => {
      active = false;
    };
  }, [canReadProducts, editing, queryClient, supabase]);
  useEffect(() => {
    if (!filtersOpen) return;
    function closeFilter(event: PointerEvent) {
      if (filterRootRef.current?.contains(event.target as Node)) return;
      if (
        event.target instanceof Element &&
        (event.target.closest(".daterangepicker") ||
          event.target.closest("[data-customer-picker-menu]") ||
          event.target.closest(".app-select-menu"))
      )
        return;
      setFiltersOpen(false);
      setProductPickerOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFiltersOpen(false);
        setProductPickerOpen(false);
      }
    }
    window.addEventListener("pointerdown", closeFilter);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeFilter);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [filtersOpen]);
  useDialogBehavior(isMobileRoute && filtersOpen, filterPanelRef, () => {
    setFiltersOpen(false);
    setProductPickerOpen(false);
  });
  const loadOrderDetail = useCallback(
    async (order: Order, requestId: number) => {
      setOriginalItems([]);
      try {
        const data = await fetchCachedQuery(
          queryClient,
          supabase,
          ["order-items", order.id],
          async () => {
            const result = await supabase
              .from("order_items")
              .select(
                "id,display_order,product_id,sku,product_name,unit,quantity,unit_price,line_total",
              )
              .eq("order_id", order.id)
              .order("display_order", { ascending: true })
              .order("id", { ascending: true });
            if (result.error) throw result.error;
            const lines = sortOrderItemsForDisplay(
              (result.data ?? []) as Omit<Line, "components">[],
            );
            if (!lines.length) return [];
            const componentResult = await supabase
              .from("order_item_components")
              .select(
                "order_item_id,product_id,sku,product_name,unit,quantity_per_bundle",
              )
              .in(
                "order_item_id",
                lines.map((line) => line.id),
              );
            if (componentResult.error) throw componentResult.error;
            const componentsByOrderItem = new Map<
              string,
              NonNullable<Line["components"]>
            >();
            for (const component of componentResult.data ?? []) {
              const existing =
                componentsByOrderItem.get(component.order_item_id) ?? [];
              existing.push({
                product_id: component.product_id,
                sku: component.sku,
                product_name: component.product_name,
                unit: component.unit,
                quantity_per_bundle: Number(component.quantity_per_bundle),
              });
              componentsByOrderItem.set(component.order_item_id, existing);
            }
            return lines.map((line) => ({
              ...line,
              components: componentsByOrderItem.get(line.id) ?? [],
            }));
          },
        );
        if (detailRequestIdRef.current !== requestId) return;
        const lines = (data || []) as Line[];
        setOriginalItems(lines);
        orderEditForm.reset({
          customerName: order.customer_name,
          customerPhone: order.customer_phone || "",
          customerAddress: order.customer_address || "",
          discount: String(order.discount),
          priceListId: order.price_list_id || "",
          items: lines,
        });
        setSelected(order);
      } catch (caught) {
        if (detailRequestIdRef.current === requestId)
          setError(
            caught instanceof Error
              ? caught.message
              : "Không tải được chi tiết đơn hàng.",
          );
      }
    },
    [queryClient, supabase, orderEditForm],
  );

  const open = useCallback(
    (order: Order) => {
      if (detailOrderId === order.id) return;
      setSelected(null);
      setEditing(false);
      if (detailOrderId) detailModal.replace(order.id);
      else detailModal.open(order.id);
    },
    [detailModal, detailOrderId],
  );

  useEffect(() => {
    const legacyOrderId = new URLSearchParams(window.location.search).get(
      "orderId",
    );
    if (legacyOrderId)
      detailModal.replace(detailOrderId || legacyOrderId, ["orderId"]);
  }, [detailModal, detailOrderId]);

  useEffect(() => {
    if (!detailOrderId) {
      if (loadedDetailOrderIdRef.current) {
        loadedDetailOrderIdRef.current = null;
        detailRequestIdRef.current += 1;
        setSelected(null);
        setEditing(false);
        setDetailLoading(false);
      }
      return;
    }
    if (loadedDetailOrderIdRef.current === detailOrderId) return;
    loadedDetailOrderIdRef.current = detailOrderId;
    const requestId = ++detailRequestIdRef.current;
    setSelected(null);
    setDetailLoading(true);
    setError("");
    void (async () => {
      try {
        const profitJoin = canViewProfit
          ? ",order_profit_snapshots(profit)"
          : "";
        const order = await queryClient.fetchQuery({
          queryKey: ["order-detail", userId, detailOrderId, canViewProfit],
          staleTime: 30_000,
          queryFn: async () => {
            const result = await supabase
              .from("orders")
              .select(
                "id,order_no,customer_name,customer_phone,customer_address,note,price_list_id,price_list_name,subtotal,discount,total,created_at,cashier_id,status" +
                  profitJoin,
              )
              .eq("id", detailOrderId)
              .maybeSingle();
            if (result.error) throw result.error;
            return result.data as Order | null;
          },
        });
        if (detailRequestIdRef.current !== requestId) return;
        if (!order) {
          setError("Không tìm thấy đơn hàng hoặc bạn không có quyền xem.");
          return;
        }
        await loadOrderDetail(
          {
            ...order,
            profit: order.order_profit_snapshots?.profit ?? null,
          },
          requestId,
        );
      } catch (caught) {
        if (detailRequestIdRef.current === requestId)
          setError(
            caught instanceof Error
              ? caught.message
              : "Không tải được chi tiết đơn hàng.",
          );
      } finally {
        if (detailRequestIdRef.current === requestId) setDetailLoading(false);
      }
    })();
  }, [
    canViewProfit,
    detailOrderId,
    loadOrderDetail,
    queryClient,
    supabase,
    userId,
  ]);

  function openOrderProduct(item: Line) {
    if (!item.product_id) return;
    window.open(
      productDetailsHrefForRoute(isMobileRoute, item.sku, item.product_id),
      "_blank",
      "noopener,noreferrer",
    );
  }

  function renderOrderProductLink(
    name: string,
    sku: string,
    productId: string | null | undefined,
  ) {
    if (!productId) return name;
    return (
      <a
        href={productDetailsHrefForRoute(isMobileRoute, sku, productId)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Mở hàng hóa ${name} trong tab mới`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {name}
      </a>
    );
  }

  function closeOrderDetail() {
    setSelected(null);
    setEditing(false);
    detailModal.close();
  }

  function addProductToOrderEdit(product: Product) {
    if (!selected) return;
    if (!canReadProducts) {
      setError("Cần quyền xem hàng hóa để thêm sản phẩm vào đơn.");
      return;
    }
    if (!hasSellableBundleItems(product)) {
      setError(`Combo "${product.name}" chưa có hàng hóa thành phần khả dụng.`);
      return;
    }
    const priceListId = orderEditForm.getValues("priceListId");
    const price = product.product_prices?.find(
      (item) => item.price_list_id === priceListId,
    )?.price;
    if (
      priceListId &&
      priceListId !== selected.price_list_id &&
      price === undefined
    ) {
      setError(`Bảng giá chưa có giá cho hàng hóa "${product.name}".`);
      return;
    }
    const unitPrice = price ?? 0;

    const currentItems = orderEditForm.getValues("items");
    const existing = currentItems.find(
      (item) => item.product_id === product.id,
    );
    if (existing) {
      orderEditForm.setValue(
        "items",
        currentItems.map((item) =>
          item.product_id === product.id
            ? {
                ...item,
                quantity:
                  Math.round((Number(item.quantity) + 1) / DECIMAL_INPUT_STEP) *
                  DECIMAL_INPUT_STEP,
              }
            : item,
        ),
        { shouldDirty: true, shouldValidate: true },
      );
    } else {
      const quantity = 1;
      const components = (product.bundle_items ?? []).map((component) => ({
        product_id: component.product_id,
        sku: component.sku,
        product_name: component.name,
        unit: component.unit,
        quantity_per_bundle: component.quantity_per_bundle,
      }));
      orderEditForm.setValue(
        "items",
        [
          ...currentItems,
          {
            id: `new:${product.id}`,
            is_new: true,
            display_order: currentItems.length,
            product_id: product.id,
            sku: product.sku,
            product_name: product.name,
            unit: product.unit,
            quantity,
            unit_price: Number(unitPrice),
            line_total: Math.round(Number(unitPrice) * quantity),
            components,
          },
        ],
        { shouldDirty: true, shouldValidate: true },
      );
    }
    setEditProductSearch("");
    setActiveEditProductIndex(0);
    setError("");
  }

  function removeProductFromOrderEdit(itemId: string) {
    const currentItems = orderEditForm.getValues("items");
    if (currentItems.length <= 1) {
      setError("Đơn hàng cần có ít nhất một sản phẩm.");
      return;
    }
    orderEditForm.setValue(
      "items",
      currentItems.filter((item) => item.id !== itemId),
      { shouldDirty: true, shouldValidate: true },
    );
    setError("");
  }

  async function changeOrderEditPriceList(priceListId: string) {
    if (!selected || !priceListId || priceListId === editPriceListId) return;
    const currentItems = orderEditForm.getValues("items");
    const productIds = [
      ...new Set(
        currentItems
          .map((item) => item.product_id)
          .filter((productId): productId is string => Boolean(productId)),
      ),
    ];
    const priceResult = productIds.length
      ? await supabase
          .from("product_prices")
          .select("product_id,price")
          .eq("price_list_id", priceListId)
          .in("product_id", productIds)
      : { data: [], error: null };
    if (priceResult.error) {
      setError("Không tải được giá của bảng giá đã chọn. Vui lòng thử lại.");
      return;
    }
    const priceRows = (priceResult.data ?? []) as {
      product_id: string;
      price: number | string;
    }[];
    const prices = new Map<string, number>(
      priceRows.map((price) => [
        price.product_id,
        Number(price.price),
      ]),
    );
    orderEditForm.setValue("priceListId", priceListId, {
      shouldDirty: true,
      shouldValidate: true,
    });
    orderEditForm.setValue(
      "items",
      currentItems.map((item) => {
        const price = item.product_id
          ? prices.get(item.product_id)
          : undefined;
        return price === undefined
          ? item
          : {
              ...item,
              unit_price: price,
              line_total: Math.round(price * Number(item.quantity)),
            };
      }),
      { shouldDirty: true, shouldValidate: true },
    );
    const missingProducts = currentItems.filter(
      (item) => !item.product_id || !prices.has(item.product_id),
    );
    setError(
      missingProducts.length
        ? `Bảng giá chưa có giá cho: ${missingProducts
            .map((item) => item.product_name)
            .join(", ")}.`
        : "",
    );
  }

  async function saveOrderEdit(values: OrderEditValues) {
    if (!selected || savingEdit || !editing) return;
    const savedItems = values.items.filter((item) => Number(item.quantity) > 0);
    if (!savedItems.length) {
      setError("Đơn hàng cần có ít nhất một sản phẩm.");
      return;
    }
    setSavingEdit(true);
    setError("");
    const { data, error: editError } = await supabase.rpc("edit_order", {
      p_order_id: selected.id,
      p_lines: savedItems.map((item) => ({
        ...(item.is_new ? { product_id: item.product_id } : { id: item.id }),
        quantity: item.quantity,
        unit_price: normalizeOrderUnitPrice(item.unit_price),
      })),
      p_discount: Number(values.discount),
      p_customer_name: values.customerName,
      p_customer_phone: values.customerPhone,
      p_customer_address: values.customerAddress,
      p_price_list_id: values.priceListId || null,
    });
    if (editError) {
      setSavingEdit(false);
      setError(editError.message);
      return;
    }
    const result = data as {
      subtotal: number;
      discount: number;
      total: number;
      price_list_id: string | null;
      price_list_name: string;
    };
    const profitResult = canViewProfit
      ? await supabase
          .from("order_profit_snapshots")
          .select("profit")
          .eq("order_id", selected.id)
          .maybeSingle()
      : { data: null, error: null };
    await queryClient.invalidateQueries({
      queryKey: ["order-items", selected.id],
    });
    const updated = {
      ...selected,
      customer_name: values.customerName.trim(),
      customer_phone: values.customerPhone,
      customer_address: values.customerAddress,
      price_list_id: result.price_list_id,
      price_list_name: result.price_list_name,
      subtotal: Number(result.subtotal),
      discount: Number(result.discount),
      total: Number(result.total),
      profit: profitResult.data?.profit ?? selected.profit,
    };
    setSelected(updated);
    setRows((current) =>
      current.map((order) => (order.id === updated.id ? updated : order)),
    );
    await loadOrderDetail(updated, ++detailRequestIdRef.current);
    setEditing(false);
    setSavingEdit(false);
    toast.success("Đã cập nhật đơn hàng và tồn kho.");
    await queryClient.invalidateQueries({ queryKey: ["orders"] });
    await queryClient.invalidateQueries({
      queryKey: ["orders-summary-filtered"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["order-product-filter-options"],
    });
    void load(page, size, filters);
    if (autoPrintSettingReady && autoPrint) {
      window.setTimeout(printPage, 300);
    }
  }
  async function cancelOrder() {
    if (
      !selected ||
      !canCancel ||
      selected.status !== "completed" ||
      cancelling
    )
      return;
    const target = selected;
    confirmAction.current = async () => {
      setCancelling(true);
      setError("");
      const { error: cancelError } = await supabase.rpc("cancel_order", {
        p_order_id: target.id,
      });
      setCancelling(false);
      if (cancelError) {
        setError(cancelError.message);
        toast.error("Không hủy được đơn hàng.");
        return;
      }
      setSelected({ ...target, status: "cancelled" });
      setRows((current) =>
        current.map((order) =>
          order.id === target.id ? { ...order, status: "cancelled" } : order,
        ),
      );
      closeOrderDetail();
      toast.success("Đã hủy " + target.order_no + " và cộng lại tồn kho.");
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
      await queryClient.invalidateQueries({
        queryKey: ["orders-summary-filtered"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["order-product-filter-options"],
      });
      await load(page, size, filters);
    };
    setConfirmRequest({
      title: "Hủy đơn hàng?",
      message: `Hủy ${target.order_no}? Đơn vẫn được lưu trong hệ thống, không thể mở lại và tồn kho sẽ được cộng lại theo số lượng đã bán.`,
      confirmLabel: "Hủy đơn hàng",
    });
  }
  function change(next: Partial<{ page: number; size: number }>) {
    void load(next.page ?? page, next.size ?? size, filters);
  }
  function toggleFilters() {
    if (filtersOpen) {
      setProductPickerOpen(false);
      setFiltersOpen(false);
      return;
    }
    setFiltersOpen(true);
  }
  function applyFilters() {
    setFiltersOpen(false);
    setProductPickerOpen(false);
    void load(1, size, draftFilters);
  }
  function clearFilters() {
    const defaults = defaultOrderFilters();
    setDraftFilters(defaults);
    setDraftContact({ name: "", phone: "", address: "" });
    setProductSearch("");
    setProductPickerOpen(false);
    void load(1, size, defaults);
  }
  function toggleProduct(sku: string) {
    setDraftFilters((current) => ({
      ...current,
      productSkus: current.productSkus.includes(sku)
        ? current.productSkus.filter((value) => value !== sku)
        : [...current.productSkus, sku],
    }));
  }
  function toggleStatus(status: OrderStatus) {
    setDraftFilters((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((value) => value !== status)
        : [...current.statuses, status],
    }));
  }
  function changeDraftDates(from: string, to: string) {
    const nextFilters = { ...draftFilters, from, to };
    if (!isValidOrderTimeRange(nextFilters)) {
      toast.error("Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.");
      return;
    }
    setDraftFilters(nextFilters);
    void load(1, size, nextFilters);
  }
  function changeDraftTime(key: "fromTime" | "toTime", value: string) {
    const nextFilters = { ...draftFilters, [key]: value };
    if (!isValidOrderTimeRange(nextFilters)) {
      toast.error("Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.");
      return;
    }
    setDraftFilters(nextFilters);
    void load(1, size, nextFilters);
  }
  useEffect(() => {
    if (!selected || editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const index = rows.findIndex((row) => row.id === selected.id);
      const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        void open(next);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, rows, editing, open]);

  const tableColumns: DataColumn<Order>[] = [
    {
      key: "order_no",
      label: "Mã đơn",
      value: (order) => order.order_no,
      summary: `Tổng ${total} đơn`,
      render: (order) => <strong>{order.order_no}</strong>,
    },
    {
      key: "created_at",
      label: "Thời gian",
      headerClassName: "orders-table-time",
      cellClassName: "orders-table-time",
      value: (order) => order.created_at,
      render: (order) => formatDateTime(order.created_at),
    },
    {
      key: "customer",
      label: "Khách hàng",
      value: (order) => order.customer_name,
      render: (order) => order.customer_name,
    },
    {
      key: "status",
      label: "Trạng thái",
      align: "center",
      cellClassName: "orders-table-status",
      value: (order) => order.status,
      render: (order) => {
        const cancelled = order.status === "cancelled";
        return (
          <AppBadge
            tone={cancelled ? "danger" : "success"}
            className="order-status-badge"
          >
            {cancelled ? "Đã hủy" : "Hoàn thành"}
          </AppBadge>
        );
      },
    },
    {
      key: "price_list",
      label: "Bảng giá",
      value: (order) => order.price_list_name,
      render: (order) => order.price_list_name,
    },
    {
      key: "subtotal",
      label: "Tổng tiền hàng",
      sortable: false,
      align: "right",
      value: (order) => Number(order.subtotal),
      summary: formatVnd(summary.subtotal),
      render: (order) => formatVnd(order.subtotal),
    },
    {
      key: "discount",
      label: "Giảm giá",
      value: (order) => Number(order.discount),
      summary: formatVnd(summary.discount),
      render: (order) => formatVnd(order.discount),
    },
    {
      key: "total",
      label: "Tổng tiền",
      value: (order) => Number(order.total),
      summary: formatVnd(summary.total),
      render: (order) => <strong>{formatVnd(order.total)}</strong>,
    },
    ...(canViewProfit
      ? [
          {
            key: "profit",
            label: "Tiền lời",
            headerClassName: "orders-table-profit",
            cellClassName: "orders-table-profit",
            value: (order: Order) => Number(order.profit),
            summary: formatVnd(summary.profit),
            render: (order: Order) => formatVnd(Number(order.profit ?? 0)),
          },
        ]
      : []),
  ];
  const metricColumnKeys: OrderMetricColumn[] = [
    "subtotal",
    "discount",
    "profit",
  ];
  const displayTableColumns = focusedMetricColumn
    ? tableColumns.filter(
        (column) =>
          !metricColumnKeys.includes(column.key as OrderMetricColumn) ||
          column.key === focusedMetricColumn,
      )
    : tableColumns;

  const detailExportGroups: {
    key: string;
    label: string;
    fields: OrderExportField[];
  }[] = [
    {
      key: "order",
      label: "Đơn hàng",
      fields: [
        { key: "order_no", label: "Mã đơn", read: (order) => order.order_no },
        {
          key: "created_at",
          label: "Thời gian",
          read: (order) => formatDateTime(order.created_at),
        },
        {
          key: "customer_name",
          label: "Khách hàng",
          read: (order) => order.customer_name,
        },
        {
          key: "customer_phone",
          label: "Số điện thoại",
          read: (order) => order.customer_phone,
        },
        {
          key: "customer_address",
          label: "Địa chỉ",
          read: (order) => order.customer_address,
        },
        {
          key: "price_list_name",
          label: "Bảng giá",
          read: (order) => order.price_list_name,
        },
        {
          key: "status",
          label: "Trạng thái",
          read: (order) =>
            order.status === "cancelled" ? "Đã hủy" : "Hoàn thành",
        },
        {
          key: "subtotal",
          label: "Tổng tiền hàng",
          read: (order) => Number(order.subtotal),
        },
        {
          key: "discount",
          label: "Giảm giá",
          read: (order) => Number(order.discount),
        },
        {
          key: "total",
          label: "Khách cần trả",
          read: (order) => Number(order.total),
        },
        ...(canViewProfit
          ? [
              {
                key: "profit",
                label: "Tiền lời",
                read: (order: Order) => Number(order.profit ?? 0),
              },
            ]
          : []),
      ],
    },
    {
      key: "products",
      label: "Sản phẩm",
      fields: [
        { key: "sku", label: "Mã hàng", read: (_order, item) => item?.sku },
        {
          key: "product_name",
          label: "Tên hàng",
          read: (_order, item) => item?.product_name,
        },
        {
          key: "unit",
          label: "Đơn vị",
          read: (_order, item) => item?.unit,
        },
        {
          key: "quantity",
          label: "Số lượng",
          read: (_order, item) => Number(item?.quantity ?? 0),
        },
        {
          key: "unit_price",
          label: "Đơn giá",
          read: (_order, item) => Number(item?.unit_price ?? 0),
        },
        {
          key: "line_total",
          label: "Thành tiền",
          read: (_order, item) => Number(item?.line_total ?? 0),
        },
      ],
    },
  ];

  const loadAllFilteredOrderIds = useStableCallback(async () => {
    const effectiveSort =
      !canViewProfit && sort.key === "profit"
        ? { key: "created_at", direction: "desc" as const }
        : sort;
    const invoice = safeFilterText(filters.invoice);
    const customer = safeFilterText(filters.customer);
    const ids: string[] = [];
    const pageLimit = 100;
    let totalRows = 0;
    do {
      const result = await supabase.rpc("orders_page_filtered", {
        p_invoice_query: invoice,
        p_customer_query: customer,
        p_product_skus: [...filters.productSkus].sort(),
        p_product_id: filters.productId || null,
        p_statuses: filters.statuses,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_from_time: filters.fromTime || null,
        p_to_time: filters.toTime || null,
        p_sort: effectiveSort.key,
        p_direction: effectiveSort.direction,
        p_offset: ids.length,
        p_limit: pageLimit,
      });
      if (result.error) throw result.error;
      const pageResult = result.data as {
        ids?: string[];
        total?: number;
      } | null;
      const nextIds = pageResult?.ids ?? [];
      totalRows = Number(pageResult?.total ?? 0);
      if (!nextIds.length) break;
      ids.push(...nextIds);
    } while (ids.length < totalRows);
    return ids;
  });

  const loadOrdersByIds = useStableCallback(async (ids: string[]) => {
    const exportedOrders: Order[] = [];
    const columns =
      "id,order_no,customer_name,customer_phone,customer_address,price_list_name,subtotal,discount,total,created_at,cashier_id,status" +
      (canViewProfit ? ",order_profit_snapshots(profit)" : "");
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const result = await supabase
        .from("orders")
        .select(columns)
        .in("id", batch);
      if (result.error) throw result.error;
      const byId = new Map<string, Order>(
        ((result.data || []) as Order[]).map(
          (order) =>
            [
              order.id,
              {
                ...order,
                profit: order.order_profit_snapshots?.profit ?? null,
              } satisfies Order,
            ] as const,
        ),
      );
      exportedOrders.push(
        ...batch
          .map((id) => byId.get(id))
          .filter((order): order is Order => order !== undefined),
      );
    }
    return exportedOrders;
  });

  const exportDateSuffix = `${filters.from || "tat-ca"}-${filters.to || "tat-ca"}`;

  const exportOverview = useStableCallback(async () => {
    const visibleKeys = visibleTableColumnKeys.filter(
      (key) => key !== "actions",
    );
    const columnsByKey = new Map(
      tableColumns.map((column) => [column.key, column] as const),
    );
    const visibleColumns = visibleKeys.flatMap((key) => {
      const column = columnsByKey.get(key);
      return column ? [column] : [];
    });
    if (!visibleColumns.length) {
      toast.error("Hãy chọn ít nhất một cột để xuất.");
      return;
    }
    setExportBusy(true);
    try {
      const ids = await loadAllFilteredOrderIds();
      const orders = await loadOrdersByIds(ids);
      const csv = createCsv(
        visibleColumns.map((column) => ({
          key: column.key,
          label: column.label,
          read: (order: Order) => {
            if (column.key === "created_at")
              return formatDateTime(order.created_at);
            if (column.key === "status")
              return order.status === "cancelled" ? "Đã hủy" : "Hoàn thành";
            return column.value?.(order) ?? "";
          },
        })),
        orders,
      );
      downloadOrdersCsv(`don-hang-tong-quan-${exportDateSuffix}.csv`, csv);
      toast.success(`Đã xuất ${orders.length} đơn hàng.`);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Không xuất được đơn hàng.",
      );
    } finally {
      setExportBusy(false);
    }
  });

  const exportDetails = useStableCallback(
    async (selectedFieldKeys: string[]) => {
      const columns = detailExportGroups
        .flatMap((group) => group.fields)
        .filter((field) => selectedFieldKeys.includes(field.key));
      if (!columns.length || exportBusy) return;
      setExportBusy(true);
      setExportError("");
      try {
        const ids = await loadAllFilteredOrderIds();
        const orders = await loadOrdersByIds(ids);
        const linesByOrder = new Map<string, OrderExportLine[]>();
        for (let offset = 0; offset < ids.length; offset += 100) {
          const batch = ids.slice(offset, offset + 100);
          let itemOffset = 0;
          while (true) {
            const result = await supabase
              .from("order_items")
              .select(
                "id,order_id,display_order,sku,product_name,unit,quantity,unit_price,line_total",
              )
              .in("order_id", batch)
              .order("order_id")
              .order("display_order")
              .order("id")
              .range(itemOffset, itemOffset + 499);
            if (result.error) throw result.error;
            const items = (result.data || []) as OrderExportLine[];
            if (!items.length) break;
            for (const item of items) {
              const lines = linesByOrder.get(item.order_id) ?? [];
              lines.push(item);
              linesByOrder.set(item.order_id, lines);
            }
            itemOffset += items.length;
          }
        }
        const exportRows: OrderExportRow[] = [];
        for (const order of orders) {
          const itemsForOrder = linesByOrder.get(order.id) ?? [];
          if (itemsForOrder.length) {
            for (const item of itemsForOrder) exportRows.push({ order, item });
          } else exportRows.push({ order, item: null });
        }
        const csv = createCsv(
          columns.map((column) => ({
            key: column.key,
            label: column.label,
            read: (row: OrderExportRow) => column.read(row.order, row.item),
          })),
          exportRows,
        );
        downloadOrdersCsv(`don-hang-chi-tiet-${exportDateSuffix}.csv`, csv);
        setDetailExportOpen(false);
        toast.success(
          `Đã xuất ${exportRows.length} dòng từ ${orders.length} đơn hàng.`,
        );
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Không xuất được đơn hàng.";
        setExportError(message);
        toast.error(message);
      } finally {
        setExportBusy(false);
      }
    },
  );

  const handleExportOverview = useStableCallback(() => {
    void exportOverview();
  });
  const handleOpenDetailExport = useStableCallback(() => {
    setExportError("");
    setDetailExportOpen(true);
  });
  const handleCloseDetailExport = useStableCallback(() =>
    setDetailExportOpen(false),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Đơn hàng</h1>
          <p>
            Tra cứu hóa đơn theo thời gian, trạng thái, sản phẩm và khách hàng.
          </p>
        </div>
        <DataExportMenu
          disabled={loading || visibleTableColumnKeys.length === 0}
          busy={exportBusy}
          onOverview={handleExportOverview}
          onDetails={handleOpenDetailExport}
        />
      </div>
      <div className="orders-workspace">
        <aside
          ref={filterRootRef}
          className="product-filters card orders-filter"
        >
          <div className="orders-filter-date">
            <span>Khoảng thời gian</span>
            <DateRangeInput
              start={draftFilters.from}
              end={draftFilters.to}
              ariaLabel="Lọc đơn hàng theo ngày"
              onChange={changeDraftDates}
            />
            <div className="orders-filter-time">
              <label>
                <span>Từ giờ</span>
                <AppInput
                  type="time"
                  step={60}
                  aria-label="Lọc từ giờ"
                  value={draftFilters.fromTime}
                  onChange={(event) =>
                    changeDraftTime("fromTime", event.target.value)
                  }
                />
              </label>
              <label>
                <span>Đến giờ</span>
                <AppInput
                  type="time"
                  step={60}
                  aria-label="Lọc đến giờ"
                  value={draftFilters.toTime}
                  onChange={(event) =>
                    changeDraftTime("toTime", event.target.value)
                  }
                />
              </label>
            </div>
          </div>
          <AppButton
            variant="default"
            type="button"
            className="orders-filter-trigger"
            aria-expanded={filtersOpen}
            aria-controls="orders-filter-panel"
            onClick={toggleFilters}
          >
            <span>
              {filters.invoice ||
              filters.customer ||
              filters.productSkus.length ||
              filters.productId ||
              filters.statuses.length !== 1 ||
              filters.statuses[0] !== "completed" ? (
                <span>
                  {[
                    filters.invoice && `Mã hóa đơn: ${filters.invoice}`,
                    filters.productId &&
                      `Hàng hóa: ${filters.productName || filters.productId}`,
                    filters.productSkus.length > 0 &&
                      `${filters.productSkus.length} sản phẩm`,
                    filters.customer && `Khách hàng: ${filters.customer}`,
                    filters.statuses.length === 0
                      ? "Mọi trạng thái"
                      : filters.statuses.length !== 1 ||
                          filters.statuses[0] !== "completed"
                        ? filters.statuses
                            .map((status) =>
                              status === "completed" ? "Hoàn thành" : "Đã hủy",
                            )
                            .join(", ")
                        : "Hoàn thành",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : (
                <span>Lọc đơn hàng</span>
              )}
            </span>
            <SlidersHorizontal size={18} aria-hidden="true" />
          </AppButton>
          {filtersOpen && (
            <>
              {isMobileRoute && (
                <div
                  className="mobile-filter-scrim"
                  aria-hidden="true"
                  onMouseDown={() => {
                    setFiltersOpen(false);
                    setProductPickerOpen(false);
                  }}
                />
              )}
              <div
                ref={filterPanelRef}
                id="orders-filter-panel"
                className="orders-filter-panel"
                role={isMobileRoute ? "dialog" : undefined}
                aria-modal={isMobileRoute ? true : undefined}
                aria-label="Lọc đơn hàng"
                data-mobile-filter-sheet={isMobileRoute ? "" : undefined}
                tabIndex={-1}
              >
                <div className="mobile-filter-panel-heading">
                  <strong>Lọc đơn hàng</strong>
                  <AppButton
                    variant="ghost"
                    type="button"
                    className="mobile-dialog-close"
                    aria-label="Đóng bộ lọc"
                    onClick={() => {
                      setFiltersOpen(false);
                      setProductPickerOpen(false);
                    }}
                  >
                    <X size={18} />
                  </AppButton>
                </div>
                <div className="orders-filter-grid">
                  <label className="form-label">
                    Theo mã hóa đơn
                    <AppInput
                      className="field"
                      placeholder="Theo mã hóa đơn"
                      value={draftFilters.invoice}
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          invoice: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div
                    className="form-label orders-product-filter"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        setProductPickerOpen(false);
                    }}
                  >
                    Theo mã, tên hàng
                    <AppInput
                      className="field"
                      role="combobox"
                      aria-label="Tìm sản phẩm theo mã hoặc tên"
                      aria-autocomplete="list"
                      aria-expanded={productPickerOpen}
                      aria-controls="orders-product-options"
                      placeholder="Tìm mã hoặc tên sản phẩm"
                      value={productSearch}
                      onFocus={() => setProductPickerOpen(true)}
                      onChange={(event) => {
                        setProductSearch(event.target.value);
                        setProductPickerOpen(true);
                      }}
                    />
                    {productPickerOpen && (
                      <div
                        id="orders-product-options"
                        className="orders-product-options"
                        role="listbox"
                        aria-label="Chọn sản phẩm"
                        aria-multiselectable="true"
                      >
                        {productOptionsLoading ? (
                          <span className="muted">Đang tải sản phẩm…</span>
                        ) : visibleProductOptions.length ? (
                          visibleProductOptions.map((product) => {
                            const checked = draftFilters.productSkus.includes(
                              product.sku,
                            );
                            return (
                              <AppButton
                                variant="ghost"
                                type="button"
                                role="option"
                                aria-selected={checked}
                                key={product.sku}
                                className={mergeClassNames(
                                  "orders-product-option",
                                  checked && "selected",
                                )}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => toggleProduct(product.sku)}
                              >
                                <span>
                                  <b>{product.sku}</b>
                                  <span>{product.product_name}</span>
                                </span>
                                {checked && (
                                  <Check size={16} aria-hidden="true" />
                                )}
                              </AppButton>
                            );
                          })
                        ) : (
                          <span className="muted">
                            Không tìm thấy sản phẩm trong các hóa đơn bạn có
                            quyền xem.
                          </span>
                        )}
                      </div>
                    )}
                    {(draftFilters.productId ||
                      draftFilters.productSkus.length > 0) && (
                      <div className="orders-product-chips">
                        {draftFilters.productId && (
                          <AppButton
                            variant="default"
                            type="button"
                            className="orders-product-chip"
                            title={`Bỏ ${draftFilters.productName || "hàng hóa"}`}
                            onClick={() =>
                              setDraftFilters((current) => ({
                                ...current,
                                productId: "",
                                productName: "",
                              }))
                            }
                          >
                            <span className="orders-product-chip-label">
                              {draftFilters.productName || "Hàng hóa đã chọn"}
                            </span>
                            <X size={13} aria-hidden="true" />
                          </AppButton>
                        )}
                        {draftFilters.productSkus.map((sku) => (
                          <AppButton
                            variant="default"
                            type="button"
                            className="orders-product-chip"
                            key={sku}
                            title={`Bỏ ${sku}`}
                            onClick={() => toggleProduct(sku)}
                          >
                            <span className="orders-product-chip-label">
                              {productOptions.find(
                                (product) => product.sku === sku,
                              )?.product_name ||
                                cachedProducts.find(
                                  (product) => product.sku === sku,
                                )?.name ||
                                sku}
                            </span>
                            <X size={13} aria-hidden="true" />
                          </AppButton>
                        ))}
                      </div>
                    )}
                  </div>
                  <CustomerPicker
                    searchOnly
                    searchLabel="Theo tên hoặc SĐT khách hàng"
                    showSearchIcon={false}
                    suggestionsEnabled={canSearchCustomers}
                    disabled={false}
                    value={draftContact}
                    onChange={(contact) => {
                      setDraftContact(contact);
                      setDraftFilters((current) => ({
                        ...current,
                        customer: contact.name,
                      }));
                    }}
                  />
                </div>
                <fieldset className="orders-filter-statuses">
                  <legend>Trạng thái đơn hàng</legend>
                  <label>
                    <AppInput
                      type="checkbox"
                      checked={draftFilters.statuses.includes("completed")}
                      onChange={() => toggleStatus("completed")}
                    />
                    Hoàn thành
                  </label>
                  <label>
                    <AppInput
                      type="checkbox"
                      checked={draftFilters.statuses.includes("cancelled")}
                      onChange={() => toggleStatus("cancelled")}
                    />
                    Đã hủy
                  </label>
                </fieldset>
                <div className="orders-filter-actions">
                  <AppButton
                    variant="ghost"
                    type="button"

                    onClick={clearFilters}
                  >
                    Xóa bộ lọc
                  </AppButton>
                  <AppButton
                    variant="primary"
                    type="button"

                    onClick={applyFilters}
                  >
                    Tìm kiếm
                  </AppButton>
                </div>
              </div>
            </>
          )}
        </aside>
        <div>
          {error && (
            <div className="alert" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}
          {loading ? (
            <LoadingSkeleton rows={7} />
          ) : (
            <section className="card table-wrap">
              {isMobileRoute && (
                <div className="mobile-record-list order-mobile-list">
                  <MobileTableToolbarMetrics
                    metrics={[
                      { label: "Tổng số đơn", value: summary.count },
                      {
                        label: "Tổng tiền hàng",
                        value: formatVnd(summary.subtotal),
                      },
                      {
                        label: "Khách phải trả",
                        value: formatVnd(summary.total),
                      },
                    ]}
                  />
                  <MobileSortControl
                    columns={tableColumns
                      .filter((column) => column.key !== "subtotal")
                      .map(({ key, label, sortable }) => ({
                        key,
                        label,
                        sortable,
                      }))}
                    sort={
                      !canViewProfit && sort.key === "profit"
                        ? { key: "created_at", direction: "desc" }
                        : sort
                    }
                    onChange={(nextSort) => {
                      setSort(nextSort);
                      void load(1, size, filters, nextSort);
                    }}
                  />
                  {rows.length ? (
                    rows.map((order) => (
                      <AppButton
                        variant="ghost"
                        className={mergeClassNames(
                          "mobile-record-card order-mobile-card mobile-unified-card mobile-unified-card--interactive",
                          detailModal.activeId === order.id &&
                            "mobile-unified-card--selected",
                          order.status === "cancelled" &&
                            "mobile-unified-card--cancelled",
                        )}
                        type="button"
                        key={order.id}
                        onClick={() => void open(order)}
                        aria-label={`Xem đơn ${order.order_no}, ${order.customer_name}, ${formatVnd(order.total)}`}
                      >
                        <span className="order-mobile-card-meta">
                          <strong>{order.order_no}</strong>
                          <time dateTime={order.created_at}>
                            {formatDateTime(order.created_at)}
                          </time>
                        </span>
                        <strong className="order-mobile-customer">
                          {order.customer_name || "Khách lẻ"}
                        </strong>
                        {order.status === "cancelled" && (
                          <span className="order-mobile-status">Đã hủy</span>
                        )}
                        {order.note?.trim() && (
                          <span className="order-mobile-note">
                            Ghi chú: {order.note}
                          </span>
                        )}
                        <span className="order-mobile-total">
                          <strong>{formatVnd(order.total)}</strong>
                          <small>Giảm {formatVnd(order.discount)}</small>
                        </span>
                      </AppButton>
                    ))
                  ) : (
                    <p className="muted mobile-record-empty">
                      Chưa có đơn hàng phù hợp.
                    </p>
                  )}
                </div>
              )}
              <div className="desktop-record-table">
                <DataTable
                  key={focusedMetricColumn ?? "all"}
                  storageKey={
                    focusedMetricColumn
                      ? `orders-focus-${focusedMetricColumn}`
                      : "orders"
                  }
                  initialVisible={
                    focusedMetricColumn
                      ? displayTableColumns.map((column) => column.key)
                      : displayTableColumns
                          .filter((column) => column.key !== "subtotal")
                          .map((column) => column.key)
                  }
                  persistVisibleColumns={!focusedMetricColumn}
                  onRowClick={(order) => void open(order)}
                  activeRowId={detailModal.activeId}
                  onVisibleColumnsChange={setVisibleTableColumnKeys}
                  serverSort={{
                    value:
                      !canViewProfit && sort.key === "profit"
                        ? { key: "created_at", direction: "desc" }
                        : sort,
                    onChange: (nextSort) => {
                      setSort(nextSort);
                      void load(1, size, filters, nextSort);
                    },
                  }}
                  rows={rows}
                  rowKey={(order) => order.id}
                  totalRows={total}
                  empty="Chưa có đơn hàng phù hợp."
                  toolbarSummary={
                    <>
                      <span>
                        Tổng số đơn: <b>{summary.count}</b>
                      </span>
                      <span> · </span>
                      <span>
                        Tổng tiền hàng: <b>{formatVnd(summary.subtotal)}</b>
                      </span>
                      <span> · </span>
                      <span>
                        Khách phải trả: <b>{formatVnd(summary.total)}</b>
                      </span>
                    </>
                  }
                  columns={displayTableColumns}
                />
              </div>
              <div className="pagination">
                <span>
                  Trang {page} · {total} đơn hàng
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ width: 120 }}>
                    <AppSelect
                      ariaLabel="Số đơn hàng trên trang"
                      value={size}
                      options={[20, 50, 100].map((value) => ({
                        value: String(value),
                        label: value + " / trang",
                      }))}
                      onChange={(value) => change({ size: Number(value) })}
                    />
                  </div>
                  <AppButton
                    variant="secondary"

                    style={{ minHeight: 32, padding: "0 8px" }}
                    disabled={page <= 1}
                    onClick={() => change({ page: page - 1 })}
                  >
                    <ChevronLeft size={15} />
                  </AppButton>
                  <AppButton
                    variant="secondary"

                    style={{ minHeight: 32, padding: "0 8px" }}
                    disabled={page * size >= total}
                    onClick={() => change({ page: page + 1 })}
                  >
                    <ChevronRight size={15} />
                  </AppButton>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
      <EntityDetailModal
        open={Boolean(detailOrderId && !selected)}
        onClose={closeOrderDetail}
      >
        {isMobileDetailRoute ? (
          <section
            className="modal card order-detail-page order-detail-loading"
            role="dialog"
            aria-modal="true"
            aria-label="Đang tải chi tiết đơn hàng"
          >
            {detailLoading || loading ? (
              <LoadingSkeleton rows={3} />
            ) : (
              <p className={error ? "alert" : "muted"}>
                {error ||
                  "Không tìm thấy đơn hàng hoặc bạn không có quyền xem."}
              </p>
            )}
          </section>
        ) : (
          <section
            className="modal card order-detail-modal order-detail-loading"
            role="dialog"
            aria-modal="true"
            aria-label="Đang tải chi tiết đơn hàng"
          >
            {detailLoading || loading ? (
              <LoadingSkeleton rows={3} />
            ) : (
              <p className={error ? "alert" : "muted"}>
                {error ||
                  "Không tìm thấy đơn hàng hoặc bạn không có quyền xem."}
              </p>
            )}
          </section>
        )}
      </EntityDetailModal>
      <EntityDetailModal open={Boolean(selected)} onClose={closeOrderDetail}>
        {selected && (
          <form
            className={mergeClassNames(
              "modal card",
              isMobileDetailRoute && "order-detail-page",
              detailOrderId && !isMobileDetailRoute && "order-detail-modal",
              editing && "order-detail-modal--editing",
            )}
            role="dialog"
            aria-modal="true"
            aria-label={`Chi tiết đơn hàng ${selected.order_no}`}
            onSubmit={orderEditForm.handleSubmit(saveOrderEdit)}
            onTouchStart={(event) => {
              (event.currentTarget as HTMLElement).dataset.touchY = String(
                event.touches[0].clientY,
              );
              (event.currentTarget as HTMLElement).dataset.touchX = String(
                event.touches[0].clientX,
              );
            }}
            onTouchEnd={(event) => {
              const element = event.currentTarget as HTMLElement;
              const deltaY =
                event.changedTouches[0].clientY -
                Number(element.dataset.touchY || 0);
              const deltaX =
                event.changedTouches[0].clientX -
                Number(element.dataset.touchX || 0);
              if (editing) return;
              const index = rows.findIndex((row) => row.id === selected.id);
              if (detailOrderId) {
                if (
                  Math.abs(deltaX) < 60 ||
                  Math.abs(deltaX) <= Math.abs(deltaY) * 1.2
                )
                  return;
                const next = rows[index + (deltaX < 0 ? 1 : -1)];
                if (!next) return;
                detailModal.replace(next.id);
                return;
              }
              if (Math.abs(deltaY) < 60) return;
              const next = rows[index + (deltaY < 0 ? 1 : -1)];
              if (next) void open(next);
            }}
          >
            <div className="modal-title">
              <div>
                <h2>
                  {isMobileDetailRoute
                    ? formatDateTime(selected.created_at)
                    : `Đơn hàng ${selected.order_no}`}
                </h2>
                <div className="muted" style={{ fontSize: 12, marginTop: 5 }}>
                  {isMobileDetailRoute
                    ? (selected.customer_name || "Khách lẻ").toLocaleUpperCase(
                        "vi-VN",
                      )
                    : `${formatDateTime(selected.created_at)} · ${selected.customer_name}`}
                  {selected.status === "cancelled" && (
                    <strong style={{ color: "#b42318", marginInlineStart: 8 }}>
                      · Đã hủy
                    </strong>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                {canEdit && selected.status === "completed" && !editing && (
                  <AppButton
                    variant="ghost"
                    type="button"

                    title="Sửa đơn hàng"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil size={16} />
                  </AppButton>
                )}
                <AppButton
                  variant="ghost"
                  type="button"
                  aria-label="Đóng chi tiết"
                  onClick={closeOrderDetail}
                >
                  <X size={18} />
                </AppButton>
              </div>
            </div>
            {editing ? (
              <div className="order-edit-fields">
                <label className="form-label">
                  Tên khách hàng
                  <AppInput
                    className="field"
                    {...orderEditForm.register("customerName")}
                  />
                </label>
                <label className="form-label">
                  Số điện thoại
                  <AppInput
                    className="field"
                    {...orderEditForm.register("customerPhone")}
                  />
                </label>
                <label className="form-label">
                  Địa chỉ
                  <AppInput
                    className="field"
                    {...orderEditForm.register("customerAddress")}
                  />
                </label>
              </div>
            ) : (
              <p>
                Số điện thoại: {selected.customer_phone || "—"}
                <br />
                Địa chỉ: {selected.customer_address || "—"}
              </p>
            )}
            {!editing && selected.note?.trim() && (
              <p className="order-detail-note">Ghi chú: {selected.note}</p>
            )}
            {editing && (
              <label className="form-label order-edit-price-list">
                Bảng giá
                <AppSelect
                  ariaLabel="Bảng giá cho hóa đơn"
                  value={editPriceListId}
                  options={orderEditPriceListOptions}
                  isDisabled={priceListsLoading}
                  onChange={(priceListId) =>
                    void changeOrderEditPriceList(priceListId)
                  }
                  placeholder={
                    priceListsLoading ? "Đang tải bảng giá…" : "Chọn bảng giá"
                  }
                />
              </label>
            )}
            {editing && canReadProducts && (
              <div className="purchase-search-row order-edit-product-picker">
                <div className="form-label">
                  <span>Thêm hàng hóa</span>
                  <SearchInputField
                    id="order-edit-product-search"
                    aria-label="Tìm hàng hóa để thêm vào đơn"
                    placeholder="Tìm tên hoặc mã hàng hóa"
                    autoComplete="off"
                    value={editProductSearch}
                    onChange={(value) => {
                      setEditProductSearch(value);
                      setActiveEditProductIndex(0);
                    }}
                    onClear={() => {
                      setEditProductSearch("");
                      setActiveEditProductIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ArrowDown" &&
                        editProductOptions.length
                      ) {
                        event.preventDefault();
                        setActiveEditProductIndex(
                          (index) => (index + 1) % editProductOptions.length,
                        );
                      }
                      if (
                        event.key === "ArrowUp" &&
                        editProductOptions.length
                      ) {
                        event.preventDefault();
                        setActiveEditProductIndex(
                          (index) =>
                            (index - 1 + editProductOptions.length) %
                            editProductOptions.length,
                        );
                      }
                      if (
                        event.key === "Enter" &&
                        editProductOptions[activeEditProductIndex]
                      ) {
                        event.preventDefault();
                        addProductToOrderEdit(
                          editProductOptions[activeEditProductIndex],
                        );
                      }
                      if (event.key === "Escape") {
                        setEditProductSearch("");
                        setActiveEditProductIndex(0);
                      }
                    }}
                  />
                </div>
              </div>
            )}
            {editing && canReadProducts && editProductSearch.trim() && (
              <div
                className="purchase-search-results order-edit-product-options"
                role="listbox"
                aria-label="Hàng hóa phù hợp"
              >
                {!editProductCatalogReady ? (
                  <p className="muted">Đang tải danh sách hàng hóa…</p>
                ) : editProductOptions.length ? (
                  editProductOptions.map((product, index) => {
                    const price = product.product_prices?.find(
                      (item) => item.price_list_id === editPriceListId,
                    )?.price;
                    return (
                      <AppButton
                        className={mergeClassNames(
                          "purchase-search-option",
                          index === activeEditProductIndex && "active",
                        )}
                        key={product.id}
                        variant="ghost"
                        type="button"
                        role="option"
                        aria-selected={index === activeEditProductIndex}
                        onMouseEnter={() => setActiveEditProductIndex(index)}
                        onClick={() => addProductToOrderEdit(product)}
                      >
                        <span>
                          <strong>{product.name}</strong>
                          <small>
                            {product.sku} · {product.unit} · Tồn{" "}
                            {formatQuantity(product.stock)}
                          </small>
                        </span>
                        <span>
                          {price === undefined ? "Nhập giá" : formatVnd(price)}
                          <Plus size={15} />
                        </span>
                      </AppButton>
                    );
                  })
                ) : (
                  <p className="muted">
                    {editProductCatalog.length
                      ? "Không tìm thấy hàng hóa phù hợp."
                      : "Không tải được danh sách hàng hóa để tìm kiếm."}
                  </p>
                )}
              </div>
            )}
            {editing && !canReadProducts && (
              <p className="muted">
                Cần quyền xem hàng hóa để tìm và thêm sản phẩm vào đơn.
              </p>
            )}
            {editing ? (
              <section
                className="order-detail-items order-edit-items"
                aria-label="Sản phẩm trong đơn"
              >
                <div className="order-detail-items-summary">
                  <strong>{items.length} sản phẩm</strong>
                  <span>
                    Tổng số lượng{" "}
                    <b>
                      {formatQuantity(
                        items.reduce(
                          (sum, item) => sum + Number(item.quantity || 0),
                          0,
                        ),
                      )}
                    </b>
                  </span>
                </div>
                <div className="purchase-lines order-edit-lines">
                  <div
                    className="purchase-line purchase-line-header"
                    aria-hidden="true"
                  >
                    <span>SẢN PHẨM</span>
                    <span>SL</span>
                    <span>ĐƠN GIÁ</span>
                    <span>THÀNH TIỀN</span>
                    <span></span>
                  </div>
                  {items.map((item, index) => (
                    <div className="purchase-line" key={item.id}>
                      <div className="purchase-product-name">
                        {item.product_name}
                        <small>{item.sku}</small>
                        {item.components?.map((component) => (
                          <small
                            className="order-edit-component"
                            key={component.sku}
                          >
                            ↳{" "}
                            {renderOrderProductLink(
                              component.product_name,
                              component.sku,
                              component.product_id,
                            )}
                            :{" "}
                            {formatQuantity(
                              Number(item.quantity) *
                                component.quantity_per_bundle,
                            )}{" "}
                            {component.unit}
                          </small>
                        ))}
                      </div>
                      <div className="purchase-quantity">
                        <Controller
                          control={orderEditForm.control}
                          name={`items.${index}.quantity`}
                          rules={{ required: true, min: 0 }}
                          render={({ field }) => (
                            <NumberInputField
                              ariaLabel={`Số lượng ${item.product_name}`}
                              min={0}
                              step={DECIMAL_INPUT_STEP}
                              value={field.value}
                              onChange={(value) =>
                                field.onChange(Number(value))
                              }
                            />
                          )}
                        />
                      </div>
                      <div className="purchase-cost">
                        <Controller
                          control={orderEditForm.control}
                          name={`items.${index}.unit_price`}
                          rules={{ required: true, min: 0 }}
                          render={({ field }) => (
                            <NumberInputField
                              ariaLabel={`Đơn giá ${item.product_name}`}
                              min={0}
                              value={field.value}
                              onChange={(value) =>
                                field.onChange(Number(value))
                              }
                            />
                          )}
                        />
                      </div>
                      <div className="purchase-line-total">
                        {formatVnd(
                          Math.round(
                            normalizeOrderUnitPrice(item.unit_price) *
                              Number(item.quantity),
                          ),
                        )}
                      </div>
                      <AppButton
                        variant="danger"
                        type="button"
                        className="purchase-remove"
                        title="Xóa sản phẩm khỏi đơn"
                        aria-label={`Xóa ${item.product_name} khỏi đơn hàng`}
                        disabled={items.length <= 1}
                        onClick={() => removeProductFromOrderEdit(item.id)}
                      >
                        <Trash2 size={16} />
                      </AppButton>
                    </div>
                  ))}
                </div>
              </section>
            ) : detailOrderId ? (
              <section
                className="order-detail-items"
                aria-label="Sản phẩm trong đơn"
              >
                <div className="order-detail-items-summary">
                  <strong>{items.length} sản phẩm</strong>
                  <span>
                    Tổng số lượng{" "}
                    <b>
                      {formatQuantity(
                        items.reduce(
                          (sum, item) => sum + Number(item.quantity || 0),
                          0,
                        ),
                      )}
                    </b>
                  </span>
                </div>
                {items.map((item, index) => (
                  <article
                    className={mergeClassNames(
                      "order-detail-line mobile-unified-card",
                      !editing &&
                        item.product_id &&
                        "mobile-unified-card--interactive",
                      selected.status === "cancelled" &&
                        "mobile-unified-card--cancelled",
                    )}
                    key={item.id}
                    role={!editing && item.product_id ? "button" : undefined}
                    aria-label={
                      !editing && item.product_id
                        ? `Mở hàng hóa ${item.product_name}`
                        : undefined
                    }
                    tabIndex={!editing && item.product_id ? 0 : undefined}
                    onClick={() => {
                      if (!editing) openOrderProduct(item);
                    }}
                    onKeyDown={(event) => {
                      if (
                        editing ||
                        !item.product_id ||
                        (event.key !== "Enter" && event.key !== " ")
                      ) {
                        return;
                      }
                      event.preventDefault();
                      openOrderProduct(item);
                    }}
                  >
                    <div className="order-detail-product">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <div
                          className="order-detail-product-heading"
                          style={{ flex: "1 1 auto" }}
                        >
                          <strong>{item.product_name}</strong>
                          <span> - {item.sku}</span>
                        </div>
                        {editing && (
                          <AppButton
                            variant="ghost"
                            type="button"
                            title="Xóa sản phẩm khỏi đơn"
                            aria-label={`Xóa ${item.product_name} khỏi đơn hàng`}
                            disabled={items.length <= 1}
                            style={{
                              minHeight: 36,
                              minWidth: 36,
                              padding: "0 8px",
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeProductFromOrderEdit(item.id);
                            }}
                          >
                            <Trash2 size={15} />
                          </AppButton>
                        )}
                      </div>
                      {item.components?.map((component) => (
                        <small key={component.sku}>
                          ↳{" "}
                          {renderOrderProductLink(
                            component.product_name,
                            component.sku,
                            component.product_id,
                          )}
                          :{" "}
                          {formatQuantity(
                            Number(item.quantity) *
                              component.quantity_per_bundle,
                          )}{" "}
                          {component.unit}
                        </small>
                      ))}
                    </div>
                    <div className="order-detail-line-metrics">
                      <div>
                        <span>Số lượng</span>
                        {editing ? (
                          <Controller
                            control={orderEditForm.control}
                            name={`items.${index}.quantity`}
                            rules={{ required: true, min: 0 }}
                            render={({ field }) => (
                              <NumberInputField
                                min={0}
                                step={DECIMAL_INPUT_STEP}
                                value={field.value}
                                onChange={(value) =>
                                  field.onChange(Number(value))
                                }
                              />
                            )}
                          />
                        ) : (
                          <strong>
                            {formatQuantity(item.quantity)} {item.unit}
                          </strong>
                        )}
                      </div>
                      <div>
                        <span>Đơn giá</span>
                        {editing ? (
                          <Controller
                            control={orderEditForm.control}
                            name={`items.${index}.unit_price`}
                            rules={{ required: true, min: 0 }}
                            render={({ field }) => (
                              <NumberInputField
                                ariaLabel={`Đơn giá ${item.product_name}`}
                                min={0}
                                value={field.value}
                                disabled={
                                  editPriceListId !==
                                  (selected.price_list_id || "")
                                }
                                onChange={(value) =>
                                  field.onChange(Number(value))
                                }
                              />
                            )}
                          />
                        ) : (
                          <strong>{formatVnd(item.unit_price)}</strong>
                        )}
                      </div>
                      <div>
                        <span>Thành tiền</span>
                        <strong>
                          {formatVnd(
                            editing
                              ? Math.round(
                                  normalizeOrderUnitPrice(item.unit_price) *
                                    Number(item.quantity),
                                )
                              : item.line_total,
                          )}
                        </strong>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            ) : (
              <AppTable style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th>SL</th>
                    <th>Đơn giá</th>
                    <th>Thành tiền</th>
                    {editing && <th>Thao tác</th>}
                  </tr>
                  <tr className="table-summary-row">
                    <th>Tổng</th>
                    <th>
                      {formatQuantity(
                        items.reduce(
                          (sum, item) => sum + Number(item.quantity || 0),
                          0,
                        ),
                      )}
                    </th>
                    <th></th>
                    <th>
                      {formatVnd(
                        editing
                          ? items.reduce(
                              (sum, item) =>
                                sum +
                                Math.round(
                                  normalizeOrderUnitPrice(item.unit_price) *
                                    Number(item.quantity),
                                ),
                              0,
                            )
                          : selected.subtotal,
                      )}
                    </th>
                    {editing && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr
                      key={item.id}
                      aria-label={
                        !editing && item.product_id
                          ? `Mở hàng hóa ${item.product_name}`
                          : undefined
                      }
                      tabIndex={!editing && item.product_id ? 0 : undefined}
                      style={
                        !editing && item.product_id
                          ? { cursor: "pointer" }
                          : undefined
                      }
                      onClick={() => {
                        if (!editing) openOrderProduct(item);
                      }}
                      onKeyDown={(event) => {
                        if (
                          editing ||
                          !item.product_id ||
                          (event.key !== "Enter" && event.key !== " ")
                        )
                          return;
                        event.preventDefault();
                        openOrderProduct(item);
                      }}
                    >
                      <td>
                        {item.product_name}
                        <div className="muted" style={{ fontSize: 10 }}>
                          {item.sku}
                          {item.components?.map((component) => (
                            <div key={component.sku}>
                              ↳{" "}
                              {renderOrderProductLink(
                                component.product_name,
                                component.sku,
                                component.product_id,
                              )}
                              :{" "}
                              {formatQuantity(
                                Number(item.quantity) *
                                  component.quantity_per_bundle,
                              )}{" "}
                              {component.unit}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        {editing ? (
                          <Controller
                            control={orderEditForm.control}
                            name={`items.${index}.quantity`}
                            rules={{ required: true, min: 0 }}
                            render={({ field }) => (
                              <NumberInputField
                                min={0}
                                step={DECIMAL_INPUT_STEP}
                                value={field.value}
                                onChange={(value) =>
                                  field.onChange(Number(value))
                                }
                              />
                            )}
                          />
                        ) : (
                          <>
                            {formatQuantity(item.quantity)} {item.unit}
                          </>
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <Controller
                            control={orderEditForm.control}
                            name={`items.${index}.unit_price`}
                            rules={{ required: true, min: 0 }}
                            render={({ field }) => (
                              <NumberInputField
                                ariaLabel={`Đơn giá ${item.product_name}`}
                                min={0}
                                value={field.value}
                                onChange={(value) =>
                                  field.onChange(Number(value))
                                }
                              />
                            )}
                          />
                        ) : (
                          formatVnd(item.unit_price)
                        )}
                      </td>
                      <td>
                        {formatVnd(
                          editing
                            ? Math.round(
                                normalizeOrderUnitPrice(item.unit_price) *
                                  Number(item.quantity),
                              )
                            : item.line_total,
                        )}
                      </td>
                      {editing && (
                        <td>
                          <AppButton
                            variant="ghost"
                            type="button"
                            title="Xóa sản phẩm khỏi đơn"
                            aria-label={`Xóa ${item.product_name} khỏi đơn hàng`}
                            disabled={items.length <= 1}
                            style={{
                              minHeight: 36,
                              minWidth: 36,
                              padding: "0 8px",
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeProductFromOrderEdit(item.id);
                            }}
                          >
                            <Trash2 size={15} />
                          </AppButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            )}
            <div style={{ display: "grid", gap: 8, marginTop: 15 }}>
              <div className="summary-row">
                <span>Tổng tiền hàng</span>
                <b>
                  {formatVnd(
                    editing
                      ? items.reduce(
                          (sum, item) =>
                            sum +
                            Math.round(
                              normalizeOrderUnitPrice(item.unit_price) *
                                Number(item.quantity),
                            ),
                          0,
                        )
                      : selected.subtotal,
                  )}
                </b>
              </div>
              <div className="summary-row">
                <label htmlFor="order-edit-discount">Giảm giá</label>
                {editing ? (
                  <Controller
                    control={orderEditForm.control}
                    name="discount"
                    rules={{ required: true, min: 0 }}
                    render={({ field }) => (
                      <NumberInputField
                        id="order-edit-discount"
                        min={0}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                ) : (
                  <b>{formatVnd(selected.discount)}</b>
                )}
              </div>
              <div className="summary-row">
                <b>Khách cần trả</b>
                <b>
                  {formatVnd(
                    editing
                      ? items.reduce(
                          (sum, item) =>
                            sum +
                            Math.round(
                              normalizeOrderUnitPrice(item.unit_price) *
                                Number(item.quantity),
                            ),
                          0,
                        ) - Number(orderEditForm.watch("discount"))
                      : selected.total,
                  )}
                </b>
              </div>
            </div>
            {error && editing && (
              <div className="alert" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
            <div className="form-actions">
              {editing ? (
                <>
                  <AppButton
                    variant="secondary"
                    type="button"

                    onClick={() => {
                      setEditing(false);
                      orderEditForm.reset({
                        customerName: selected.customer_name,
                        customerPhone: selected.customer_phone || "",
                        customerAddress: selected.customer_address || "",
                        discount: String(selected.discount),
                        priceListId: selected.price_list_id || "",
                        items: originalItems,
                      });
                    }}
                  >
                    Hủy sửa
                  </AppButton>
                  <AppButton
                    variant="primary"
                    type="submit"

                    disabled={savingEdit}
                  >
                    {savingEdit ? "Đang lưu…" : "Lưu đơn hàng"}
                  </AppButton>
                </>
              ) : (
                <>
                  {canCancel && selected.status === "completed" && (
                    <AppButton
                      variant="danger"
                      type="button"

                      disabled={cancelling}
                      onClick={() => void cancelOrder()}
                    >
                      {cancelling ? "Đang hủy…" : "Hủy đơn hàng"}
                    </AppButton>
                  )}
                  <AppButton
                    variant="primary"
                    type="button"

                    onClick={printPage}
                  >
                    In
                  </AppButton>
                </>
              )}
            </div>
          </form>
        )}
      </EntityDetailModal>
      {detailExportOpen && (
        <DataExportFieldModal
          title="Tùy chọn cột xuất file"
          description="Chọn ít nhất 1 cột. Mỗi sản phẩm trong đơn hàng sẽ thành một dòng."
          groups={detailExportGroups}
          defaultSelectedKeys={[
            "order_no",
            "created_at",
            "customer_name",
            "sku",
            "product_name",
            "unit",
            "quantity",
            "unit_price",
            "line_total",
          ]}
          busy={exportBusy}
          error={exportError}
          onCancel={handleCloseDetailExport}
          onExport={exportDetails}
        />
      )}
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
      {selected && (
        <ReceiptPrint
          receipt={{
            order_no: selected.order_no,
            customer_name: selected.customer_name,
            customer_phone: selected.customer_phone,
            customer_address: selected.customer_address,
            note: selected.note || "",
            price_list_name: selected.price_list_name,
            subtotal: selected.subtotal,
            discount: selected.discount,
            total: selected.total,
            created_at: formatDateTime(selected.created_at),
          }}
          items={items.map((item) => ({
            key: item.id,
            name: item.product_name,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            lineTotal: item.line_total,
          }))}
        />
      )}
    </>
  );
}
