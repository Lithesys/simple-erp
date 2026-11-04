"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { AppTable } from "@/components/app-table";
import { AppPagination } from "@/components/app-pagination";
import { mergeClassNames } from "@/lib/class-names";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Check,
  Plus,
  Trash2,
  X,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "react-toastify";
import { createClient } from "@/lib/data/client";
import { formatQuantity, formatVnd } from "@/lib/format";
import { DECIMAL_INPUT_STEP } from "@/lib/constants";
import { DataTable, type DataTableSort } from "@/components/data-table";
import { EntityDetailModal } from "@/components/entity-detail-modal";
import { ModalLayer } from "@/components/modal-layer";
import { useEntityDetailId } from "@/lib/use-entity-detail-id";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";
import { MobileSortControl } from "@/components/mobile-sort-control";
import { MobileTableToolbarMetrics } from "@/components/mobile-table-toolbar-metrics";
import { SearchInputField } from "@/components/search-input-field";
import { AppSelect } from "@/components/app-select";
import { NumberInputField } from "@/components/number-input-field";
import {
  dateTimeLocalToIso,
  formatDateTime,
  formatDateTimeLocal,
} from "@/lib/date";
import { DateRangeInput } from "@/components/date-range-input";
import { usePreference } from "@/lib/preferences";
import { hasInvalidPurchaseQuantity } from "@/lib/purchase-validation";
import { searchProductsLocally } from "@/lib/pos-search-cache";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCachedQuery } from "@/lib/query-cache";
import { useInitialTableLoading } from "@/lib/use-initial-table-loading";
import { Controller, useForm } from "react-hook-form";
import {
  DataExportFieldModal,
  DataExportMenu,
  type DataExportFieldGroup,
} from "@/components/data-export-controls";
import { createCsv, downloadCsvFile } from "@/lib/csv-export";
import { useStableCallback } from "@/lib/use-stable-callback";
import { productDetailsHrefForRoute } from "@/lib/management-navigation";

type PurchaseProduct = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  product_costs?: { cost: number } | null;
};
type PurchaseOrder = {
  id: string;
  purchase_no: string;
  purchased_at: string;
  created_at: string;
  received_at: string | null;
  status: "pending" | "received" | "cancelled";
  total?: number;
  product_search?: string;
};
type PurchaseLine = {
  id: string;
  product_id: string;
  quantity: string;
  unit_cost: string;
};
type PurchaseFormValues = { purchasedAt: string; lines: PurchaseLine[] };
type PurchaseItem = {
  id: string;
  product_id?: string | null;
  sku: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
};
type PurchaseExportRow = {
  order: PurchaseOrder;
  item: PurchaseItem | null;
};
type PurchaseAccess = {
  canRead: boolean;
  canList: boolean;
  canCreate: boolean;
  canOverrideCreateCost: boolean;
  canUpdate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canViewCost: boolean;
};
type PurchaseFilterValues = {
  query: string;
  productQuery: string;
  statuses: string[];
};
const defaultPurchaseSort: DataTableSort = {
  key: "purchased_at",
  direction: "desc",
};
const purchasePageSize = 20;

function localDateTimeValue() {
  return formatDateTimeLocal(new Date());
}

