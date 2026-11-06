"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Boxes,
  Check,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "react-toastify";
import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { AppTextarea } from "@/components/app-textarea";
import { mergeClassNames } from "@/lib/class-names";
import {
  DataTable,
  type DataColumn,
  type DataTableSort,
} from "@/components/data-table";
import { DateRangeInput } from "@/components/date-range-input";
import { AppSelect } from "@/components/app-select";
import { FilterPanel } from "@/components/filter-panel";
import { MobileTableToolbarMetrics } from "@/components/mobile-table-toolbar-metrics";
import { SearchInputField } from "@/components/search-input-field";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { EntityDetailModal } from "@/components/entity-detail-modal";
import { ModalLayer } from "@/components/modal-layer";
import { useEntityDetailId } from "@/lib/use-entity-detail-id";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";
import { useInitialTableLoading } from "@/lib/use-initial-table-loading";
import { useDebounce } from "@/lib/debounce";
import {
  readPosSearchProducts,
  searchProductsLocally,
} from "@/lib/pos-search-cache";
import { productDetailsHrefForRoute } from "@/lib/management-navigation";
import { createClient } from "@/lib/data/client";
import { formatDateTime } from "@/lib/date";
import { printPage } from "@/lib/print-page";
import { formatQuantity, formatVnd } from "@/lib/format";
import { createCsv, downloadCsvFile } from "@/lib/csv-export";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import { useStoreBrand } from "@/components/store-brand-provider";

type StockCheckStatus = "draft" | "completed" | "cancelled";
type StockCheckRow = {
  id: string;
  stock_check_no: string;
  status: StockCheckStatus;
  note: string;
  created_at: string;
  actor_name: string;
  item_count: number;
  delta_total: number;
  value_delta_total: number | null;
};
type StockCheckProduct = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  unit_cost: number | null;
};
type StockCheckItem = {
  id?: string;
  product_id: string | null;
  sku: string;
  product_name: string;
  unit: string;
  stock_before: number | null;
  actual_stock: number | null;
  applied_delta: number;
  unit_cost: number | null;
  value_delta: number | null;
  sort_order: number;
};
type StockCheckDetail = StockCheckRow & {
  created_by: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  items: StockCheckItem[];
  events: { event_type: string; created_at: string; actor_name: string }[];
};
type DraftLine = {
  product: {
    product_id: string;
    sku: string;
    name: string;
    unit: string;
    stock_before: number | null;
    unit_cost: number | null;
  };
  actual: string;
};
type Permissions = {
  canList: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canComplete: boolean;
  canExport: boolean;
  canViewCost: boolean;
};

const defaultSort: DataTableSort = { key: "created_at", direction: "desc" };
const statuses: Record<StockCheckStatus, string> = {
  draft: "Lưu tạm",
  completed: "Đã hoàn thành",
  cancelled: "Đã hủy",
};

function requestId() {
  return crypto.randomUUID();
}

function numeric(value: number | null | undefined) {
  return Number(value || 0);
}

export function StockCheckManagement({
  permissions,
}: {
  permissions: Permissions;
}) {
  const pathname = usePathname();
  const { displayName } = useStoreBrand();
  const isMobile = pathname.startsWith("/mobile/");
  const detailModal = useEntityDetailId();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const {
    canList,
    canCreate,
    canUpdate,
    canDelete,
    canComplete,
    canExport,
    canViewCost,
  } = permissions;
  const [rows, setRows] = useState<StockCheckRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query);
  const [productFilterQuery, setProductFilterQuery] = useState("");
  const debouncedProductFilterQuery = useDebounce(productFilterQuery);
  const [productFilterIds, setProductFilterIds] = useState<string[]>([]);
  const [filterProducts, setFilterProducts] = useState<StockCheckProduct[]>([]);
  const [filterProductsError, setFilterProductsError] = useState("");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [status, setStatus] = useState<"all" | StockCheckStatus>("all");
  const [sort, setSort] = useState<DataTableSort>(defaultSort);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<StockCheckDetail | null>(null);
  const [detailLoadError, setDetailLoadError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formId, setFormId] = useState<string | null>(null);
  const [formNo, setFormNo] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const productQueryDebounced = useDebounce(productQuery);
  const [products, setProducts] = useState<StockCheckProduct[]>([]);
  const [cachedProducts, setCachedProducts] = useState<StockCheckProduct[]>([]);
  const [loadedProductQuery, setLoadedProductQuery] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<
    (() => Promise<void>) | null
  >(null);
  const { loading, finishInitialLoad } = useInitialTableLoading();
  const formRef = useRef<HTMLFormElement>(null);
  const openedStockCheckId = useRef<string | null>(null);
  const selectedProductQuery = useMemo(() => {
    const terms = productFilterIds
      .map((id) => filterProducts.find((product) => product.id === id))
      .filter((product): product is StockCheckProduct => Boolean(product))
      .map((product) => product.sku || product.name);
    // The existing RPC switches to item-only matching when it receives multiple terms.
    if (terms.length === 1) terms.push(terms[0]);
    return terms.join(",");
  }, [filterProducts, productFilterIds]);

  useEffect(() => {
    if (!canList) return;
    let active = true;
    void (async () => {
      try {
        const result = await supabase.rpc("get_stock_check_products", {
          p_query: debouncedProductFilterQuery,
        });
        if (result.error) throw result.error;
        if (!active) return;
        const loaded = (result.data || []) as StockCheckProduct[];
        setFilterProducts((current) => {
          const selectedIds = new Set(productFilterIds);
          const retained = current.filter((product) =>
            selectedIds.has(product.id),
          );
          const byId = new Map(
            retained.map((product) => [product.id, product]),
          );
          for (const product of loaded) byId.set(product.id, product);
          return [...byId.values()];
        });
        setFilterProductsError("");
      } catch (caught) {
        if (!active) return;
        setFilterProductsError(
          caught instanceof Error
            ? caught.message
            : "Không tải được danh sách hàng hóa để lọc.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [canList, debouncedProductFilterQuery, productFilterIds, supabase]);

  const load = useCallback(async () => {
    if (!canList) {
      finishInitialLoad();
      return;
    }
    try {
      const hasProductFilters = productFilterIds.length > 0;
      const hasTextFilter = Boolean(debouncedQuery.trim());
      if (productFilterIds.length && !selectedProductQuery) {
        throw new Error("Không tìm thấy mã hàng của mặt hàng đã chọn.");
      }
      const queryTerms =
        hasProductFilters && hasTextFilter
          ? [debouncedQuery, selectedProductQuery]
          : [hasProductFilters ? selectedProductQuery : debouncedQuery];
      // The existing RPC accepts one query at a time; intersect results to combine text and tags.
      const results = await Promise.all(
        queryTerms.map((p_query) =>
          supabase.rpc("get_stock_checks", {
            p_from: dateRange.from || null,
            p_to: dateRange.to || null,
            p_query,
            p_statuses: status === "all" ? [] : [status],
            p_sort: sort.key,
            p_direction: sort.direction,
            p_limit: 5000,
            p_offset: 0,
          }),
        ),
      );
      const resultData = results.map(({ data, error: loadError }) => {
        if (loadError) throw loadError;
        return data as { rows?: StockCheckRow[]; total?: number } | null;
      });
      let nextRows = resultData[0]?.rows || [];
      if (hasProductFilters && hasTextFilter) {
        const productMatches = new Set(
          (resultData[1]?.rows || []).map((row) => row.id),
        );
        nextRows = nextRows.filter((row) => productMatches.has(row.id));
      }
      setRows(nextRows);
      setTotal(
        hasProductFilters && hasTextFilter
          ? nextRows.length
          : Number(resultData[0]?.total || 0),
      );
      setError("");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Không tải được danh sách kiểm kho.";
      setError(message);
    } finally {
      finishInitialLoad();
    }
  }, [
    canList,
    dateRange,
    debouncedQuery,
    productFilterIds,
    selectedProductQuery,
    status,
    sort,
    supabase,
    finishInitialLoad,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const legacyId = params.get("stockCheckId");
    if (legacyId) {
      detailModal.replace(detailModal.id || legacyId, ["stockCheckId"]);
      return;
    }
    const id = detailModal.id;
    if (!id) {
      openedStockCheckId.current = null;
      return;
    }
    if (!canList) return;
    if (openedStockCheckId.current === id) return;
    let active = true;
    openedStockCheckId.current = id;
    void (async () => {
      const result = await supabase.rpc("get_stock_check", {
        p_stock_check_id: id,
      });
      if (!active) return;
      if (result.error) {
        setDetailLoadError({ id, message: result.error.message });
        toast.error(result.error.message);
      } else if (result.data) {
        setSelected(result.data as StockCheckDetail);
        setDetailLoadError(null);
      } else {
        setDetailLoadError({
          id,
          message: "Không tìm thấy phiếu kiểm kho hoặc không có quyền xem.",
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [canList, detailModal, supabase]);
  useEffect(() => {
    if (!formOpen) return;
    let active = true;
    void readPosSearchProducts(supabase)
      .then((cachedProducts) => {
        if (!active || !cachedProducts) return;
        const cachedOptions = cachedProducts
          .filter((product) => product.is_active && product.kind === "product")
          .map((product) => ({
            id: product.id,
            sku: product.sku,
            name: product.name,
            unit: product.unit,
            stock: product.stock,
            unit_cost:
              canViewCost && product.product_costs
                ? product.product_costs.cost
                : null,
          }));
        setCachedProducts(cachedOptions);
      })
      .catch(() => {
        // The local cache is an optional instant-search layer.
      });
    return () => {
      active = false;
    };
  }, [canViewCost, formOpen, supabase]);
  useEffect(() => {
    if (!formOpen) return;
    let active = true;
    void (async () => {
      try {
        const result = await supabase.rpc("get_stock_check_products", {
          p_query: productQueryDebounced,
        });
        if (!active) return;
        if (result.error) setError(result.error.message);
        else setProducts((result.data || []) as StockCheckProduct[]);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error ? caught.message : "Không tìm được hàng hóa.",
        );
      }
      if (active) setLoadedProductQuery(productQueryDebounced);
    })();
    return () => {
      active = false;
    };
  }, [formOpen, productQueryDebounced, supabase]);
  useDialogBehavior(isMobile && formOpen, formRef, () => setFormOpen(false));

  const pageSize = 50;
  const pageRows = useMemo(
    () => rows.slice(page * pageSize, (page + 1) * pageSize),
    [rows, page],
  );
  const deltaTotal = useMemo(
    () => rows.reduce((sum, row) => sum + numeric(row.delta_total), 0),
    [rows],
  );
  const valueTotal = useMemo(
    () => rows.reduce((sum, row) => sum + numeric(row.value_delta_total), 0),
    [rows],
  );

  function openDetail(row: StockCheckRow) {
    if (detailModal.id === row.id) return;
    setSelected(null);
    setDetailLoadError(null);
    detailModal.open(row.id);
  }

  function closeStockCheckDetail() {
    detailModal.close();
    setSelected(null);
    setDetailLoadError(null);
  }

  const activeSelected = selected?.id === detailModal.id ? selected : null;
  const productSearchLoading =
    productQuery !== productQueryDebounced ||
    loadedProductQuery !== productQueryDebounced;
  const visibleSearchProducts = useMemo(() => {
    const allProducts = new Map(
      cachedProducts.map((product) => [product.id, product]),
    );
    for (const product of products) allProducts.set(product.id, product);
    return searchProductsLocally(
      [...allProducts.values()].filter(
        (product) =>
          !lines.some((line) => line.product.product_id === product.id),
      ),
      productQuery,
    );
  }, [cachedProducts, lines, productQuery, products]);

  function productDetailHref(sku: string, productId: string) {
    return productDetailsHrefForRoute(isMobile, sku, productId);
  }

  function openProductInNewTab(sku: string, productId: string) {
    window.open(
      productDetailHref(sku, productId),
      "_blank",
      "noopener,noreferrer",
    );
  }

  function startCreate() {
    setSelected(null);
    setFormId(null);
    setFormNo("");
    setNote("");
    setLines([]);
    setProductQuery("");
    setError("");
    setFormOpen(true);
  }

  function updateQuery(value: string) {
    setPage(0);
    setQuery(value);
  }
  function updateStatus(value: typeof status) {
    setPage(0);
    setStatus(value);
  }
  function updateDateRange(from: string, to: string) {
    setPage(0);
    setDateRange({ from, to });
  }
  function updateSort(value: DataTableSort) {
    setPage(0);
    setSort(value);
  }

  async function startEdit(row: StockCheckRow) {
    const { data, error: detailError } = await supabase.rpc("get_stock_check", {
      p_stock_check_id: row.id,
    });
    if (detailError) {
      toast.error(detailError.message);
      return;
    }
    const detail = data as StockCheckDetail;
    if (
      detail.items.some((item) => !item.product_id || item.stock_before == null)
    ) {
      toast.error(
        "Phiếu lịch sử thiếu mặt hàng hoặc tồn kho làm mốc nên chỉ xem hoặc hủy được.",
      );
      return;
    }
    detailModal.close();
    setSelected(detail);
    setFormId(detail.id);
    setFormNo(detail.stock_check_no);
    setNote(detail.note || "");
    setLines(
      detail.items.map((item) => ({
        product: {
          product_id: item.product_id || "",
          sku: item.sku,
          name: item.product_name,
          unit: item.unit,
          stock_before: item.stock_before,
          unit_cost: item.unit_cost,
        },
        actual: item.actual_stock == null ? "" : String(item.actual_stock),
      })),
    );
    setProductQuery("");
    setError("");
    setFormOpen(true);
  }

  function addProduct(product: StockCheckProduct) {
    if (lines.some((line) => line.product.product_id === product.id)) return;
    setLines((current) => [
      ...current,
      {
        product: {
          product_id: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          stock_before: product.stock,
          unit_cost: product.unit_cost,
        },
        actual: "",
      },
    ]);
    setProductQuery("");
  }

  async function save(action: "draft" | "complete") {
    if (busy) return;
    if (!formId && !canCreate) return;
    if (formId && !canUpdate) return;
    if (action === "complete" && !canComplete) return;
    if (
      action === "complete" &&
      (!lines.length ||
        lines.some(
          (line) =>
            line.actual.trim() === "" ||
            !Number.isFinite(Number(line.actual)) ||
            Number(line.actual) < 0,
        ))
    ) {
      setError(
        "Nhập số lượng thực tế hợp lệ cho tất cả hàng hóa trước khi hoàn thành.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = lines.map((line, index) => ({
        product_id: line.product.product_id,
        actual_stock: line.actual.trim() === "" ? null : Number(line.actual),
        sort_order: index,
      }));
      const { data, error: saveError } = await supabase.rpc(
        "save_stock_check",
        {
          p_stock_check_id: formId,
          p_note: note,
          p_items: payload,
          p_action: action,
          p_request_id: requestId(),
        },
      );
      if (saveError) throw saveError;
      setFormOpen(false);
      setSelected(null);
      toast.success(
        action === "draft"
          ? "Đã lưu tạm phiếu kiểm kho."
          : "Đã hoàn thành phiếu kiểm kho và cập nhật tồn.",
      );
      if (action === "complete")
        await queryClient.invalidateQueries({ queryKey: ["pos-products"] });
      await load();
      if (canList && data) {
        const { data: detail } = await supabase.rpc("get_stock_check", {
          p_stock_check_id: data,
        });
        if (detail) {
          setSelected(detail as StockCheckDetail);
          detailModal.open(String(data));
        }
      }
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Không lưu được phiếu kiểm kho.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function removeDraft(row: StockCheckRow) {
    setConfirmAction(() => async () => {
      setBusy(true);
      const { error: deleteError } = await supabase.rpc("delete_stock_check", {
        p_stock_check_id: row.id,
        p_request_id: requestId(),
      });
      setBusy(false);
      if (deleteError) toast.error(deleteError.message);
      else {
        toast.success("Đã xóa phiếu tạm.");
        await load();
      }
      setConfirmRequest(null);
    });
    setConfirmRequest({
      title: "Xóa phiếu tạm?",
      message: `Xóa ${row.stock_check_no}?`,
      confirmLabel: "Xóa phiếu",
    });
  }

  function cancelCompleted(row: StockCheckRow) {
    setConfirmAction(() => async () => {
      setBusy(true);
      const { error: cancelError } = await supabase.rpc("cancel_stock_check", {
        p_stock_check_id: row.id,
        p_request_id: requestId(),
      });
      setBusy(false);
      if (cancelError) toast.error(cancelError.message);
      else {
        toast.success("Đã hủy phiếu và hoàn lại chênh lệch vào tồn hiện tại.");
        await queryClient.invalidateQueries({ queryKey: ["pos-products"] });
        await load();
      }
      setConfirmRequest(null);
    });
    setConfirmRequest({
      title: "Hủy phiếu kiểm kho?",
      message: `Hủy ${row.stock_check_no} sẽ đảo chênh lệch đã áp dụng vào tồn hiện tại.`,
      confirmLabel: "Hủy phiếu",
    });
  }

  async function exportRows() {
    if (!canExport || exporting) return;
    setExporting(true);
    try {
      const columns = [
        {
          key: "stock_check_no",
          label: "Mã phiếu",
          read: (row: StockCheckRow) => row.stock_check_no,
        },
        {
          key: "created_at",
          label: "Ngày tạo",
          read: (row: StockCheckRow) => formatDateTime(row.created_at),
        },
        {
          key: "status",
          label: "Trạng thái",
          read: (row: StockCheckRow) => statuses[row.status],
        },
        {
          key: "actor_name",
          label: "Người tạo",
          read: (row: StockCheckRow) => row.actor_name,
        },
        {
          key: "item_count",
          label: "Số mặt hàng",
          read: (row: StockCheckRow) => row.item_count,
        },
        {
          key: "delta_total",
          label: "Tổng SL lệch",
          read: (row: StockCheckRow) => row.delta_total,
        },
        ...(canViewCost
          ? [
              {
                key: "value_delta_total",
                label: "Tổng giá trị lệch",
                read: (row: StockCheckRow) => row.value_delta_total ?? "",
              },
            ]
          : []),
        {
          key: "note",
          label: "Ghi chú",
          read: (row: StockCheckRow) => row.note,
        },
      ];
      downloadCsvFile("kiem-kho.csv", createCsv(columns, rows));
      toast.success(
        `Đã xuất ${rows.length} phiếu. ${total > rows.length ? `Danh sách vượt giới hạn 5.000 dòng; tổng có ${total} phiếu.` : ""}`,
      );
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Không xuất được dữ liệu kiểm kho.",
      );
    } finally {
      setExporting(false);
    }
  }

  function exportDetail() {
    if (!canExport || !selected) return;
    const columns = [
      {
        key: "sku",
        label: "Mã hàng",
        read: (item: StockCheckItem) => item.sku,
      },
      {
        key: "product_name",
        label: "Tên hàng",
        read: (item: StockCheckItem) => item.product_name,
      },
      { key: "unit", label: "ĐVT", read: (item: StockCheckItem) => item.unit },
      {
        key: "stock_before",
        label: "Tồn kho",
        read: (item: StockCheckItem) => item.stock_before ?? "",
      },
      {
        key: "actual_stock",
        label: "Thực tế",
        read: (item: StockCheckItem) => item.actual_stock ?? "",
      },
      {
        key: "applied_delta",
        label: "SL lệch",
        read: (item: StockCheckItem) => item.applied_delta,
      },
      ...(canViewCost
        ? [
            {
              key: "value_delta",
              label: "Giá trị lệch",
              read: (item: StockCheckItem) => item.value_delta ?? "",
            },
          ]
        : []),
    ];
    downloadCsvFile(
      `${selected.stock_check_no}.csv`,
      createCsv(columns, selected.items),
    );
  }

  const columns: DataColumn<StockCheckRow>[] = [
    {
      key: "stock_check_no",
      label: "Mã phiếu",
      value: (row) => row.stock_check_no,
      render: (row) => (
        <AppButton
          variant="ghost"
          className="stock-check-link"
          type="button"
          onClick={() => void openDetail(row)}
        >
          {row.stock_check_no}
        </AppButton>
      ),
    },
    {
      key: "created_at",
      label: "Ngày tạo",
      value: (row) => row.created_at,
      render: (row) => formatDateTime(row.created_at),
    },
    { key: "actor_name", label: "Người tạo", render: (row) => row.actor_name },
    {
      key: "status",
      label: "Trạng thái",
      value: (row) => row.status,
      render: (row) => (
        <span
          className={mergeClassNames(
            "stock-check-status",
            `stock-check-status--${row.status}`,
          )}
        >
          {statuses[row.status]}
        </span>
      ),
    },
    {
      key: "item_count",
      label: "Mặt hàng",
      align: "right",
      render: (row) => formatQuantity(row.item_count),
    },
    {
      key: "delta_total",
      label: "SL lệch",
      align: "right",
      render: (row) => formatQuantity(row.delta_total),
    },
    ...(canViewCost
      ? [
          {
            key: "value_delta_total",
            label: "Giá trị lệch",
            value: (row: StockCheckRow) => row.value_delta_total,
            align: "right" as const,
            render: (row: StockCheckRow) =>
              row.value_delta_total == null
                ? "—"
                : formatVnd(row.value_delta_total),
          },
        ]
      : []),
    {
      key: "actions",
      label: "Thao tác",
      hideable: false,
      render: (row) => (
        <div className="stock-check-actions">
          {row.status === "draft" && canUpdate && canComplete && (
            <AppButton
              variant="primary"
              type="button"
              aria-label={`Hoàn thành ${row.stock_check_no}`}
              onClick={() => void startEdit(row)}
            >
              <Check size={15} />
            </AppButton>
          )}
          {row.status === "draft" && canDelete && (
            <AppButton
              variant="danger"
              type="button"
              aria-label={`Xóa ${row.stock_check_no}`}
              onClick={() => removeDraft(row)}
            >
              <Trash2 size={15} />
            </AppButton>
          )}
          {row.status === "completed" && canDelete && canComplete && (
            <AppButton
              variant="danger"
              type="button"
              aria-label={`Hủy ${row.stock_check_no}`}
              onClick={() => cancelCompleted(row)}
            >
              <X size={15} />
            </AppButton>
          )}
        </div>
      ),
    },
  ];

  if (loading && canList) return <LoadingSkeleton rows={8} />;

  return (
    <>
      {activeSelected && !formOpen && (
        <article className="print-only stock-check-print">
          <header className="stock-check-print__header">
            <strong>{displayName}</strong>
            <h1>Phiếu kiểm kho {activeSelected.stock_check_no}</h1>
            <p>
              {formatDateTime(activeSelected.created_at)} ·{" "}
              {statuses[activeSelected.status]} · {activeSelected.actor_name}
            </p>
            {activeSelected.note && <p>Ghi chú: {activeSelected.note}</p>}
          </header>
          <table>
            <thead>
              <tr>
                <th>STT</th>
                <th>Mã hàng</th>
                <th>Tên hàng</th>
                <th>ĐVT</th>
                <th>Tồn kho</th>
                <th>Thực tế</th>
                <th>SL lệch</th>
                {canViewCost && <th>Giá trị lệch</th>}
              </tr>
            </thead>
            <tbody>
              {activeSelected.items.map((item, index) => (
                <tr key={item.id || `${item.sku}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{item.sku}</td>
                  <td>{item.product_name}</td>
                  <td>{item.unit}</td>
                  <td>
                    {item.stock_before == null
                      ? "—"
                      : formatQuantity(item.stock_before)}
                  </td>
                  <td>
                    {item.actual_stock == null
                      ? "—"
                      : formatQuantity(item.actual_stock)}
                  </td>
                  <td>{formatQuantity(item.applied_delta)}</td>
                  {canViewCost && (
                    <td>
                      {item.value_delta == null
                        ? "—"
                        : formatVnd(item.value_delta)}
                    </td>
                  )}
                </tr>
              ))}
              {!activeSelected.items.length && (
                <tr>
                  <td colSpan={canViewCost ? 8 : 7}>Phiếu chưa có mặt hàng.</td>
                </tr>
              )}
            </tbody>
          </table>
        </article>
      )}
      <div className="page-heading">
        <div>
          <h1>Kiểm kho</h1>
          <p>Đối chiếu tồn thực tế và lưu lịch sử chênh lệch hàng hóa.</p>
        </div>
        <div className="stock-check-heading-actions">
          {canExport && (
            <AppButton
              variant="default"
              type="button"
              aria-label="Xuất dữ liệu"
              disabled={exporting || !rows.length}
              onClick={() => void exportRows()}
            >
              {exporting ? "Đang xuất…" : "Xuất dữ liệu"}
            </AppButton>
          )}
          {canCreate && (
            <AppButton
              variant="primary"
              type="button"
              aria-label="Tạo phiếu kiểm kho"
              onClick={startCreate}
            >
              <Plus size={16} />
              <span className="mobile-button-label">Tạo phiếu kiểm kho</span>
            </AppButton>
          )}
        </div>
      </div>
      {error && !formOpen && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {canList ? (
        <div className="stock-check-workspace">
          <FilterPanel
            className="stock-check-filter"
            ariaLabel="Bộ lọc phiếu kiểm kho"
            icon={<Boxes size={17} />}
          >
            <div className="stock-check-filter-grid">
              <label className="filter-group">
                <span>Ngày tạo phiếu</span>
                <DateRangeInput
                  start={dateRange.from}
                  end={dateRange.to}
                  onChange={updateDateRange}
                  ariaLabel="Lọc phiếu kiểm kho theo ngày"
                />
              </label>
              <label className="filter-group stock-check-filter-field">
                <span>Mã phiếu, ghi chú hoặc người tạo</span>
                <SearchInputField
                  value={query}
                  onChange={updateQuery}
                  onClear={() => updateQuery("")}
                  placeholder="Nhập từ khóa tìm kiếm"
                  aria-label="Tìm theo mã phiếu, ghi chú hoặc người tạo"
                  showSearchIcon={false}
                />
              </label>
              <label className="filter-group stock-check-product-filter">
                <span>Tìm hàng hóa</span>
                <AppSelect
                  ariaLabel="Lọc phiếu theo hàng hóa"
                  isMulti
                  isSearchable
                  options={filterProducts.map((product) => ({
                    value: product.id,
                    label: product.sku
                      ? `${product.sku} · ${product.name}`
                      : product.name,
                  }))}
                  value={productFilterIds}
                  onChange={(ids) => {
                    setPage(0);
                    setProductFilterIds(ids);
                  }}
                  onSearchInputChange={setProductFilterQuery}
                  placeholder="Tìm mã hoặc tên hàng hóa"
                />
                <small className="stock-check-filter-hint">
                  Phiếu phải có đủ tất cả mặt hàng đã chọn.
                </small>
                {filterProductsError && (
                  <small className="stock-check-filter-error" role="alert">
                    {filterProductsError}
                  </small>
                )}
              </label>
              <label className="filter-group">
                <span>Trạng thái</span>
                <AppSelect
                  ariaLabel="Lọc trạng thái phiếu kiểm kho"
                  value={status}
                  options={[
                    { value: "all", label: "Tất cả" },
                    { value: "draft", label: "Lưu tạm" },
                    { value: "completed", label: "Đã hoàn thành" },
                    { value: "cancelled", label: "Đã hủy" },
                  ]}
                  onChange={(next) => updateStatus(next as typeof status)}
                />
              </label>
            </div>
            <AppButton
              variant="ghost"
              className="filter-reset"
              onClick={() => {
                updateDateRange("", "");
                updateQuery("");
                setProductFilterIds([]);
                setProductFilterQuery("");
                updateStatus("all");
              }}
            >
              Xóa bộ lọc
            </AppButton>
          </FilterPanel>
          <section className="card stock-check-results">
            <MobileTableToolbarMetrics
              metrics={[
                { label: "Số phiếu", value: formatQuantity(total) },
                { label: "Tổng SL lệch", value: formatQuantity(deltaTotal) },
                ...(canViewCost
                  ? [{ label: "Giá trị lệch", value: formatVnd(valueTotal) }]
                  : []),
              ]}
            />
            <div className="stock-check-table-wrap">
              <DataTable
                rows={pageRows}
                columns={columns}
                rowKey={(row) => row.id}
                empty={
                  error ? (
                    <p className="muted">Không tải được phiếu kiểm kho.</p>
                  ) : (
                    <p className="muted">Chưa có phiếu kiểm kho phù hợp.</p>
                  )
                }
                storageKey="stock-checks"
                title="Danh sách phiếu kiểm kho"
                toolbarSummary={<span>{formatQuantity(total)} phiếu</span>}
                serverSort={{ value: sort, onChange: updateSort }}
                totalRows={total}
                onRowClick={(row) => void openDetail(row)}
                activeRowId={detailModal.activeId}
              />
              {rows.length > pageSize && (
                <div className="stock-check-pagination">
                  <AppButton
                    variant="default"
                    type="button"
                    disabled={page === 0}
                    onClick={() =>
                      setPage((current) => Math.max(current - 1, 0))
                    }
                  >
                    Trước
                  </AppButton>
                  <span>
                    {page + 1} / {Math.ceil(rows.length / pageSize)}
                  </span>
                  <AppButton
                    variant="default"
                    type="button"
                    disabled={(page + 1) * pageSize >= rows.length}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Sau
                  </AppButton>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="card stock-check-create-only">
          <p>Bạn được cấp quyền tạo phiếu kiểm kho.</p>
        </div>
      )}

      {formOpen && (
        <ModalLayer
          className="modal-backdrop stock-check-modal-backdrop"
          onEscape={() => {
            if (!busy) setFormOpen(false);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy)
              setFormOpen(false);
          }}
        >
          <form
            ref={formRef}
            className="modal card stock-check-form"
            role="dialog"
            aria-modal="true"
            aria-label={formId ? `Sửa ${formNo}` : "Tạo phiếu kiểm kho"}
            onSubmit={(event) => {
              event.preventDefault();
              void save(
                formId && selected?.status === "completed"
                  ? "complete"
                  : "draft",
              );
            }}
          >
            <div className="modal-title">
              <div>
                <h2>{formNo || "Phiếu kiểm kho mới"}</h2>
                <p className="muted">
                  {formId && selected
                    ? `${formatDateTime(selected.created_at)} · ${statuses[selected.status]}`
                    : "Nhập số lượng thực tế của từng mặt hàng."}
                </p>
              </div>
              <AppButton
                variant="ghost"
                type="button"
                aria-label="Đóng"
                disabled={busy}
                onClick={() => setFormOpen(false)}
              >
                <X size={18} />
              </AppButton>
            </div>
            <div className="stock-check-product-search">
              <label htmlFor="stock-check-product-search">Tìm hàng hóa</label>
              <SearchInputField
                id="stock-check-product-search"
                value={productQuery}
                onChange={setProductQuery}
                onClear={() => setProductQuery("")}
                placeholder="Tìm theo mã hoặc tên hàng"
                aria-label="Tìm hàng hóa để kiểm kho"
              />
              {!!productQuery.trim() && (
                <div
                  className="stock-check-product-results"
                  role="listbox"
                  aria-label="Kết quả hàng hóa"
                >
                  {visibleSearchProducts.map((product) => (
                    <AppButton
                      variant="ghost"
                      key={product.id}
                      type="button"
                      role="option"
                      onClick={() => addProduct(product)}
                    >
                      <span>
                        <strong>{product.name}</strong>
                        <small>
                          {product.sku} · {product.unit}
                        </small>
                      </span>
                      <span>Tồn: {formatQuantity(product.stock)}</span>
                    </AppButton>
                  ))}
                  {!visibleSearchProducts.length && (
                    <p className="muted">
                      {productSearchLoading
                        ? "Đang tìm hàng hóa…"
                        : "Không tìm thấy hàng hóa."}
                    </p>
                  )}
                </div>
              )}
            </div>
            <label className="stock-check-note">
              <span>Ghi chú</span>
              <AppTextarea
                noBorder
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Ghi chú cho phiếu kiểm kho"
              />
            </label>
            <div className="stock-check-lines-scroll">
              <table className="stock-check-lines">
                <thead>
                  <tr>
                    <th>STT</th>
                    <th>Mã hàng</th>
                    <th>Tên hàng</th>
                    <th>ĐVT</th>
                    <th>Tồn kho</th>
                    <th>Thực tế</th>
                    <th>SL lệch</th>
                    {canViewCost && <th>Giá trị lệch</th>}
                    <th aria-label="Xóa mặt hàng" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const before = line.product.stock_before;
                    const actual =
                      line.actual.trim() === "" ? null : Number(line.actual);
                    const delta =
                      actual == null || before == null
                        ? null
                        : actual - Number(before);
                    const cost = line.product.unit_cost;
                    return (
                      <tr
                        key={line.product.product_id || line.product.sku}
                        className={
                          line.product.product_id
                            ? "stock-check-product-row--clickable"
                            : undefined
                        }
                        tabIndex={line.product.product_id ? 0 : undefined}
                        aria-label={
                          line.product.product_id
                            ? `Mở hàng hóa ${line.product.name} trong tab mới`
                            : undefined
                        }
                        onClick={(event) => {
                          if (!line.product.product_id) return;
                          if (
                            event.target instanceof Element &&
                            event.target.closest(
                              "button, a, input, select, textarea",
                            )
                          )
                            return;
                          openProductInNewTab(
                            line.product.sku,
                            line.product.product_id,
                          );
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.target !== event.currentTarget ||
                            !line.product.product_id ||
                            (event.key !== "Enter" && event.key !== " ")
                          )
                            return;
                          event.preventDefault();
                          openProductInNewTab(
                            line.product.sku,
                            line.product.product_id,
                          );
                        }}
                      >
                        <td>{index + 1}</td>
                        <td>{line.product.sku}</td>
                        <td>{line.product.name}</td>
                        <td>{line.product.unit}</td>
                        <td className="number-cell">
                          {before == null ? "—" : formatQuantity(before)}
                        </td>
                        <td>
                          <AppInput
                            type="number"
                            min="0"
                            step="0.001"
                            inputMode="decimal"
                            aria-label={`Số lượng thực tế ${line.product.name}`}
                            value={line.actual}
                            onChange={(event) =>
                              setLines((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, actual: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            placeholder="Nhập số lượng"
                          />
                        </td>
                        <td className="number-cell">
                          {delta == null ? "—" : formatQuantity(delta)}
                        </td>
                        {canViewCost && (
                          <td className="number-cell">
                            {delta == null || cost == null
                              ? "—"
                              : formatVnd(delta * cost)}
                          </td>
                        )}
                        <td>
                          <AppButton
                            variant="ghost"
                            type="button"
                            aria-label={`Xóa ${line.product.name}`}
                            onClick={() =>
                              setLines((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                          >
                            <Trash2 size={15} />
                          </AppButton>
                        </td>
                      </tr>
                    );
                  })}
                  {!lines.length && (
                    <tr>
                      <td colSpan={canViewCost ? 9 : 8} className="muted">
                        Tìm và chọn hàng hóa để bắt đầu kiểm kho.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {formId && selected?.status === "completed" && (
              <p className="stock-check-concurrency-note">
                Khi hoàn thành lại, chỉ phần chênh lệch thay đổi sẽ cộng hoặc
                trừ vào tồn hiện tại. Giao dịch phát sinh sau lần kiểm trước
                được giữ nguyên.
              </p>
            )}
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <div className="stock-check-form-footer">
              {(!formId || selected?.status === "draft") && (
                <AppButton
                  variant="default"
                  type="button"
                  disabled={
                    busy ||
                    (!formId && !canCreate) ||
                    (Boolean(formId) && !canUpdate)
                  }
                  onClick={() => void save("draft")}
                >
                  {busy ? "Đang lưu…" : "Lưu tạm"}
                </AppButton>
              )}
              <AppButton
                variant="primary"
                type="button"
                disabled={
                  busy ||
                  !canComplete ||
                  (!formId && !canCreate) ||
                  (Boolean(formId) && !canUpdate)
                }
                onClick={() => void save("complete")}
              >
                {busy
                  ? "Đang lưu…"
                  : formId && selected?.status === "completed"
                    ? "Lưu thay đổi"
                    : "Hoàn thành"}
              </AppButton>
            </div>
          </form>
        </ModalLayer>
      )}

      <EntityDetailModal
        open={Boolean(detailModal.id && activeSelected && !formOpen)}
        onClose={closeStockCheckDetail}
        className="stock-check-modal-backdrop"
        panelClassName="stock-check-detail"
        ariaLabel={`Chi tiết ${activeSelected?.stock_check_no || "phiếu kiểm kho"}`}
      >
        {selected && selected.id === detailModal.id && !formOpen && (
          <>
            <div className="modal-title">
              <div>
                <h2>{selected.stock_check_no}</h2>
                <p className="muted">
                  {formatDateTime(selected.created_at)} ·{" "}
                  {statuses[selected.status]} · {selected.actor_name}
                </p>
              </div>
              <div className="stock-check-detail-header-actions">
                {selected.status !== "cancelled" &&
                  canUpdate &&
                  (selected.status === "draft" || canComplete) && (
                    <AppButton
                      variant="ghost"
                      iconOnly
                      type="button"
                      title="Sửa phiếu"
                      aria-label="Sửa phiếu kiểm kho"
                      onClick={() => void startEdit(selected)}
                    >
                      <Pencil size={16} />
                    </AppButton>
                  )}
                {selected.status === "completed" &&
                  canDelete &&
                  canComplete && (
                    <AppButton
                      variant="danger"
                      iconOnly
                      type="button"
                      title="Hủy phiếu"
                      aria-label="Hủy phiếu kiểm kho"
                      onClick={() => cancelCompleted(selected)}
                    >
                      <Ban size={16} />
                    </AppButton>
                  )}
                <AppButton
                  variant="ghost"
                  iconOnly
                  type="button"
                  aria-label="Đóng"
                  onClick={closeStockCheckDetail}
                >
                  <X size={18} />
                </AppButton>
              </div>
            </div>
            {selected.note && (
              <p className="stock-check-detail-note">{selected.note}</p>
            )}
            <div className="stock-check-lines-scroll">
              <table className="stock-check-lines">
                <thead>
                  <tr>
                    <th>STT</th>
                    <th>Mã hàng</th>
                    <th>Tên hàng</th>
                    <th>ĐVT</th>
                    <th>Tồn kho</th>
                    <th>Thực tế</th>
                    <th>SL lệch</th>
                    {canViewCost && <th>Giá trị lệch</th>}
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((item, index) => (
                    <tr
                      key={item.id || `${item.sku}-${index}`}
                      className={
                        item.product_id
                          ? "stock-check-product-row--clickable"
                          : undefined
                      }
                      tabIndex={item.product_id ? 0 : undefined}
                      aria-label={
                        item.product_id
                          ? `Mở hàng hóa ${item.product_name} trong tab mới`
                          : undefined
                      }
                      onClick={() => {
                        if (!item.product_id) return;
                        openProductInNewTab(item.sku, item.product_id);
                      }}
                      onKeyDown={(event) => {
                        if (
                          !item.product_id ||
                          (event.key !== "Enter" && event.key !== " ")
                        )
                          return;
                        event.preventDefault();
                        openProductInNewTab(item.sku, item.product_id);
                      }}
                    >
                      <td>{index + 1}</td>
                      <td>{item.sku}</td>
                      <td>{item.product_name}</td>
                      <td>{item.unit}</td>
                      <td>
                        {item.stock_before == null
                          ? "—"
                          : formatQuantity(item.stock_before)}
                      </td>
                      <td>
                        {item.actual_stock == null
                          ? "—"
                          : formatQuantity(item.actual_stock)}
                      </td>
                      <td>{formatQuantity(item.applied_delta)}</td>
                      {canViewCost && (
                        <td>
                          {item.value_delta == null
                            ? "—"
                            : formatVnd(item.value_delta)}
                        </td>
                      )}
                    </tr>
                  ))}
                  {!selected.items.length && (
                    <tr>
                      <td colSpan={canViewCost ? 8 : 7} className="muted">
                        Phiếu chưa có mặt hàng.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {selected.events.length > 0 && (
              <div className="stock-check-history">
                <h3>Lịch sử thao tác</h3>
                {selected.events.map((event, index) => (
                  <p key={`${event.created_at}-${index}`}>
                    {formatDateTime(event.created_at)} · {event.actor_name} ·{" "}
                    {event.event_type === "imported"
                      ? "Chuyển từ lịch sử điều chỉnh tồn kho"
                      : event.event_type === "cancelled"
                        ? "Hủy phiếu"
                        : event.event_type === "completed"
                          ? "Hoàn thành phiếu"
                          : event.event_type === "created"
                            ? "Tạo phiếu"
                            : "Cập nhật phiếu"}
                  </p>
                ))}
              </div>
            )}
            <div className="stock-check-detail-footer">
              <AppButton variant="secondary" type="button" onClick={printPage}>
                <span className="stock-check-detail-footer-label">
                  <Printer size={15} aria-hidden="true" />
                  In phiếu
                </span>
              </AppButton>
              {canExport && (
                <AppButton
                  variant="default"
                  type="button"
                  onClick={exportDetail}
                >
                  Xuất chi tiết
                </AppButton>
              )}
            </div>
          </>
        )}
      </EntityDetailModal>
      <EntityDetailModal
        open={Boolean(detailModal.id && !activeSelected && !formOpen)}
        onClose={closeStockCheckDetail}
        className="stock-check-modal-backdrop"
        panelClassName="stock-check-detail"
        ariaLabel="Chi tiết phiếu kiểm kho"
      >
        {!canList ? (
          <p className="alert">
            Tài khoản không có quyền xem phiếu kiểm kho này.
          </p>
        ) : detailModal.id && detailLoadError?.id === detailModal.id ? (
          <p className="alert">{detailLoadError.message}</p>
        ) : (
          <LoadingSkeleton rows={4} />
        )}
      </EntityDetailModal>
      <ConfirmDialog
        request={confirmRequest}
        onCancel={() => setConfirmRequest(null)}
        onConfirm={() => void confirmAction?.()}
      />
    </>
  );
}