export function PurchaseManagement({
  permissions,
}: {
  permissions: PurchaseAccess;
}) {
  const pathname = usePathname();
  const isMobileRoute = pathname.startsWith("/mobile/");
  const detailModal = useEntityDetailId();
  const {
    canRead,
    canList: canListOrders,
    canCreate,
    canOverrideCreateCost,
    canUpdate,
    canEdit: canEditOrder,
    canDelete,
    canApprove,
    canViewCost,
  } = permissions;
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [products, setProducts] = useState<PurchaseProduct[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [page, setPage] = useState(0);
  const [tableRequestBusy, setTableRequestBusy] = useState(false);
  const listRequestIdRef = useRef(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [detailExportOpen, setDetailExportOpen] = useState(false);
  const [exportError, setExportError] = useState("");
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [payableTotal, setPayableTotal] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const purchaseForm = useForm<PurchaseFormValues>({
    defaultValues: { purchasedAt: localDateTimeValue(), lines: [] },
  });
  const lines = purchaseForm.watch("lines");
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(
    null,
  );
  const openedPurchaseOrderIdRef = useRef<string | null>(null);
  const purchaseDetailRequestIdRef = useRef(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<PurchaseItem[]>([]);
  const editLines = lines;
  const priceWrites = useRef(new Map<string, Promise<unknown>>());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const { loading, finishInitialLoad } = useInitialTableLoading();
  const [query, setQuery] = usePreference("purchases.search", "");
  const [savedSort, setSort] = usePreference<DataTableSort | null>(
    "table.purchases.sort",
    defaultPurchaseSort,
  );
  const sort = savedSort ?? defaultPurchaseSort;
  const [productFilterQuery, setProductFilterQuery] = usePreference(
    "purchases.productSearch",
    "",
  );
  const [statusFilters, setStatusFilters] = usePreference<string[]>(
    "purchases.statuses",
    ["pending", "received"],
  );
  const [createdAtRange, setCreatedAtRange] = usePreference<{
    from: string;
    to: string;
  }>("purchases.createdAtRange", { from: "", to: "" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterApplyTimerRef = useRef<number | null>(null);
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftProductFilterQuery, setDraftProductFilterQuery] =
    useState(productFilterQuery);
  const [draftStatusFilters, setDraftStatusFilters] = useState(statusFilters);
  const filterRootRef = useRef<HTMLElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [urlFiltersReady, setUrlFiltersReady] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const confirmAction = useRef<(() => Promise<void>) | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [activeProductIndex, setActiveProductIndex] = useState(0);

  function canEditPurchaseOrder(order: PurchaseOrder | null | undefined) {
    return Boolean(
      order &&
        canEditOrder &&
        order.status !== "cancelled" &&
        (order.status !== "received" || canApprove),
    );
  }

  const currentEditOrder =
    orders.find((order) => order.id === editingOrderId) ?? selectedOrder;
  const canEditCurrentOrder = canEditPurchaseOrder(currentEditOrder);

  const updateCreatedAtRange = useCallback(
    (value: { from: string; to: string }) => {
      setCreatedAtRange(value);
      setPage(0);
    },
    [setCreatedAtRange],
  );
  function applyPurchaseFilterValues(values: PurchaseFilterValues) {
    setDraftQuery(values.query);
    setDraftProductFilterQuery(values.productQuery);
    setDraftStatusFilters(values.statuses);
    setQuery(values.query);
    setProductFilterQuery(values.productQuery);
    setStatusFilters(values.statuses);
    setPage(0);
  }

  function schedulePurchaseFilterApply(values: PurchaseFilterValues) {
    if (filterApplyTimerRef.current !== null)
      window.clearTimeout(filterApplyTimerRef.current);
    filterApplyTimerRef.current = window.setTimeout(() => {
      filterApplyTimerRef.current = null;
      applyPurchaseFilterValues(values);
    }, 300);
  }

  function clearPurchaseFilters() {
    if (filterApplyTimerRef.current !== null) {
      window.clearTimeout(filterApplyTimerRef.current);
      filterApplyTimerRef.current = null;
    }
    applyPurchaseFilterValues({
      query: "",
      productQuery: "",
      statuses: ["pending", "received"],
    });
    updateCreatedAtRange({ from: "", to: "" });
  }

  const updateSort = useCallback(
    (value: DataTableSort) => {
      setSort(value);
      setPage(0);
    },
    [setSort],
  );

  const toggleFilters = useCallback(() => {
    if (filtersOpen) {
      setFiltersOpen(false);
      return;
    }

    setDraftQuery(query);
    setDraftProductFilterQuery(productFilterQuery);
    setDraftStatusFilters(statusFilters);
    setFiltersOpen(true);
  }, [filtersOpen, productFilterQuery, query, statusFilters]);

  useEffect(
    () => () => {
      if (filterApplyTimerRef.current !== null)
        window.clearTimeout(filterApplyTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const readUrlFilters = (useDefaultsWhenEmpty: boolean) => {
      const params = new URLSearchParams(window.location.search);
      const requestedPage = Number(params.get("page"));
      setPage(
        Number.isFinite(requestedPage) && requestedPage > 0
          ? Math.floor(requestedPage)
          : 0,
      );
      const hasPurchaseFilters = ["q", "product", "status", "from", "to"].some(
        (key) => params.has(key),
      );
      if (hasPurchaseFilters || useDefaultsWhenEmpty) {
        const statuses = params
          .getAll("status")
          .filter((status) =>
            ["pending", "received", "cancelled"].includes(status),
          );
        setQuery(params.get("q") || "");
        setProductFilterQuery(params.get("product") || "");
        setStatusFilters(
          params.get("status") === "all"
            ? []
            : statuses.length
              ? statuses
              : ["pending", "received"],
        );
        setCreatedAtRange({
          from: params.get("from") || "",
          to: params.get("to") || "",
        });
      }
    };
    readUrlFilters(false);
    const readyTimer = window.setTimeout(() => setUrlFiltersReady(true), 0);
    const onPopState = () => readUrlFilters(true);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.clearTimeout(readyTimer);
      window.removeEventListener("popstate", onPopState);
    };
  }, [setCreatedAtRange, setProductFilterQuery, setQuery, setStatusFilters]);

  useEffect(() => {
    if (!urlFiltersReady) return;
    const url = new URL(window.location.href);
    const params = url.searchParams;
    for (const key of ["q", "product", "status", "from", "to", "page"])
      params.delete(key);
    if (query) params.set("q", query);
    if (productFilterQuery) params.set("product", productFilterQuery);
    if (statusFilters.length)
      statusFilters.forEach((status) => params.append("status", status));
    else params.set("status", "all");
    if (createdAtRange.from) params.set("from", createdAtRange.from);
    if (createdAtRange.to) params.set("to", createdAtRange.to);
    if (page > 0) params.set("page", String(page));
    const next =
      url.pathname + (params.size ? `?${params.toString()}` : "") + url.hash;
    if (
      window.location.pathname +
        window.location.search +
        window.location.hash !==
      next
    ) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [
    createdAtRange,
    productFilterQuery,
    page,
    query,
    statusFilters,
    urlFiltersReady,
  ]);

  const fetchPurchaseOrdersPage = useCallback(
    async (offset: number, limit: number) => {
      const result = await supabase.rpc("get_purchase_orders", {
        p_from: createdAtRange.from || null,
        p_to: createdAtRange.to || null,
        p_sort: sort.key,
        p_direction: sort.direction,
        p_query: query,
        p_product_query: productFilterQuery,
        p_statuses: statusFilters,
        p_limit: limit,
        p_offset: offset,
      });
      if (result.error) throw result.error;
      return (result.data || {
        rows: [],
        total: 0,
        payable_total: null,
      }) as {
        rows: PurchaseOrder[];
        total: number;
        payable_total: number | null;
      };
    },
    [
      createdAtRange.from,
      createdAtRange.to,
      query,
      productFilterQuery,
      sort.direction,
      sort.key,
      statusFilters,
      supabase,
    ],
  );

  const loadAllPurchaseOrders = useCallback(async () => {
    const allOrders: PurchaseOrder[] = [];
    let total = 0;
    let offset = 0;
    let loadedRows = 0;
    do {
      const result = await fetchPurchaseOrdersPage(offset, 100);
      allOrders.push(...result.rows);
      total = Number(result.total || 0);
      loadedRows = result.rows.length;
      offset += loadedRows;
    } while (offset < total && loadedRows > 0);
    return allOrders;
  }, [fetchPurchaseOrdersPage]);

  const load = useCallback(async () => {
    const requestId = ++listRequestIdRef.current;
    setTableRequestBusy(true);
    try {
      const [productRows, orderRows] = await Promise.all([
        canCreate || canUpdate
          ? fetchCachedQuery(
              queryClient,
              supabase,
              ["purchase-products", canCreate, canUpdate, canViewCost],
              async () => {
                const result = await supabase
                  .from("products")
                  .select(
                    "id,sku,name,unit,stock" +
                      (canViewCost ? ",product_costs(cost)" : ""),
                  )
                  .eq("is_active", true)
                  .eq("kind", "product")
                  .order("name")
                  .limit(1000);
                if (result.error) throw result.error;
                return result.data;
              },
            )
          : Promise.resolve([]),
        canListOrders
          ? fetchCachedQuery(
              queryClient,
              supabase,
              [
                "purchase-orders",
                canViewCost,
                createdAtRange.from,
                createdAtRange.to,
                query,
                productFilterQuery,
                statusFilters,
                sort.key,
                sort.direction,
                page,
                purchasePageSize,
              ],
              () =>
                fetchPurchaseOrdersPage(
                  page * purchasePageSize,
                  purchasePageSize,
                ),
            )
          : Promise.resolve([]),
      ]);
      if (requestId !== listRequestIdRef.current) return;
      setProducts((productRows || []) as PurchaseProduct[]);
      const purchaseData = orderRows as {
        rows?: PurchaseOrder[];
        total?: number;
        payable_total?: number | null;
      } | null;
      const nextTotal = Number(purchaseData?.total || 0);
      setOrderTotal(nextTotal);
      setPayableTotal(
        purchaseData?.payable_total == null
          ? null
          : Number(purchaseData.payable_total),
      );
      const lastPage = Math.max(0, Math.ceil(nextTotal / purchasePageSize) - 1);
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setOrders(purchaseData?.rows || []);
      setError("");
    } catch (caught) {
      if (requestId === listRequestIdRef.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Không tải được dữ liệu nhập hàng.",
        );
      }
    } finally {
      if (requestId === listRequestIdRef.current) {
        setTableRequestBusy(false);
        finishInitialLoad();
      }
    }
  }, [
    canCreate,
    canUpdate,
    canViewCost,
    canListOrders,
    createdAtRange,
    query,
    productFilterQuery,
    statusFilters,
    sort,
    page,
    fetchPurchaseOrdersPage,
    queryClient,
    finishInitialLoad,
    supabase,
  ]);

  const refreshAfterWrite = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["purchase-products"] }),
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["purchase-order-items"] }),
      queryClient.invalidateQueries({
        queryKey: ["purchase-order-edit-items"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["product-inventory-history"],
      }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["pos-products"] }),
    ]);
    await load();
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!filtersOpen) return;
    function closeFilter(event: PointerEvent) {
      if (filterRootRef.current?.contains(event.target as Node)) return;
      if (
        event.target instanceof Element &&
        (event.target.closest(".app-select-menu") ||
          event.target.closest(".daterangepicker"))
      )
        return;
      setFiltersOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setFiltersOpen(false);
    }
    window.addEventListener("pointerdown", closeFilter);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeFilter);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [filtersOpen]);
  useDialogBehavior(isMobileRoute && filtersOpen, filterPanelRef, () =>
    setFiltersOpen(false),
  );

  const visibleOrders = orders;
  const purchaseExportColumns = [
    {
      key: "purchase_no",
      label: "Mã đơn nhập",
      read: (order: PurchaseOrder) => order.purchase_no,
    },
    {
      key: "purchased_at",
      label: "Thời gian",
      read: (order: PurchaseOrder) => formatDateTime(order.purchased_at),
    },
    ...(canViewCost
      ? [
          {
            key: "total",
            label: "Số tiền phải trả cho NCC",
            read: (order: PurchaseOrder) => Number(order.total ?? 0),
          },
        ]
      : []),
    {
      key: "status",
      label: "Trạng thái",
      read: (order: PurchaseOrder) =>
        order.status === "received"
          ? "Đã nhập hàng"
          : order.status === "cancelled"
            ? "Đã hủy"
            : "Đợi duyệt",
    },
  ];
  const purchaseDetailGroups: DataExportFieldGroup[] = [
    {
      key: "purchase",
      label: "Đơn nhập",
      fields: [
        { key: "purchase_no", label: "Mã đơn nhập" },
        { key: "purchased_at", label: "Thời gian nhập" },
        { key: "created_at", label: "Thời gian tạo" },
        { key: "received_at", label: "Thời gian nhận hàng" },
        { key: "status", label: "Trạng thái" },
        ...(canViewCost ? [{ key: "total", label: "Tổng tiền nhập" }] : []),
      ],
    },
    {
      key: "products",
      label: "Sản phẩm",
      fields: [
        { key: "sku", label: "Mã hàng" },
        { key: "product_name", label: "Tên hàng" },
        { key: "unit", label: "Đơn vị" },
        { key: "quantity", label: "Số lượng" },
        ...(canViewCost
          ? [
              { key: "unit_cost", label: "Đơn giá nhập" },
              { key: "line_total", label: "Thành tiền" },
            ]
          : []),
      ],
    },
  ];

  const exportPurchaseOverview = useStableCallback(async () => {
    const columns = visibleColumnKeys
      .filter((key) => key !== "actions")
      .flatMap((key) => {
        const column = purchaseExportColumns.find((item) => item.key === key);
        return column ? [column] : [];
      });
    if (!columns.length || exportBusy) return;
    setExportBusy(true);
    setExportError("");
    try {
      const exportOrders = await loadAllPurchaseOrders();
      downloadCsvFile(
        "don-nhap-tong-quan.csv",
        createCsv(columns, exportOrders),
      );
      toast.success(`Đã xuất ${exportOrders.length} đơn nhập.`);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Không xuất được danh sách đơn nhập.";
      setExportError(message);
      toast.error(message);
    } finally {
      setExportBusy(false);
    }
  });

  const exportPurchaseDetails = useStableCallback(
    async (selectedKeys: string[]) => {
      if (exportBusy) return;
      const allFields = purchaseDetailGroups.flatMap((group) => group.fields);
      const fields = allFields.filter((field) =>
        selectedKeys.includes(field.key),
      );
      if (!fields.length) return;
      setExportBusy(true);
      setExportError("");
      try {
        const exportOrders = await loadAllPurchaseOrders();
        const itemsByOrder = new Map<string, PurchaseItem[]>();
        for (let offset = 0; offset < exportOrders.length; offset += 10) {
          const batch = exportOrders.slice(offset, offset + 10);
          const results = await Promise.all(
            batch.map(async (order) => {
              const result = await supabase.rpc("get_purchase_order_items", {
                p_purchase_order_id: order.id,
              });
              if (result.error) throw result.error;
              return [order.id, (result.data ?? []) as PurchaseItem[]] as const;
            }),
          );
          for (const [orderId, items] of results)
            itemsByOrder.set(orderId, items);
        }
        const rows: PurchaseExportRow[] = [];
        for (const order of exportOrders) {
          const items = itemsByOrder.get(order.id) ?? [];
          if (items.length) {
            for (const item of items) rows.push({ order, item });
          } else rows.push({ order, item: null });
        }
        const readField = (key: string, row: PurchaseExportRow): unknown => {
          switch (key) {
            case "purchase_no":
              return row.order.purchase_no;
            case "purchased_at":
              return formatDateTime(row.order.purchased_at);
            case "created_at":
              return formatDateTime(row.order.created_at);
            case "received_at":
              return row.order.received_at
                ? formatDateTime(row.order.received_at)
                : "";
            case "status":
              return row.order.status === "received"
                ? "Đã nhập hàng"
                : row.order.status === "cancelled"
                  ? "Đã hủy"
                  : "Đợi duyệt";
            case "total":
              return Number(row.order.total ?? 0);
            case "sku":
              return row.item?.sku ?? "";
            case "product_name":
              return row.item?.product_name ?? "";
            case "unit":
              return row.item?.unit ?? "";
            case "quantity":
              return Number(row.item?.quantity ?? 0);
            case "unit_cost":
              return Number(row.item?.unit_cost ?? 0);
            case "line_total":
              return Number(row.item?.line_total ?? 0);
            default:
              return "";
          }
        };
        downloadCsvFile(
          "don-nhap-chi-tiet.csv",
          createCsv(
            fields.map((field) => ({
              key: field.key,
              label: field.label,
              read: (row: PurchaseExportRow) => readField(field.key, row),
            })),
            rows,
          ),
        );
        setDetailExportOpen(false);
        toast.success(
          `Đã xuất ${rows.length} dòng từ ${exportOrders.length} đơn nhập.`,
        );
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Không xuất được chi tiết đơn nhập.";
        setExportError(message);
        toast.error(message);
      } finally {
        setExportBusy(false);
      }
    },
  );

  const handleExportOverview = useStableCallback(() => {
    void exportPurchaseOverview();
  });
  const handleOpenDetailExport = useStableCallback(() => {
    setExportError("");
    setDetailExportOpen(true);
  });
  const handleCloseDetailExport = useStableCallback(() =>
    setDetailExportOpen(false),
  );

  const availableProducts = useMemo(() => {
    return searchProductsLocally(
      products.filter(
        (product) =>
          !(editingOrderId ? editLines : lines).some(
            (line) => line.product_id === product.id,
          ),
      ),
      productQuery,
    );
  }, [products, productQuery, editingOrderId, editLines, lines]);

  function startCreate() {
    if (!canCreate) return;
    setError("");
    purchaseForm.reset({ purchasedAt: localDateTimeValue(), lines: [] });
    setProductQuery("");
    setRetryKey(crypto.randomUUID());
    setCreateOpen(true);
  }

  function addPurchaseProduct(product: PurchaseProduct) {
    if (editingOrderId ? !canEditCurrentOrder : !canCreate) return;
    purchaseForm.setValue(
      "lines",
      [
        ...purchaseForm.getValues("lines"),
        {
          id: crypto.randomUUID(),
          product_id: product.id,
          quantity: "1",
          unit_cost: canViewCost
            ? String(product.product_costs?.cost ?? 0)
            : "0",
        },
      ],
      { shouldDirty: true, shouldValidate: true },
    );
    if (!editingOrderId) setRetryKey(crypto.randomUUID());
    setProductQuery("");
    setActiveProductIndex(0);
  }

  function updateLine(id: string, updates: Partial<PurchaseLine>) {
    if (!canCreate) return;
    if ("unit_cost" in updates && !canOverrideCreateCost) return;
    purchaseForm.setValue(
      "lines",
      purchaseForm
        .getValues("lines")
        .map((line) => (line.id === id ? { ...line, ...updates } : line)),
      { shouldDirty: true, shouldValidate: true },
    );
    setRetryKey(crypto.randomUUID());
  }

  async function savePurchase(values: PurchaseFormValues) {
    if (busy || !canCreate) return;
    if (
      !values.lines.length ||
      values.lines.some(
        (line) =>
          !line.product_id ||
          hasInvalidPurchaseQuantity(line.quantity) ||
          (canViewCost &&
            (!Number.isFinite(Number(line.unit_cost)) ||
              Number(line.unit_cost) < 0)),
      )
    ) {
      setError(
        canViewCost
          ? "Vui lòng chọn hàng hóa, nhập số lượng lớn hơn 0 và giá nhập hợp lệ."
          : "Vui lòng chọn hàng hóa và nhập số lượng lớn hơn 0.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const { data, error: saveError } = await supabase.rpc(
      "create_purchase_order",
      {
        p_idempotency_key: retryKey || crypto.randomUUID(),
        p_purchased_at: dateTimeLocalToIso(values.purchasedAt),
        p_lines: values.lines.map((line) => ({
          product_id: line.product_id,
          quantity: Number(line.quantity),
          unit_cost: canViewCost ? Number(line.unit_cost) : 0,
        })),
      },
    );
    setBusy(false);
    if (saveError) {
      setError(saveError.message);
      toast.error("Không tạo được đơn nhập hàng.");
      return;
    }
    setCreateOpen(false);
    purchaseForm.reset({ purchasedAt: localDateTimeValue(), lines: [] });
    setRetryKey(null);
    toast.success("Đã tạo đơn nhập " + data.purchase_no + " · Đang đợi duyệt.");
    await refreshAfterWrite();
  }

  const openOrder = useCallback(
    async (order: PurchaseOrder) => {
      if (!canRead) return;
      const requestId = ++purchaseDetailRequestIdRef.current;
      openedPurchaseOrderIdRef.current = order.id;
      detailModal.open(order.id);
      setSelectedOrder(order);
      setSelectedItems([]);
      setDetailLoading(true);
      setError("");
      try {
        const data = await fetchCachedQuery(
          queryClient,
          supabase,
          ["purchase-order-items", order.id, canViewCost],
          async () => {
            const result = await supabase.rpc("get_purchase_order_items", {
              p_purchase_order_id: order.id,
            });
            if (result.error) throw result.error;
            return result.data;
          },
        );
        if (purchaseDetailRequestIdRef.current !== requestId) return;
        setSelectedItems(
          (
            (data || []) as (Omit<PurchaseItem, "unit_cost" | "line_total"> & {
              unit_cost: number | null;
              line_total: number | null;
            })[]
          ).map((item) => ({
            ...item,
            unit_cost: Number(item.unit_cost || 0),
            line_total: Number(item.line_total || 0),
          })),
        );
        setDetailLoading(false);
      } catch (caught) {
        if (purchaseDetailRequestIdRef.current === requestId) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Không tải được chi tiết đơn nhập.",
          );
          setDetailLoading(false);
        }
      }
    },
    [canRead, canViewCost, detailModal, queryClient, supabase],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const legacyId = params.get("purchaseOrderId");
    if (legacyId) {
      detailModal.replace(detailModal.id || legacyId, ["purchaseOrderId"]);
      return;
    }
    const id = detailModal.id;
    if (!id) {
      if (!editingOrderId) {
        openedPurchaseOrderIdRef.current = null;
        purchaseDetailRequestIdRef.current += 1;
        setDetailLoading(false);
        setSelectedOrder(null);
        setSelectedItems([]);
      }
      return;
    }
    if (!canRead) {
      setError("Tài khoản không có quyền xem đơn nhập này.");
      setDetailLoading(false);
      return;
    }
    if (openedPurchaseOrderIdRef.current === id) return;

    let active = true;
    openedPurchaseOrderIdRef.current = id;
    const requestId = ++purchaseDetailRequestIdRef.current;
    setSelectedOrder(null);
    setSelectedItems([]);
    setDetailLoading(true);
    setError("");
    void (async () => {
      try {
        let order = orders.find((row) => row.id === id);
        if (!order) {
          const result = await supabase
            .from("purchase_orders")
            .select(
              "id,purchase_no,purchased_at,created_at,received_at,status" +
                (canViewCost ? ",total" : ""),
            )
            .eq("id", id)
            .maybeSingle();
          if (result.error) throw result.error;
          order = result.data ? (result.data as PurchaseOrder) : undefined;
        }
        if (!active || purchaseDetailRequestIdRef.current !== requestId) return;
        if (!order) {
          setError(
            "Không tìm thấy đơn nhập hoặc tài khoản không có quyền xem.",
          );
          setDetailLoading(false);
          return;
        }
        void openOrder(order);
      } catch (caught) {
        if (!active || purchaseDetailRequestIdRef.current !== requestId) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Không tải được chi tiết đơn nhập.",
        );
        setDetailLoading(false);
      }
    })();
    return () => {
      active = false;
      if (
        purchaseDetailRequestIdRef.current === requestId &&
        openedPurchaseOrderIdRef.current === id
      ) {
        openedPurchaseOrderIdRef.current = null;
        purchaseDetailRequestIdRef.current += 1;
      }
    };
  }, [
    canRead,
    canViewCost,
    detailModal,
    editingOrderId,
    openOrder,
    orders,
    supabase,
  ]);

  function closePurchaseDetail() {
    detailModal.close();
    openedPurchaseOrderIdRef.current = null;
    purchaseDetailRequestIdRef.current += 1;
    setDetailLoading(false);
    setSelectedOrder(null);
    setSelectedItems([]);
    setError("");
  }

  async function editOrder(order: PurchaseOrder) {
    if (!canEditPurchaseOrder(order)) return;
    detailModal.close();
    setSelectedItems([]);
    setSelectedOrder(order);
    setEditingOrderId(order.id);
    setError("");
    let rawItems: unknown;
    try {
      rawItems = await fetchCachedQuery(
        queryClient,
        supabase,
        ["purchase-order-edit-items", order.id],
        async () => {
          const result = await supabase
            .from("purchase_order_items")
            .select(
              "id,product_id,quantity,unit_cost,sku,product_name,unit,line_total",
            )
            .eq("purchase_order_id", order.id);
          if (result.error) throw result.error;
          return result.data;
        },
      );
    } catch (caught) {
      setEditingOrderId(null);
      setSelectedOrder(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "Không tải được chi tiết đơn nhập.",
      );
      return;
    }
    const data = (rawItems || []) as {
      id: string;
      product_id: string | null;
      quantity: number;
      unit_cost: number;
      sku: string;
      product_name: string;
      unit: string;
      line_total: number;
    }[];
    purchaseForm.reset({
      purchasedAt: formatDateTimeLocal(order.purchased_at),
      lines: data.map((item) => ({
        id: item.id,
        product_id: item.product_id || "",
        quantity: String(item.quantity),
        unit_cost: String(item.unit_cost),
      })),
    });
    setSelectedItems((data || []) as PurchaseItem[]);
    setError("");
  }

  async function saveEdit(values: PurchaseFormValues) {
    const order = orders.find((item) => item.id === editingOrderId);
    if (!canEditPurchaseOrder(order) || !order || busy) return;
    if (
      !values.lines.length ||
      values.lines.some(
        (line) =>
          !line.product_id ||
          hasInvalidPurchaseQuantity(line.quantity) ||
          Number(line.unit_cost) < 0 ||
          !Number.isFinite(Number(line.quantity)) ||
          !Number.isFinite(Number(line.unit_cost)),
      )
    ) {
      setError("Vui lòng kiểm tra hàng hóa, số lượng và giá nhập.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: totalError } = await supabase.rpc("update_purchase_order", {
      p_purchase_order_id: order.id,
      p_purchased_at: dateTimeLocalToIso(values.purchasedAt),
      p_lines: values.lines.map((line) => ({
        id: selectedItems.some((item) => item.id === line.id) ? line.id : null,
        product_id: line.product_id,
        quantity: Number(line.quantity),
        unit_cost: Number(line.unit_cost),
      })),
    });
    setBusy(false);
    if (totalError) {
      setError(totalError.message);
      return;
    }
    setEditingOrderId(null);
    setSelectedOrder(null);
    purchaseForm.reset({ purchasedAt: localDateTimeValue(), lines: [] });
    toast.success("Đã cập nhật đơn nhập.");
    await refreshAfterWrite();
  }

  function updateEditLine(id: string, updates: Partial<PurchaseLine>) {
    if (!canEditCurrentOrder) return;
    const prior = priceWrites.current.get(id) || Promise.resolve();
    const task = prior
      .catch(() => undefined)
      .then(() => {
        purchaseForm.setValue(
          "lines",
          purchaseForm
            .getValues("lines")
            .map((line) => (line.id === id ? { ...line, ...updates } : line)),
          { shouldDirty: true, shouldValidate: true },
        );
      });
    priceWrites.current.set(id, task);
  }

  function removePurchaseLine(id: string) {
    if (editingOrderId ? !canEditCurrentOrder : !canCreate) return;
    if (editingOrderId)
      purchaseForm.setValue(
        "lines",
        purchaseForm.getValues("lines").filter((item) => item.id !== id),
        { shouldDirty: true, shouldValidate: true },
      );
    else {
      purchaseForm.setValue(
        "lines",
        purchaseForm.getValues("lines").filter((item) => item.id !== id),
        { shouldDirty: true, shouldValidate: true },
      );
      setRetryKey(crypto.randomUUID());
    }
  }

  async function removeOrder(order: PurchaseOrder) {
    if (busy || order.status === "cancelled" || !canDelete) return;
    confirmAction.current = async () => {
      if (!canDelete || busy) return;
      setBusy(true);
      const { error: deleteError } = await supabase.rpc(
        "delete_purchase_order",
        { p_purchase_order_id: order.id },
      );
      setBusy(false);
      if (deleteError) {
        setError(deleteError.message);
        toast.error("Không hủy được phiếu nhập hàng.");
      } else {
        setSelectedOrder(null);
        toast.success("Đã hủy phiếu nhập.");
        await refreshAfterWrite();
      }
    };
    setConfirmRequest({
      title: "Hủy phiếu nhập hàng?",
      message:
        order.status === "received"
          ? `Hủy ${order.purchase_no} sẽ trừ các mặt hàng đã nhập khỏi tồn kho. Phiếu chỉ được hủy nếu số tồn hiện tại đủ để trừ; phiếu vẫn được lưu trong lịch sử. `
          : `Phiếu ${order.purchase_no} sẽ được chuyển vào lịch sử đã hủy.`,
      confirmLabel: "Hủy phiếu nhập",
    });
  }

  async function receive(order: PurchaseOrder) {
    if (busy || order.status !== "pending" || !canApprove) return;
    confirmAction.current = async () => {
      setBusy(true);
      setError("");
      const { error: receiveError } = await supabase.rpc(
        "receive_purchase_order",
        { p_purchase_order_id: order.id },
      );
      setBusy(false);
      if (receiveError) {
        setError(receiveError.message);
        toast.error("Không duyệt được đơn nhập hàng.");
        return;
      }
      setSelectedOrder(null);
      setSelectedItems([]);
      toast.success(
        "Đã nhập kho thành công. Nhật ký tồn kho đã được cập nhật.",
      );
      await refreshAfterWrite();
    };
    setConfirmRequest({
      title: "Duyệt đơn nhập hàng?",
      message: `Duyệt ${order.purchase_no}? Số lượng hàng sẽ được cộng vào tồn kho.`,
      confirmLabel: "Duyệt và nhập kho",
    });
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Nhập hàng</h1>
          <p>Tạo đơn nhập nhiều mặt hàng, sau đó duyệt để cộng hàng vào kho.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canListOrders && (
            <DataExportMenu
              disabled={loading || visibleColumnKeys.length === 0}
              busy={exportBusy}
              onOverview={handleExportOverview}
              onDetails={handleOpenDetailExport}
            />
          )}
          {canCreate && (
            <AppButton
              variant="primary"
              aria-label="Tạo đơn nhập"
              onClick={startCreate}
            >
              <Plus size={16} />
              <span className="mobile-button-label">Tạo đơn nhập</span>
            </AppButton>
          )}
        </div>
      </div>
      {error && !createOpen && !selectedOrder && !detailModal.id && (
        <div className="alert" style={{ marginBottom: 12 }} role="alert">
          {error}
        </div>
      )}
      <div className="orders-workspace">
        {canListOrders && (
          <aside
            ref={filterRootRef}
            className="product-filters card purchase-filters orders-filter"
          >
            <label className="filter-label">Tìm và lọc đơn nhập</label>
            <div className="orders-filter-date">
              <span>Ngày tạo phiếu</span>
              <DateRangeInput
                start={createdAtRange.from}
                end={createdAtRange.to}
                ariaLabel="Lọc đơn nhập theo ngày tạo"
                onChange={(from, to) => updateCreatedAtRange({ from, to })}
              />
            </div>
            <AppButton
              variant="default"
              type="button"
              className="orders-filter-trigger"
              aria-expanded={filtersOpen}
              aria-controls="purchase-filter-panel"
              onClick={toggleFilters}
            >
              <span>
                {query ||
                productFilterQuery ||
                statusFilters.length !== 2 ||
                statusFilters.includes("cancelled") ? (
                  <span>Đang áp dụng bộ lọc</span>
                ) : (
                  <span>Tìm đơn nhập</span>
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
                    onMouseDown={() => setFiltersOpen(false)}
                  />
                )}
                <div
                  ref={filterPanelRef}
                  id="purchase-filter-panel"
                  className="orders-filter-panel purchase-filter-panel"
                  role={isMobileRoute ? "dialog" : undefined}
                  aria-modal={isMobileRoute ? true : undefined}
                  aria-label="Tìm và lọc đơn nhập"
                  data-mobile-filter-sheet={isMobileRoute ? "" : undefined}
                  tabIndex={-1}
                >
                  <div className="mobile-filter-panel-heading">
                    <strong>Tìm và lọc đơn nhập</strong>
                    <AppButton
                      variant="ghost"
                      type="button"
                      className="mobile-dialog-close"
                      aria-label="Đóng bộ lọc"
                      onClick={() => setFiltersOpen(false)}
                    >
                      <X size={18} />
                    </AppButton>
                  </div>
                  <div className="purchase-filter-grid">
                    <label className="form-label">
                      Theo mã đơn nhập
                      <SearchInputField
                        showSearchIcon={false}
                        aria-label="Tìm mã đơn nhập"
                        placeholder="Mã đơn nhập"
                        value={draftQuery}
                        onChange={(value) => {
                          setDraftQuery(value);
                          schedulePurchaseFilterApply({
                            query: value,
                            productQuery: draftProductFilterQuery,
                            statuses: draftStatusFilters,
                          });
                        }}
                        onClear={() => {
                          setDraftQuery("");
                          schedulePurchaseFilterApply({
                            query: "",
                            productQuery: draftProductFilterQuery,
                            statuses: draftStatusFilters,
                          });
                        }}
                      />
                    </label>
                    <label className="form-label">
                      Theo tên, mã hàng hóa
                      <SearchInputField
                        showSearchIcon={false}
                        aria-label="Tìm hàng hóa trong đơn nhập"
                        placeholder="Tìm tên hoặc mã hàng hóa"
                        value={draftProductFilterQuery}
                        onChange={(value) => {
                          setDraftProductFilterQuery(value);
                          schedulePurchaseFilterApply({
                            query: draftQuery,
                            productQuery: value,
                            statuses: draftStatusFilters,
                          });
                        }}
                        onClear={() => {
                          setDraftProductFilterQuery("");
                          schedulePurchaseFilterApply({
                            query: draftQuery,
                            productQuery: "",
                            statuses: draftStatusFilters,
                          });
                        }}
                      />
                    </label>
                  </div>
                  <label className="form-label purchase-status-filter">
                    Trạng thái đơn nhập
                    <AppSelect
                      ariaLabel="Trạng thái đơn nhập"
                      isMulti
                      value={draftStatusFilters}
                      onChange={(statuses) => {
                        setDraftStatusFilters(statuses);
                        schedulePurchaseFilterApply({
                          query: draftQuery,
                          productQuery: draftProductFilterQuery,
                          statuses,
                        });
                      }}
                      options={[
                        { value: "pending", label: "Đợi duyệt" },
                        { value: "received", label: "Đã nhập hàng" },
                        { value: "cancelled", label: "Đã hủy" },
                      ]}
                      placeholder="Tất cả trạng thái"
                    />
                  </label>
                  <div className="orders-filter-actions">
                    <AppButton
                      variant="ghost"
                      type="button"
                      onClick={clearPurchaseFilters}
                    >
                      Xóa bộ lọc
                    </AppButton>
                  </div>
                </div>
              </>
            )}
          </aside>
        )}
        {canListOrders &&
          (loading ? (
            <LoadingSkeleton rows={6} />
          ) : (
            <section className="card table-wrap">
              {isMobileRoute && (
                <div className="mobile-record-list purchase-mobile-list">
                  <MobileTableToolbarMetrics
                    className="grid-cols-2"
                    metrics={[
                      { label: "Tổng phiếu", value: orderTotal },
                      ...(canViewCost
                        ? [
                            {
                              label: "Tiền phải trả cho NCC",
                              value: formatVnd(payableTotal || 0),
                            },
                          ]
                        : []),
                    ]}
                  />
                  <MobileSortControl
                    columns={[
                      { key: "purchase_no", label: "Mã đơn nhập" },
                      { key: "purchased_at", label: "Thời gian" },
                      ...(canViewCost
                        ? [{ key: "total", label: "Số tiền phải trả cho NCC" }]
                        : []),
                      { key: "status", label: "Trạng thái" },
                    ]}
                    sort={sort}
                    onChange={updateSort}
                  />
                  {visibleOrders.length ? (
                    visibleOrders.map((order) => (
                      <article
                        className="mobile-record-card-shell purchase-mobile-card-shell"
                        key={order.id}
                      >
                        <AppButton
                          variant="ghost"
                          className={mergeClassNames(
                            "mobile-record-card purchase-mobile-card mobile-unified-card mobile-unified-card--interactive",
                            detailModal.activeId === order.id &&
                              "mobile-unified-card--selected",
                          )}
                          type="button"
                          onClick={() => void openOrder(order)}
                          aria-label={`Xem phiếu nhập ${order.purchase_no}`}
                        >
                          <span className="purchase-mobile-card-meta">
                            <strong>{order.purchase_no}</strong>
                            <time dateTime={order.purchased_at}>
                              {formatDateTime(order.purchased_at)}
                            </time>
                          </span>
                          {canViewCost && (
                            <span className="purchase-mobile-card-total">
                              <span>Số tiền phải trả</span>
                              <strong>
                                {formatVnd(Number(order.total || 0))}
                              </strong>
                            </span>
                          )}
                        </AppButton>
                        <div className="mobile-record-card-actions">
                          <span className="purchase-mobile-card-status">
                            <span
                              className={mergeClassNames(
                                "badge",
                                order.status === "received"
                                  ? "badge-green"
                                  : order.status === "pending"
                                    ? "badge-amber"
                                    : undefined,
                              )}
                            >
                              {order.status === "received"
                                ? "Đã nhập hàng"
                                : order.status === "cancelled"
                                  ? "Đã hủy"
                                  : "Đợi duyệt"}
                            </span>
                          </span>
                          <div className="purchase-mobile-action-buttons">
                            {order.status !== "cancelled" && (
                              <>
                                {canApprove && order.status === "pending" && (
                                  <AppButton
                                    variant="ghost"
                                    className="purchase-mobile-action--approve"
                                    type="button"
                                    aria-label={`Duyệt ${order.purchase_no}`}
                                    title="Duyệt và nhập kho"
                                    disabled={busy}
                                    onClick={() => void receive(order)}
                                  >
                                    <Check size={16} />
                                    <span>Duyệt</span>
                                  </AppButton>
                                )}
                                {canDelete && (
                                  <AppButton
                                    variant="danger"
                                    className="purchase-mobile-action--cancel"
                                    type="button"
                                    aria-label={`Hủy ${order.purchase_no}`}
                                    title="Hủy đơn nhập"
                                    disabled={busy}
                                    onClick={() => void removeOrder(order)}
                                  >
                                    <Trash2 size={16} />
                                    <span>Hủy</span>
                                  </AppButton>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="muted mobile-record-empty">
                      Chưa có đơn nhập hàng phù hợp.
                    </p>
                  )}
                </div>
              )}
              <div className="desktop-record-table">
                <DataTable
                  storageKey="purchases"
                  onVisibleColumnsChange={setVisibleColumnKeys}
                  serverSort={{
                    value: sort,
                    onChange: updateSort,
                  }}
                  rows={visibleOrders}
                  rowKey={(order) => order.id}
                  totalRows={orderTotal}
                  onRowClick={(order) => void openOrder(order)}
                  activeRowId={detailModal.activeId}
                  empty="Chưa có đơn nhập hàng phù hợp."
                  toolbarSummary={
                    <>
                      <span>
                        Tổng phiếu: <b>{orderTotal}</b>
                      </span>
                      {canViewCost && (
                        <>
                          <span> · </span>
                          <span>
                            Tổng số tiền phải trả cho NCC:{" "}
                            <b>{formatVnd(payableTotal || 0)}</b>
                          </span>
                        </>
                      )}
                    </>
                  }
                  columns={[
                    {
                      key: "purchase_no",
                      label: "Mã đơn nhập",
                      value: (order) => order.purchase_no,
                      summary: `${orderTotal} phiếu`,
                      render: (order) => <strong>{order.purchase_no}</strong>,
                    },
                    {
                      key: "purchased_at",
                      label: "Thời gian",
                      value: (order) => order.purchased_at,
                      render: (order) => formatDateTime(order.purchased_at),
                    },
                    ...(canViewCost
                      ? [
                          {
                            key: "total",
                            label: "Số tiền phải trả cho NCC",
                            value: (order: PurchaseOrder) =>
                              Number(order.total),
                            summary: formatVnd(payableTotal || 0),
                            render: (order: PurchaseOrder) =>
                              formatVnd(Number(order.total)),
                          },
                        ]
                      : []),
                    {
                      key: "status",
                      label: "Trạng thái",
                      value: (order) => order.status,
                      render: (order) => (
                        <span
                          className={mergeClassNames(
                            "badge",
                            order.status === "received"
                              ? "badge-green"
                              : order.status === "cancelled"
                                ? undefined
                                : "badge-amber",
                          )}
                        >
                          {order.status === "received"
                            ? "Đã nhập hàng"
                            : order.status === "cancelled"
                              ? "Đã hủy"
                              : "Đợi duyệt"}
                        </span>
                      ),
                    },
                    {
                      key: "actions",
                      label: "Thao tác",
                      hideable: false,
                      render: (order: PurchaseOrder) => (
                        <>
                          {order.status !== "cancelled" && (
                            <>
                              {canApprove && order.status === "pending" && (
                                <AppButton
                                  variant="ghost"
                                  iconOnly
                                  title="Duyệt và nhập kho"
                                  aria-label="Duyệt và nhập kho"
                                  disabled={busy}
                                  onClick={() => void receive(order)}
                                >
                                  <Check size={16} />
                                </AppButton>
                              )}
                              {canDelete && (
                                <AppButton
                                  variant="danger"
                                  iconOnly
                                  title="Hủy đơn nhập"
                                  aria-label="Hủy đơn nhập"
                                  disabled={busy}
                                  onClick={() => void removeOrder(order)}
                                >
                                  <Trash2 size={16} />
                                </AppButton>
                              )}
                            </>
                          )}
                        </>
                      ),
                    },
                  ]}
                />
              </div>
              <AppPagination
                page={page}
                pageSize={purchasePageSize}
                totalRows={orderTotal}
                onPageChange={setPage}
                disabled={tableRequestBusy}
              />
            </section>
          ))}
        {!canListOrders && (
          <div className="muted">Bạn có thể tạo đơn nhập mới.</div>
        )}
      </div>

      {detailExportOpen && (
        <DataExportFieldModal
          title="Tùy chọn cột xuất file"
          description="Mỗi sản phẩm trong đơn nhập sẽ thành một dòng."
          groups={purchaseDetailGroups}
          defaultSelectedKeys={[
            "purchase_no",
            "purchased_at",
            "status",
            "sku",
            "product_name",
            "unit",
            "quantity",
          ]}
          busy={exportBusy}
          error={exportError}
          onCancel={handleCloseDetailExport}
          onExport={exportPurchaseDetails}
        />
      )}

      {(createOpen || editingOrderId) && (
        <ModalLayer
          className="modal-backdrop"
          onEscape={() => {
            setCreateOpen(false);
            setEditingOrderId(null);
          }}
        >
          <form
            className="modal card purchase-form"
            onSubmit={
              editingOrderId
                ? purchaseForm.handleSubmit(saveEdit)
                : purchaseForm.handleSubmit(savePurchase)
            }
            role="dialog"
            aria-modal="true"
            aria-label={
              editingOrderId ? "Sửa đơn nhập hàng" : "Tạo đơn nhập hàng"
            }
          >
            <div className="modal-title">
              <h2>
                {editingOrderId
                  ? `Sửa ${selectedOrder?.purchase_no || "đơn nhập"}`
                  : "Tạo đơn nhập hàng"}
              </h2>
              <AppButton
                variant="ghost"
                type="button"

                onClick={() => {
                  setCreateOpen(false);
                  setEditingOrderId(null);
                  setSelectedOrder(null);
                  setSelectedItems([]);
                  purchaseForm.reset({
                    purchasedAt: localDateTimeValue(),
                    lines: [],
                  });
                }}
              >
                <X size={18} />
              </AppButton>
            </div>
            <label className="form-label">
              Thời gian nhập
              <Controller
                control={purchaseForm.control}
                name="purchasedAt"
                rules={{ required: true }}
                render={({ field }) => (
                  <AppInput
                    className="field"
                    type="datetime-local"
                    {...field}
                    onChange={(event) => {
                      field.onChange(event);
                      if (!editingOrderId) setRetryKey(crypto.randomUUID());
                    }}
                    required
                  />
                )}
              />
            </label>
            <div className="purchase-search-row">
              <label className="form-label">
                Thêm hàng hóa
                <SearchInputField
                  autoComplete="off"
                  aria-label="Tìm hàng hóa để thêm dòng"
                  placeholder="Tìm tên hoặc mã hàng hóa"
                  value={productQuery}
                  onChange={(value) => {
                    setProductQuery(value);
                    setActiveProductIndex(0);
                  }}
                  onClear={() => {
                    setProductQuery("");
                    setActiveProductIndex(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && availableProducts.length) {
                      event.preventDefault();
                      setActiveProductIndex(
                        (index) => (index + 1) % availableProducts.length,
                      );
                    }
                    if (event.key === "ArrowUp" && availableProducts.length) {
                      event.preventDefault();
                      setActiveProductIndex(
                        (index) =>
                          (index - 1 + availableProducts.length) %
                          availableProducts.length,
                      );
                    }
                    if (
                      event.key === "Enter" &&
                      availableProducts[activeProductIndex]
                    ) {
                      event.preventDefault();
                      addPurchaseProduct(availableProducts[activeProductIndex]);
                    }
                    if (event.key === "Escape") setProductQuery("");
                  }}
                />
              </label>
            </div>
            {productQuery && (
              <div
                className="purchase-search-results"
                role="listbox"
                aria-label="Hàng hóa phù hợp"
              >
                {availableProducts.length ? (
                  availableProducts.map((product, index) => (
                    <AppButton
                      key={product.id}
                      variant="ghost"
                      type="button"
                      role="option"
                      aria-selected={index === activeProductIndex}
                      className={mergeClassNames(
                        "purchase-search-option",
                        index === activeProductIndex && "active",
                      )}
                      onMouseEnter={() => setActiveProductIndex(index)}
                      onClick={() => addPurchaseProduct(product)}
                    >
                      <span>
                        <b>{product.name}</b>
                        <small>
                          {product.sku} · Tồn {formatQuantity(product.stock)}
                        </small>
                      </span>
                      {canViewCost && (
                        <span className="muted">
                          Vốn {formatVnd(product.product_costs?.cost ?? 0)}
                        </span>
                      )}
                    </AppButton>
                  ))
                ) : (
                  <div className="muted purchase-search-empty">
                    Không tìm thấy hàng hóa phù hợp.
                  </div>
                )}
              </div>
            )}
            <div
              className={mergeClassNames(
                "purchase-lines",
                !canViewCost && "quantity-only",
              )}
            >
              <div
                className="purchase-line purchase-line-header"
                aria-hidden="true"
              >
                <span>SẢN PHẨM</span>
                <span>SL</span>
                {canViewCost && (
                  <>
                    <span>ĐƠN GIÁ</span>
                    <span>THÀNH TIỀN</span>
                  </>
                )}
                <span></span>
              </div>
              {(editingOrderId ? editLines : lines).map((line) => {
                const unitCost = Number(line.unit_cost || 0);
                const product = products.find(
                  (item) => item.id === line.product_id,
                );
                const selectedItem = selectedItems.find(
                  (item) => item.id === line.id,
                );
                const name =
                  product?.name ||
                  selectedItem?.product_name ||
                  "Chọn hàng hóa";
                const sku = product?.sku || selectedItem?.sku || "";
                return (
                  <div className="purchase-line" key={line.id}>
                    <div className="purchase-product-name">
                      {name}
                      <small>{sku}</small>
                    </div>
                    <div className="purchase-quantity">
                      <NumberInputField
                        ariaLabel={`Số lượng ${name}`}
                        min={0}
                        step={DECIMAL_INPUT_STEP}
                        value={line.quantity}
                        onChange={(quantity) =>
                          editingOrderId
                            ? updateEditLine(line.id, { quantity })
                            : updateLine(line.id, { quantity })
                        }
                      />
                    </div>
                    {canViewCost && (
                      <>
                        <div className="purchase-cost">
                          {editingOrderId ? (
                            <NumberInputField
                              ariaLabel={`Giá nhập ${name}`}
                              min={0}
                              step={1}
                              value={line.unit_cost}
                              onChange={(unit_cost) =>
                                updateEditLine(line.id, { unit_cost })
                              }
                            />
                          ) : canOverrideCreateCost ? (
                            <NumberInputField
                              ariaLabel={`Giá nhập ${name}`}
                              min={0}
                              step={1}
                              value={line.unit_cost}
                              onChange={(unit_cost) =>
                                updateLine(line.id, { unit_cost })
                              }
                            />
                          ) : (
                            formatVnd(unitCost)
                          )}
                        </div>
                        <div className="purchase-line-total">
                          {formatVnd(
                            Math.round(Number(line.quantity || 0) * unitCost),
                          )}
                        </div>
                      </>
                    )}
                    <AppButton
                      variant="danger"
                      type="button"
                      className="purchase-remove"
                      aria-label="Xóa hàng hóa khỏi đơn nhập"
                      onClick={() => removePurchaseLine(line.id)}
                    >
                      <Trash2 size={19} />
                    </AppButton>
                  </div>
                );
              })}
            </div>
            {canViewCost && (
              <div className="purchase-summary">
                <span>Số tiền phải trả cho NCC</span>
                <b>
                  {formatVnd(
                    (editingOrderId ? editLines : lines).reduce(
                      (sum, line) =>
                        sum +
                        Math.round(
                          Number(line.quantity || 0) *
                            Number(line.unit_cost || 0),
                        ),
                      0,
                    ),
                  )}
                </b>
              </div>
            )}
            <div className="muted" style={{ fontSize: 12, marginTop: 9 }}>
              {editingOrderId
                ? selectedOrder?.status === "received"
                  ? "Đơn đã nhập: thay đổi số lượng sẽ cập nhật tồn kho ngay khi lưu. Không thể làm tồn kho âm."
                  : "Đơn đang đợi duyệt: chưa làm thay đổi tồn kho."
                : "Đơn mới ở trạng thái đợi duyệt và chưa làm thay đổi tồn kho."}
            </div>
            {!canViewCost && (
              <div className="muted" style={{ fontSize: 12, marginTop: 9 }}>
                Giá nhập sẽ do người có quyền xem giá vốn bổ sung và kiểm tra
                trước khi duyệt.
              </div>
            )}
            {!editingOrderId && canViewCost && !canOverrideCreateCost && (
              <div className="muted" style={{ fontSize: 12, marginTop: 9 }}>
                Đơn giá lấy theo giá vốn hiện tại. Cần quyền sửa và duyệt đơn
                nhập để thay đổi giá khi tạo.
              </div>
            )}
            {error && (
              <div className="alert" style={{ marginTop: 12 }} role="alert">
                {error}
              </div>
            )}
            <div className="form-actions">
              <AppButton
                variant="secondary"
                type="button"

                onClick={() => {
                  setCreateOpen(false);
                  setEditingOrderId(null);
                  purchaseForm.reset({
                    purchasedAt: localDateTimeValue(),
                    lines: [],
                  });
                }}
              >
                Hủy
              </AppButton>
              <AppButton
                variant="primary"

                disabled={
                  busy || !(editingOrderId ? editLines.length : lines.length)
                }
              >
                {busy
                  ? "Đang lưu…"
                  : editingOrderId
                    ? "Lưu thay đổi"
                    : "Tạo đơn nhập"}
              </AppButton>
            </div>
          </form>
        </ModalLayer>
      )}

      <EntityDetailModal
        open={Boolean(detailModal.id && selectedOrder && !editingOrderId)}
        onClose={closePurchaseDetail}
        panelClassName="purchase-detail-modal"
        ariaLabel={`Chi tiết ${selectedOrder?.purchase_no || "đơn nhập"}`}
      >
        {selectedOrder && !editingOrderId && (
          <>
            <div className="modal-title">
              <div>
                <h2>{selectedOrder.purchase_no}</h2>
                <div className="muted" style={{ fontSize: 12, marginTop: 5 }}>
                  {formatDateTime(selectedOrder.purchased_at)} ·{" "}
                  {selectedOrder.status === "received"
                    ? "Đã nhập hàng"
                    : selectedOrder.status === "cancelled"
                      ? "Đã hủy"
                      : "Đợi duyệt"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                {canEditPurchaseOrder(selectedOrder) && (
                  <AppButton
                    variant="ghost"
                    type="button"
                    title="Chỉnh sửa đơn nhập"
                    aria-label="Chỉnh sửa đơn nhập"
                    disabled={busy}
                    onClick={() => void editOrder(selectedOrder)}
                  >
                    <Pencil size={16} />
                  </AppButton>
                )}
                <AppButton
                  variant="ghost"
                  type="button"
                  aria-label="Đóng chi tiết đơn nhập"
                  onClick={closePurchaseDetail}
                >
                  <X size={18} />
                </AppButton>
              </div>
            </div>
            <div className="table-wrap purchase-detail-table-wrap">
              <AppTable
                className={mergeClassNames(
                  "purchase-detail-table",
                  canViewCost ? "has-cost" : "without-cost",
                )}
              >
                <thead>
                  <tr>
                    <th>Hàng hóa</th>
                    <th>Số lượng</th>
                    {canViewCost && (
                      <>
                        <th>Giá nhập</th>
                        <th>Thành tiền</th>
                      </>
                    )}
                  </tr>
                  <tr className="table-summary-row">
                    <th>Tổng</th>
                    <th>
                      {formatQuantity(
                        selectedItems.reduce(
                          (sum, item) => sum + Number(item.quantity || 0),
                          0,
                        ),
                      )}
                    </th>
                    {canViewCost && (
                      <>
                        <th></th>
                        <th>
                          {formatVnd(
                            selectedItems.reduce(
                              (sum, item) => sum + Number(item.line_total || 0),
                              0,
                            ),
                          )}
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {detailLoading ? (
                    <tr>
                      <td colSpan={canViewCost ? 4 : 2}>
                        <LoadingSkeleton rows={2} />
                      </td>
                    </tr>
                  ) : (
                    selectedItems.map((item) => {
                      const productId =
                        item.product_id ||
                        products.find((product) => product.sku === item.sku)
                          ?.id;
                      const openProduct = () => {
                        if (!productId) return;
                        window.open(
                          productDetailsHrefForRoute(
                            isMobileRoute,
                            item.sku,
                            productId,
                          ),
                          "_blank",
                          "noopener,noreferrer",
                        );
                      };
                      return (
                        <tr
                          key={item.id}
                          className={
                            productId
                              ? "purchase-detail-product-row--clickable"
                              : undefined
                          }
                          tabIndex={productId ? 0 : undefined}
                          aria-label={
                            productId
                              ? `Mở hàng hóa ${item.product_name} trong tab mới`
                              : undefined
                          }
                          onClick={productId ? openProduct : undefined}
                          onKeyDown={(event) => {
                            if (
                              event.target !== event.currentTarget ||
                              !productId ||
                              (event.key !== "Enter" && event.key !== " ")
                            )
                              return;
                            event.preventDefault();
                            openProduct();
                          }}
                        >
                          <td>
                            {item.product_name}
                            <div className="muted" style={{ fontSize: 11 }}>
                              {item.sku}
                            </div>
                          </td>
                          <td>
                            {formatQuantity(Number(item.quantity))} {item.unit}
                          </td>
                          {canViewCost && (
                            <>
                              <td>{formatVnd(Number(item.unit_cost))}</td>
                              <td>{formatVnd(Number(item.line_total))}</td>
                            </>
                          )}
                        </tr>
                      );
                    })
                  )}
                  {!detailLoading && !selectedItems.length && (
                    <tr>
                      <td
                        colSpan={canViewCost ? 4 : 2}
                        className="muted"
                        style={{ textAlign: "center" }}
                      >
                        Đơn này chưa có hàng hóa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AppTable>
            </div>
            {error && (
              <div className="alert" style={{ marginTop: 12 }} role="alert">
                {error}
              </div>
            )}
            <div className="form-actions">
              <AppButton
                variant="secondary"

                onClick={closePurchaseDetail}
              >
                Đóng
              </AppButton>
              {canApprove && selectedOrder.status === "pending" && (
                <AppButton
                  variant="primary"

                  disabled={busy}
                  onClick={() => void receive(selectedOrder)}
                >
                  {busy ? "Đang duyệt…" : "Duyệt và nhập kho"}
                </AppButton>
              )}
            </div>
          </>
        )}
      </EntityDetailModal>
      <EntityDetailModal
        open={Boolean(detailModal.id && (!selectedOrder || editingOrderId))}
        onClose={closePurchaseDetail}
        panelClassName="purchase-detail-modal"
        ariaLabel="Chi tiết đơn nhập"
      >
        {editingOrderId ? (
          <p>Đang mở biểu mẫu chỉnh sửa…</p>
        ) : detailLoading && !error ? (
          <LoadingSkeleton rows={3} />
        ) : (
          <p className={error ? "alert" : "muted"}>
            {error || "Không tìm thấy đơn nhập hoặc không có quyền xem."}
          </p>
        )}
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
    </>
  );
}
