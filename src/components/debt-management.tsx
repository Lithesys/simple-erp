"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Settings2, Pencil, Trash2, X } from "lucide-react";
import { toast } from "react-toastify";
import { useDebounce } from "@/lib/debounce";
import { createClient } from "@/lib/data/client";
import { todayLocal } from "@/lib/format";
import { formatQuantity } from "@/lib/format";
import { AppButton } from "@/components/app-button";
import { AppBadge } from "@/components/app-badge";
import { AppInput } from "@/components/app-input";
import { AppPagination } from "@/components/app-pagination";
import { AppSelect, type AppSelectOption } from "@/components/app-select";
import {
  DataExportFieldModal,
  DataExportMenu,
  type DataExportFieldGroup,
} from "@/components/data-export-controls";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import {
  CustomerPicker,
  type CustomerContact,
} from "@/components/customer-picker";
import { DataTable, type DataTableSort } from "@/components/data-table";
import { EntityDetailModal } from "@/components/entity-detail-modal";
import { ModalLayer } from "@/components/modal-layer";
import { MobileTableToolbarMetrics } from "@/components/mobile-table-toolbar-metrics";
import { DateRangeInput } from "@/components/date-range-input";
import { InlineEditField } from "@/components/inline-edit-field";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { NumberInputField } from "@/components/number-input-field";
import { SearchInputField } from "@/components/search-input-field";
import { useInitialTableLoading } from "@/lib/use-initial-table-loading";
import { useEntityDetailId } from "@/lib/use-entity-detail-id";
import type { DataColumn } from "@/components/data-table";
import { AppTable } from "@/components/app-table";
import { currentMonthDateRange, type DateRange } from "@/lib/debt-date-range";
import { usePreference } from "@/lib/preferences";
import { createCsv, downloadCsvFile } from "@/lib/csv-export";
import { useStableCallback } from "@/lib/use-stable-callback";
import { changedFieldPatch } from "@/lib/partial-update";

type DebtRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  debt_item: string;
  quantity: number;
  debt_date: string;
  paid_date: string | null;
  total_rows: number;
  total_quantity: number;
};
type DebtDetail = Pick<
  DebtRow,
  | "id"
  | "customer_id"
  | "customer_name"
  | "debt_item"
  | "quantity"
  | "debt_date"
  | "paid_date"
>;

type DebtItem = { id: string; name: string };

const pageSize = 20;
const initialSort: DataTableSort = { key: "debt_date", direction: "desc" };
const lastItemStorageKey = "debts.last-item";
const createDebtItemOption = "__create_debt_item__";
const allDebtItemsOption = "__all_debt_items__";

function formatDebtDate(value: string | null) {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function parseInlineDate(value: string, allowEmpty: boolean) {
  const trimmed = value.trim();
  if (!trimmed && allowEmpty) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  const year = Number(iso?.[1] ?? local?.[3]);
  const month = Number(iso?.[2] ?? local?.[2]);
  const day = Number(iso?.[3] ?? local?.[1]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  )
    throw new Error("Ngày không hợp lệ. Nhập theo dạng DD/MM/YYYY.");
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function DebtManagement({
  canRead,
  canCreate,
  canUpdate,
  canDelete,
  canReport,
}: {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canReport: boolean;
}) {
  const supabase = createClient();
  const detailModal = useEntityDetailId();
  const [rows, setRows] = useState<DebtRow[]>([]);
  const [debtTypes, setDebtTypes] = useState<DebtItem[]>([]);
  const [debtItems, setDebtItems] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [savedSort, setSort] = useState<DataTableSort>(initialSort);
  const sort = savedSort;
  const [total, setTotal] = useState(0);
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query);
  const [status, setStatus] = useState("all");
  const [dateRange, setDateRange, dateRangeReady] = usePreference<DateRange>(
    "debts.date-range",
    currentMonthDateRange(),
  );
  const [filterCustomer, setFilterCustomer] = useState<CustomerContact>({
    id: "",
    name: "",
    phone: "",
    address: "",
  });
  const [filterItem, setFilterItem] = useState("");
  const [quickCustomer, setQuickCustomer] = useState<CustomerContact>({
    id: "",
    name: "",
    phone: "",
    address: "",
  });
  const [quickItem, setQuickItem] = useState("");
  const [quickQuantity, setQuickQuantity] = useState("");
  const [quickDebtDate, setQuickDebtDate] = useState(todayLocal());
  const quickCustomerInputRef = useRef<HTMLInputElement>(null);
  const quickQuantityInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<DebtRow | null>(null);
  const [viewingDebt, setViewingDebt] = useState<DebtDetail | null>(null);
  const [detailLoadError, setDetailLoadError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [editCustomer, setEditCustomer] = useState<CustomerContact>({
    id: "",
    name: "",
    phone: "",
    address: "",
  });
  const [editItem, setEditItem] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editDebtDate, setEditDebtDate] = useState("");
  const [editPaidDate, setEditPaidDate] = useState("");
  const [createTypeSource, setCreateTypeSource] = useState<
    "quick" | "filter" | null
  >(null);
  const [newTypeName, setNewTypeName] = useState("");
  const [typeManagerOpen, setTypeManagerOpen] = useState(false);
  const [typeDrafts, setTypeDrafts] = useState<Record<string, string>>({});
  const [savingTypeId, setSavingTypeId] = useState<string | null>(null);
  const [typeBusy, setTypeBusy] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const confirmAction = useRef<(() => Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [detailExportOpen, setDetailExportOpen] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    const id = detailModal.id;
    if (!id || !(canRead || canUpdate || canDelete)) return;
    let active = true;
    void (async () => {
      try {
        const debtResult = await supabase
          .from("debts")
          .select("id,customer_id,debt_item,quantity,debt_date,paid_date")
          .eq("id", id)
          .maybeSingle();
        if (!active) return;
        if (debtResult.error || !debtResult.data) {
          setDetailLoadError({
            id,
            message: debtResult.error?.message ?? "Không tìm thấy khoản nợ.",
          });
          return;
        }
        const customerResult = await supabase
          .from("customers")
          .select("name")
          .eq("id", debtResult.data.customer_id)
          .maybeSingle();
        if (!active) return;
        if (customerResult.error) {
          setDetailLoadError({ id, message: customerResult.error.message });
          return;
        }
        setViewingDebt({
          ...debtResult.data,
          quantity: Number(debtResult.data.quantity),
          customer_name: customerResult.data?.name ?? "",
        });
      } catch (caught) {
        if (!active) return;
        setDetailLoadError({
          id,
          message:
            caught instanceof Error
              ? caught.message
              : "Không tải được khoản nợ.",
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [canDelete, canRead, canUpdate, detailModal, supabase]);

  const activeViewingDebt =
    viewingDebt?.id === detailModal.id ? viewingDebt : null;
  const detailLoading = Boolean(
    detailModal.id &&
    (canRead || canUpdate || canDelete) &&
    !activeViewingDebt &&
    detailLoadError?.id !== detailModal.id,
  );

  function closeDebtDetail() {
    detailModal.close();
    setViewingDebt(null);
    setDetailLoadError(null);
    setError("");
  }
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>([]);
  const { loading, finishInitialLoad } = useInitialTableLoading();
  const canList = canRead || canUpdate || canDelete;
  const summaryFiltersComplete = Boolean(filterCustomer.id && filterItem);
  const canViewRows = canList || (canReport && summaryFiltersComplete);
  const showSummaryRow = canReport && summaryFiltersComplete;
  const canLoadDebtFilters = canList || canReport || canCreate;
  const displayedRows = canViewRows ? rows : [];
  const displayedTotal = canViewRows ? total : 0;
  const displayedQuantity = canViewRows ? totalQuantity : 0;

  const itemOptions = useMemo<AppSelectOption[]>(
    () => [
      ...(canCreate
        ? [
            {
              value: createDebtItemOption,
              label: "Tạo mới",
              appearance: "primary" as const,
            },
          ]
        : []),
      { value: allDebtItemsOption, label: "Tất cả loại nợ" },
      ...debtItems.map((item) => ({ value: item, label: item })),
    ],
    [canCreate, debtItems],
  );
  const quickItemOptions = useMemo<AppSelectOption[]>(
    () => [
      {
        value: createDebtItemOption,
        label: "Tạo mới",
        appearance: "primary",
      },
      ...debtTypes.map((item) => ({ value: item.name, label: item.name })),
    ],
    [debtTypes],
  );
  const editItemOptions = useMemo<AppSelectOption[]>(() => {
    const options = debtTypes.map((item) => ({
      value: item.name,
      label: item.name,
    }));
    if (editItem && !options.some((option) => option.value === editItem)) {
      options.push({ value: editItem, label: editItem });
    }
    return options;
  }, [debtTypes, editItem]);

  useEffect(() => {
    if (!canCreate) return;
    function focusCustomer(event: KeyboardEvent) {
      if (event.key !== "F4" || editing || busy) return;
      event.preventDefault();
      quickCustomerInputRef.current?.focus();
    }
    window.addEventListener("keydown", focusCustomer);
    return () => window.removeEventListener("keydown", focusCustomer);
  }, [busy, canCreate, editing]);

  useEffect(() => {
    let active = true;
    if (!dateRangeReady) return;
    if (!canViewRows) {
      finishInitialLoad();
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await supabase.rpc("search_debts", {
            p_query: debouncedQuery.trim(),
            p_status: status,
            p_customer_id: filterCustomer.id || null,
            p_item: filterItem || null,
            p_from: dateRange.from || null,
            p_to: dateRange.to || null,
            p_limit: pageSize,
            p_offset: page * pageSize,
            p_sort: sort.key,
            p_direction: sort.direction,
          });
          if (result.error) throw result.error;
          if (!active) return;
          const data = (result.data ?? []) as DebtRow[];
          setRows(data);
          setTotal(Number(data[0]?.total_rows ?? 0));
          setTotalQuantity(Number(data[0]?.total_quantity ?? 0));
          setError("");
          if (page > 0 && data.length === 0) setPage((current) => current - 1);
        } catch (caught) {
          if (!active) return;
          setError(
            caught instanceof Error
              ? caught.message
              : "Không tải được danh sách nợ.",
          );
          setRows([]);
          setTotal(0);
          setTotalQuantity(0);
        } finally {
          if (active) finishInitialLoad();
        }
      })();
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    canViewRows,
    dateRangeReady,
    debouncedQuery,
    dateRange,
    finishInitialLoad,
    page,
    filterCustomer.id,
    filterItem,
    revision,
    sort,
    status,
    supabase,
  ]);

  useEffect(() => {
    let active = true;
    if (!canLoadDebtFilters) return;
    void (async () => {
      const [typesResult, legacyResult] = await Promise.all([
        supabase.from("debt_items").select("id,name").order("name"),
        supabase
          .from("debts")
          .select("debt_item")
          .is("debt_item_id", null)
          .order("debt_item", { ascending: true })
          .limit(500),
      ]);
      if (!active) return;
      if (typesResult.error || legacyResult.error) {
        setError(
          typesResult.error?.message ??
            legacyResult.error?.message ??
            "Không tải được loại nợ.",
        );
        return;
      }
      const types = (typesResult.data ?? []) as DebtItem[];
      const legacy = (legacyResult.data ?? []) as { debt_item: string }[];
      const names = Array.from(
        new Set([
          ...types.map((item) => item.name),
          ...legacy.map((item) => item.debt_item).filter(Boolean),
        ]),
      ).sort((a, b) => a.localeCompare(b, "vi"));
      setDebtTypes(types);
      setDebtItems(names);
      setQuickItem((current) => {
        if (types.some((item) => item.name === current)) return current;
        try {
          const previousItem = window.localStorage.getItem(lastItemStorageKey);
          return types.some((item) => item.name === previousItem)
            ? (previousItem ?? "")
            : "";
        } catch {
          return "";
        }
      });
    })();
    return () => {
      active = false;
    };
  }, [canLoadDebtFilters, revision, supabase]);

  function rememberItem(value: string) {
    setQuickItem(value);
    if (value.trim()) {
      try {
        window.localStorage.setItem(lastItemStorageKey, value.trim());
      } catch {
        // Keep the current item in component state if storage is unavailable.
      }
      setDebtItems((items) =>
        items.includes(value.trim()) ? items : [...items, value.trim()].sort(),
      );
    }
  }

  function openCreateType(source: "quick" | "filter") {
    setError("");
    setNewTypeName("");
    setCreateTypeSource(source);
  }

  async function createDebtType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typeBusy || !createTypeSource) return;
    const name = newTypeName.trim();
    if (!name) return;
    setTypeBusy(true);
    setError("");
    const result = await supabase
      .from("debt_items")
      .insert({ name })
      .select("id,name")
      .single();
    setTypeBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const item = result.data as DebtItem;
    setDebtTypes((items) =>
      [...items.filter((current) => current.id !== item.id), item].sort(
        (a, b) => a.name.localeCompare(b.name, "vi"),
      ),
    );
    setDebtItems((items) =>
      items.includes(item.name)
        ? items
        : [...items, item.name].sort((a, b) => a.localeCompare(b, "vi")),
    );
    if (createTypeSource === "quick") rememberItem(item.name);
    else {
      setFilterItem(item.name);
      setPage(0);
    }
    setCreateTypeSource(null);
    toast.success("Đã tạo loại nợ.");
  }

  async function saveDebtType(item: DebtItem) {
    const name = (typeDrafts[item.id] ?? item.name).trim();
    if (name === item.name || !name || savingTypeId) return;
    setSavingTypeId(item.id);
    setError("");
    const result = await supabase.rpc("rename_debt_item", {
      p_item_id: item.id,
      p_name: name,
    });
    setSavingTypeId(null);
    if (result.error) {
      setError(result.error.message);
      setTypeDrafts((drafts) => ({ ...drafts, [item.id]: item.name }));
      return;
    }
    setDebtTypes((items) =>
      items
        .map((current) =>
          current.id === item.id ? { ...current, name } : current,
        )
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    );
    setDebtItems((items) =>
      Array.from(
        new Set(
          items.map((current) => (current === item.name ? name : current)),
        ),
      ).sort((a, b) => a.localeCompare(b, "vi")),
    );
    if (quickItem === item.name) rememberItem(name);
    if (filterItem === item.name) setFilterItem(name);
    setTypeDrafts((drafts) => {
      const next = { ...drafts };
      delete next[item.id];
      return next;
    });
    setRevision((current) => current + 1);
    toast.success("Đã cập nhật loại nợ.");
  }

  function requestDeleteDebtType(item: DebtItem) {
    confirmAction.current = async () => {
      setTypeBusy(true);
      setError("");
      const result = await supabase
        .from("debt_items")
        .delete()
        .eq("id", item.id);
      setTypeBusy(false);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setDebtTypes((items) =>
        items.filter((current) => current.id !== item.id),
      );
      setTypeDrafts((drafts) => {
        const next = { ...drafts };
        delete next[item.id];
        return next;
      });
      if (quickItem === item.name) setQuickItem("");
      if (filterItem === item.name) setFilterItem("");
      setRevision((current) => current + 1);
      toast.success("Đã xóa loại nợ. Các khoản nợ cũ vẫn được lưu.");
    };
    setConfirmRequest({
      title: "Xóa loại nợ?",
      message: `Xóa “${item.name}” khỏi danh sách chọn? Tên này vẫn được giữ trong các khoản nợ đã ghi.`,
      confirmLabel: "Xóa loại nợ",
    });
  }

  async function createDebt() {
    if (!canCreate || busy) return;
    setError("");
    const item = debtTypes.find((current) => current.name === quickItem);
    const amount = Number(quickQuantity);
    if (!quickCustomer.id) {
      setError("Vui lòng chọn khách hàng.");
      return;
    }
    if (!item) {
      setError("Vui lòng chọn loại nợ.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Số lượng nợ phải lớn hơn 0.");
      return;
    }
    if (!quickDebtDate) {
      setError("Vui lòng chọn ngày nợ.");
      return;
    }
    setBusy(true);
    try {
      const result = await supabase.from("debts").insert({
        customer_id: quickCustomer.id,
        debt_item: item.name,
        debt_item_id: item.id,
        quantity: amount,
        debt_date: quickDebtDate,
      });
      if (result.error) throw result.error;
      rememberItem(item.name);
      setQuickCustomer({ id: "", name: "", phone: "", address: "" });
      setQuickQuantity("");
      setPage(0);
      setRevision((current) => current + 1);
      toast.success("Đã tạo khoản nợ.");
      window.requestAnimationFrame(() =>
        quickCustomerInputRef.current?.focus(),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không tạo được khoản nợ.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateDebt(
    id: string,
    values: Partial<
      Pick<
        DebtRow,
        "customer_id" | "debt_item" | "quantity" | "debt_date" | "paid_date"
      >
    >,
  ) {
    setError("");
    setBusyRowId(id);
    const result = await supabase.from("debts").update(values).eq("id", id);
    setBusyRowId(null);
    if (result.error) {
      setError(result.error.message);
      throw result.error;
    }
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...values } : row)),
    );
    setViewingDebt((current) =>
      current?.id === id ? { ...current, ...values } : current,
    );
    setRevision((current) => current + 1);
  }

  async function togglePaid(row: DebtRow) {
    if (!canUpdate || busyRowId) return;
    try {
      await updateDebt(row.id, {
        paid_date: row.paid_date ? null : todayLocal(),
      });
    } catch {
      // The error is displayed above the table.
    }
  }

  function editRow(row: DebtRow) {
    setEditing(row);
    setEditCustomer({
      id: row.customer_id,
      name: row.customer_name,
      phone: "",
      address: "",
    });
    setEditItem(row.debt_item);
    setEditQuantity(String(row.quantity));
    setEditDebtDate(row.debt_date);
    setEditPaidDate(row.paid_date ?? "");
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    const amount = Number(editQuantity);
    if (!editCustomer.id || !editItem.trim()) {
      setError("Vui lòng chọn khách hàng và loại nợ.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Số lượng nợ phải lớn hơn 0.");
      return;
    }
    if (!editDebtDate) {
      setError("Vui lòng chọn ngày nợ.");
      return;
    }
    setBusy(true);
    setError("");
    const item = debtTypes.find((current) => current.name === editItem.trim());
    const selectedCustomerId = editCustomer.id || editing.customer_id;
    const nextValues = {
      customer_id: selectedCustomerId,
      debt_item: editItem.trim(),
      quantity: amount,
      debt_date: editDebtDate,
      paid_date: editPaidDate || null,
    };
    const patch = changedFieldPatch(editing, nextValues, [
      "customer_id",
      "debt_item",
      "quantity",
      "debt_date",
      "paid_date",
    ]);
    if (nextValues.debt_item !== editing.debt_item)
      Object.assign(patch, { debt_item_id: item?.id ?? null });
    const result = Object.keys(patch).length
      ? await supabase.from("debts").update(patch).eq("id", editing.id)
      : { error: null };
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (item) rememberItem(item.name);
    setRows((current) =>
      current.map((row) =>
        row.id === editing.id
          ? {
              ...row,
              customer_id: selectedCustomerId,
              customer_name: editCustomer.name,
              debt_item: nextValues.debt_item,
              quantity: nextValues.quantity,
              debt_date: nextValues.debt_date,
              paid_date: nextValues.paid_date,
            }
          : row,
      ),
    );
    setViewingDebt((current) =>
      current?.id === editing.id
        ? {
            ...current,
            customer_id: selectedCustomerId,
            customer_name: editCustomer.name,
            debt_item: nextValues.debt_item,
            quantity: nextValues.quantity,
            debt_date: nextValues.debt_date,
            paid_date: nextValues.paid_date,
          }
        : current,
    );
    setEditing(null);
    setRevision((current) => current + 1);
  }

  function requestDelete(row: DebtRow) {
    confirmAction.current = async () => {
      setBusyRowId(row.id);
      setError("");
      const result = await supabase.from("debts").delete().eq("id", row.id);
      setBusyRowId(null);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setRevision((current) => current + 1);
    };
    setConfirmRequest({
      title: "Xóa khoản nợ?",
      message: `Xóa khoản nợ “${row.debt_item}” của ${row.customer_name}?`,
      confirmLabel: "Xóa khoản nợ",
    });
  }

  const columns: DataColumn<DebtRow>[] = [
    {
      key: "customer_name",
      label: "Khách hàng",
      value: (row) => row.customer_name,
      total: showSummaryRow ? <strong>Tổng</strong> : undefined,
      render: (row) => row.customer_name,
    },
    {
      key: "debt_item",
      label: "Loại nợ",
      value: (row) => row.debt_item,
      render: (row) => row.debt_item,
    },
    {
      key: "quantity",
      label: "Số lượng nợ",
      value: (row) => row.quantity,
      align: "right",
      total: showSummaryRow ? formatQuantity(displayedQuantity) : undefined,
      render: (row) => formatQuantity(row.quantity),
    },
    {
      key: "debt_date",
      label: "Ngày nợ",
      value: (row) => row.debt_date,
      render: (row) => (
        <InlineEditField
          value={formatDebtDate(row.debt_date)}
          ariaLabel={`Ngày nợ của ${row.customer_name}`}
          disabled={!canUpdate}
          onError={setError}
          onSave={async (value) => {
            const nextDate = parseInlineDate(value, false);
            if (!nextDate) throw new Error("Vui lòng nhập ngày nợ.");
            await updateDebt(row.id, { debt_date: nextDate });
          }}
        />
      ),
    },
    {
      key: "status",
      label: "Trạng thái",
      sortable: false,
      value: (row) => (row.paid_date ? "paid" : "unpaid"),
      render: (row) => (
        <AppButton
          variant="ghost"
          type="button"
          className="debt-status"
          disabled={!canUpdate || busyRowId === row.id}
          aria-label={row.paid_date ? "Đánh dấu đang nợ" : "Đánh dấu đã trả nợ"}
          onClick={() => void togglePaid(row)}
        >
          <AppBadge tone={row.paid_date ? "success" : "danger"}>
            {row.paid_date ? "Đã trả" : "Đang nợ"}
          </AppBadge>
        </AppButton>
      ),
    },
    {
      key: "paid_date",
      label: "Ngày trả nợ",
      value: (row) => row.paid_date ?? "",
      render: (row) => (
        <InlineEditField
          value={formatDebtDate(row.paid_date)}
          ariaLabel={`Ngày trả nợ của ${row.customer_name}`}
          disabled={!canUpdate}
          onError={setError}
          onSave={async (value) => {
            const nextDate = parseInlineDate(value, true);
            await updateDebt(row.id, { paid_date: nextDate });
          }}
        />
      ),
    },
    ...(canDelete
      ? [
          {
            key: "actions",
            label: "Thao tác",
            hideable: false,
            sortable: false,
            draggable: false,
            render: (row: DebtRow) => (
              <>
                {canDelete && (
                  <AppButton
                    variant="ghost"
                    type="button"
                    aria-label={`Xóa khoản nợ ${row.debt_item} của ${row.customer_name}`}
                    disabled={busyRowId === row.id}
                    onClick={() => requestDelete(row)}
                  >
                    <Trash2 size={16} />
                  </AppButton>
                )}
              </>
            ),
          },
        ]
      : []),
  ];

  const debtExportGroups: DataExportFieldGroup[] = [
    {
      key: "debt",
      label: "Khoản nợ",
      fields: columns
        .filter((column) => column.key !== "actions")
        .map((column) => ({ key: column.key, label: column.label })),
    },
  ];

  const loadAllFilteredDebts = useStableCallback(async () => {
    const allRows: DebtRow[] = [];
    let offset = 0;
    let totalRows = 0;
    do {
      const result = await supabase.rpc("search_debts", {
        p_query: debouncedQuery.trim(),
        p_status: status,
        p_customer_id: filterCustomer.id || null,
        p_item: filterItem || null,
        p_from: dateRange.from || null,
        p_to: dateRange.to || null,
        p_limit: 100,
        p_offset: offset,
        p_sort: sort.key,
        p_direction: sort.direction,
      });
      if (result.error) throw result.error;
      const batch = (result.data ?? []) as DebtRow[];
      totalRows = Number(batch[0]?.total_rows ?? 0);
      if (!batch.length) break;
      allRows.push(...batch);
      offset += batch.length;
    } while (offset < totalRows);
    return allRows;
  });

  const exportDebts = useStableCallback(
    async (selectedKeys: string[], overview: boolean) => {
      if (exportBusy || !canViewRows) return;
      const exportColumns = columns
        .filter(
          (column) =>
            column.key !== "actions" &&
            selectedKeys.includes(column.key) &&
            Boolean(column.value),
        )
        .map((column) => ({
          key: column.key,
          label: column.label,
          read: (row: DebtRow) => {
            if (column.key === "debt_date" || column.key === "paid_date")
              return formatDebtDate(String(column.value?.(row) ?? ""));
            if (column.key === "status")
              return row.paid_date ? "Đã trả" : "Đang nợ";
            if (column.key === "quantity") return formatQuantity(row.quantity);
            return column.value?.(row) ?? "";
          },
        }));
      if (!exportColumns.length) {
        toast.error("Hãy chọn ít nhất một cột để xuất.");
        return;
      }

      setExportBusy(true);
      setExportError("");
      try {
        const debtRows = await loadAllFilteredDebts();
        downloadCsvFile(
          `cong-no-${overview ? "tong-quan" : "chi-tiet"}.csv`,
          createCsv(exportColumns, debtRows),
        );
        setDetailExportOpen(false);
        toast.success(`Đã xuất ${debtRows.length} khoản nợ.`);
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Không xuất được danh sách nợ.";
        setExportError(message);
        toast.error(message);
      } finally {
        setExportBusy(false);
      }
    },
  );

  const handleExportOverview = useStableCallback(() => {
    void exportDebts(
      visibleColumnKeys.filter((key) => key !== "actions"),
      true,
    );
  });
  const handleOpenDetailExport = useStableCallback(() => {
    setExportError("");
    setDetailExportOpen(true);
  });
  const handleCloseDetailExport = useStableCallback(() =>
    setDetailExportOpen(false),
  );
  const handleExportDetails = useStableCallback((selectedKeys: string[]) =>
    exportDebts(selectedKeys, false),
  );

  function renderQuickAddRow(visibleColumns: DataColumn<DebtRow>[]) {
    if (!canCreate) return null;
    return (
      <AppTable.Row className="debt-quick-add-row" aria-label="Thêm khoản nợ">
        {visibleColumns.map((column) => {
          let value: React.ReactNode = null;
          if (column.key === "customer_name")
            value = (
              <CustomerPicker
                searchOnly
                searchLabel="Khách hàng"
                showInputLabel={false}
                showSearchIcon={false}
                inputRef={quickCustomerInputRef}
                placeholder="Tìm khách hàng"
                value={quickCustomer}
                onChange={setQuickCustomer}
                onEnter={() =>
                  window.requestAnimationFrame(() =>
                    document.getElementById("quick-debt-item-select")?.focus(),
                  )
                }
                disabled={busy}
              />
            );
          else if (column.key === "debt_item")
            value = (
              <AppSelect
                id="quick-debt-item-select"
                ariaLabel="Loại nợ mới"
                options={quickItemOptions}
                value={quickItem}
                onChange={(value) => {
                  if (value === createDebtItemOption) openCreateType("quick");
                  else rememberItem(value);
                }}
                placeholder="Chọn loại nợ"
                isSearchable
                showSearchIcon={false}
                isDisabled={busy}
              />
            );
          else if (column.key === "quantity")
            value = (
              <NumberInputField
                className="field debt-quick-input"
                ariaLabel="Số lượng nợ mới"
                inputRef={quickQuantityInputRef}
                value={quickQuantity}
                min={0}
                step={0.001}
                onChange={setQuickQuantity}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createDebt();
                  }
                }}
              />
            );
          else if (column.key === "debt_date")
            value = (
              <AppInput
                className="field debt-quick-input"
                type="date"
                aria-label="Ngày nợ mới"
                value={quickDebtDate}
                onChange={(event) => setQuickDebtDate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createDebt();
                  }
                }}
              />
            );
          else if (column.key === "status")
            value = <AppBadge tone="danger">Đang nợ</AppBadge>;
          else if (column.key === "paid_date")
            value = <span className="muted">—</span>;
          else if (column.key === "actions")
            value = (
              <span
                className="debt-quick-add-note"
                title="Điền đủ các ô bắt buộc rồi nhấn Enter tại ô số lượng hoặc ngày nợ để tự động tạo khoản nợ."
              >
                Thêm nhanh
              </span>
            );
          return (
            <AppTable.Cell key={column.key} align={column.align}>
              {value}
            </AppTable.Cell>
          );
        })}
      </AppTable.Row>
    );
  }

  const emptyMessage =
    !canList && canReport && !summaryFiltersComplete
      ? "Chọn khách hàng và loại nợ để xem báo cáo."
      : !canViewRows
        ? "Bạn có quyền thêm khoản nợ nhưng chưa được cấp quyền xem danh sách."
        : "Không tìm thấy khoản nợ phù hợp.";

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Công nợ</h1>
          <p>Quản lý các khoản nợ riêng, không gắn với hàng hóa bán.</p>
        </div>
        {canViewRows && (
          <DataExportMenu
            disabled={
              loading || !dateRangeReady || visibleColumnKeys.length === 0
            }
            busy={exportBusy}
            onOverview={handleExportOverview}
            onDetails={handleOpenDetailExport}
          />
        )}
      </div>
      <div className="customer-table-workspace debt-workspace">
        <aside className="product-filters card debt-filter-panel">
          <div className="filter-panel-title">
            <Boxes size={17} />
            <span>Bộ lọc</span>
          </div>
          <label className="form-label">
            Khoảng ngày nợ
            <DateRangeInput
              ariaLabel="Lọc khoảng ngày nợ"
              start={dateRange.from}
              end={dateRange.to}
              onChange={(from, to) => {
                setDateRange({ from, to });
                setPage(0);
              }}
            />
          </label>
          <div className="form-label">
            Khách hàng
            <CustomerPicker
              searchOnly
              searchLabel="Khách hàng"
              showInputLabel={false}
              showSearchIcon={false}
              placeholder="Tìm khách hàng"
              value={filterCustomer}
              onChange={(value) => {
                setFilterCustomer(value);
                setPage(0);
              }}
              disabled={false}
            />
          </div>
          <div className="form-label">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                // marginBottom: 5,
              }}
            >
              <label htmlFor="debt-filter-item">Loại nợ</label>
              {(canUpdate || canDelete) && (
                <AppButton
                  variant="ghost"
                  type="button"
                  aria-label="Quản lý loại nợ"
                  title="Quản lý loại nợ"
                  style={{
                    color: "var(--primary)",
                    minHeight: 19,
                    padding: "3px",
                    borderRadius: "var(--radius-sm)",
                  }}
                  onClick={() => setTypeManagerOpen(true)}
                >
                  <Settings2 size={12} style={{ width: 12, height: 12 }} />
                </AppButton>
              )}
            </div>
            <AppSelect
              id="debt-filter-item"
              ariaLabel="Lọc theo loại nợ"
              options={itemOptions}
              value={filterItem || allDebtItemsOption}
              onChange={(value) => {
                if (value === createDebtItemOption) {
                  openCreateType("filter");
                  return;
                }
                setFilterItem(value === allDebtItemsOption ? "" : value);
                setPage(0);
              }}
              placeholder="Tất cả loại nợ"
              isSearchable
              showSearchIcon={false}
            />
          </div>
          {canReport && (
            <p className="muted debt-summary-hint">
              Chọn khách hàng và loại nợ để hiện hàng Tổng.
            </p>
          )}
          <label className="form-label">
            Tìm khoản nợ
            <SearchInputField
              showSearchIcon={false}
              aria-label="Tìm theo khách hàng hoặc loại nợ"
              placeholder="Khách hàng hoặc loại nợ"
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(0);
              }}
            />
          </label>
          <label className="form-label">
            Trạng thái
            <AppSelect
              ariaLabel="Lọc theo trạng thái nợ"
              options={[
                { value: "all", label: "Tất cả trạng thái" },
                { value: "unpaid", label: "Đang nợ" },
                { value: "paid", label: "Đã trả" },
              ]}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(0);
              }}
            />
          </label>
        </aside>
        <div className="debt-results">
          {error && !detailModal.id && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {loading ? (
            <LoadingSkeleton rows={6} />
          ) : (
            <section className="card table-wrap">
              <MobileTableToolbarMetrics
                metrics={[{ label: "Số khoản nợ", value: displayedTotal }]}
              />
              <DataTable
                storageKey="debts"
                serverSort={{
                  value: sort,
                  onChange: (nextSort) => {
                    setSort(nextSort);
                    setPage(0);
                  },
                }}
                rows={displayedRows}
                rowKey={(row) => row.id}
                totalRows={displayedTotal}
                showSummaryRow={showSummaryRow}
                leadingRows={renderQuickAddRow}
                empty={emptyMessage}
                toolbarSummary={
                  <span>
                    Số khoản nợ: <b>{displayedTotal}</b>
                  </span>
                }
                columns={columns}
                onVisibleColumnsChange={setVisibleColumnKeys}
                onRowClick={(row) => detailModal.open(row.id)}
                activeRowId={detailModal.activeId}
              />
              <AppPagination
                page={page}
                pageSize={pageSize}
                totalRows={displayedTotal}
                onPageChange={setPage}
              />
            </section>
          )}
        </div>
      </div>
      {detailExportOpen && (
        <DataExportFieldModal
          title="Tùy chọn cột xuất công nợ"
          groups={debtExportGroups}
          defaultSelectedKeys={debtExportGroups.flatMap((group) =>
            group.fields.map((field) => field.key),
          )}
          busy={exportBusy}
          error={exportError}
          onCancel={handleCloseDetailExport}
          onExport={handleExportDetails}
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
      <EntityDetailModal
        open={Boolean(detailModal.id && activeViewingDebt)}
        onClose={closeDebtDetail}
        panelClassName="activity-linked-record-modal"
        ariaLabel="Chi tiết khoản nợ"
      >
        {activeViewingDebt && (
          <>
            <div className="modal-title">
              <h2 id="activity-debt-detail-title">Chi tiết khoản nợ</h2>
              <div style={{ display: "flex", alignItems: "center" }}>
                {canUpdate && (
                  <AppButton
                    variant="ghost"
                    type="button"
                    aria-label="Sửa khoản nợ"
                    title="Sửa khoản nợ"
                    onClick={() => {
                      if (!activeViewingDebt) return;
                      const debt = {
                        ...activeViewingDebt,
                        total_rows: total,
                        total_quantity: totalQuantity,
                      };
                      closeDebtDetail();
                      editRow(debt);
                    }}
                  >
                    <Pencil size={16} />
                  </AppButton>
                )}
                <AppButton
                  variant="ghost"
                  type="button"
                  className="mobile-dialog-close"
                  aria-label="Đóng chi tiết khoản nợ"
                  iconLeft={<X aria-hidden="true" />}
                  onClick={closeDebtDetail}
                />
              </div>
            </div>
            <dl className="activity-linked-record-fields">
              <div>
                <dt>Khách hàng</dt>
                <dd>{activeViewingDebt.customer_name || "—"}</dd>
              </div>
              <div>
                <dt>Nội dung nợ</dt>
                <dd>{activeViewingDebt.debt_item}</dd>
              </div>
              <div>
                <dt>Số lượng</dt>
                <dd>{formatQuantity(activeViewingDebt.quantity)}</dd>
              </div>
              <div>
                <dt>Ngày nợ</dt>
                <dd>{formatDebtDate(activeViewingDebt.debt_date)}</dd>
              </div>
              <div>
                <dt>Ngày thanh toán</dt>
                <dd>
                  {activeViewingDebt.paid_date
                    ? formatDebtDate(activeViewingDebt.paid_date)
                    : "Chưa thanh toán"}
                </dd>
              </div>
            </dl>
          </>
        )}
      </EntityDetailModal>
      <EntityDetailModal
        open={Boolean(detailModal.id && !activeViewingDebt)}
        onClose={closeDebtDetail}
        panelClassName="activity-linked-record-modal"
        ariaLabel="Chi tiết khoản nợ"
      >
        <div className="entity-detail-loading">
          {!(canRead || canUpdate || canDelete)
            ? "Tài khoản không có quyền xem khoản nợ này."
            : detailLoading
              ? "Đang tải khoản nợ…"
              : detailModal.id && detailLoadError?.id === detailModal.id
                ? detailLoadError.message
                : "Không tìm thấy khoản nợ hoặc không có quyền xem."}
        </div>
      </EntityDetailModal>
      {editing && (
        <ModalLayer
          className="modal-backdrop"
          onEscape={() => {
            if (!busy) setEditing(null);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setEditing(null);
          }}
        >
          <form
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-label="Sửa khoản nợ"
            onSubmit={(event) => void saveEdit(event)}
          >
            <div className="modal-title">
              <h2>Sửa khoản nợ</h2>
            </div>
            <div className="debt-edit-form">
              <label className="form-label">
                Khách hàng
                <CustomerPicker
                  searchOnly
                  searchLabel="Khách hàng"
                  placeholder="Tìm khách hàng"
                  value={editCustomer}
                  onChange={setEditCustomer}
                  disabled={busy}
                />
              </label>
              <label className="form-label">
                Loại nợ
                <AppSelect
                  ariaLabel="Loại nợ khoản nợ đang sửa"
                  options={editItemOptions}
                  value={editItem}
                  onChange={setEditItem}
                  placeholder="Chọn loại nợ"
                  isSearchable
                  showSearchIcon={false}
                />
              </label>
              <label className="form-label">
                Số lượng nợ
                <NumberInputField
                  ariaLabel="Số lượng nợ"
                  value={editQuantity}
                  min={0}
                  step={0.001}
                  onChange={setEditQuantity}
                />
              </label>
              <label className="form-label">
                Ngày nợ
                <AppInput
                  className="field"
                  type="date"
                  required
                  value={editDebtDate}
                  onChange={(event) => setEditDebtDate(event.target.value)}
                />
              </label>
              <label className="form-label">
                Ngày trả nợ
                <AppInput
                  className="field"
                  type="date"
                  value={editPaidDate}
                  onChange={(event) => setEditPaidDate(event.target.value)}
                />
              </label>
            </div>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <div className="form-actions">
              <AppButton
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Hủy
              </AppButton>
              <AppButton variant="primary" disabled={busy}>
                {busy ? "Đang lưu…" : "Lưu khoản nợ"}
              </AppButton>
            </div>
          </form>
        </ModalLayer>
      )}
      {createTypeSource && (
        <ModalLayer
          className="modal-backdrop"
          onEscape={() => {
            if (!typeBusy) setCreateTypeSource(null);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !typeBusy)
              setCreateTypeSource(null);
          }}
        >
          <form
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="debt-item-create-title"
            onSubmit={(event) => void createDebtType(event)}
          >
            <div className="modal-title">
              <h2 id="debt-item-create-title">Tạo mới loại nợ</h2>
              <AppButton
                variant="ghost"
                type="button"
                aria-label="Đóng"
                disabled={typeBusy}
                onClick={() => setCreateTypeSource(null)}
              >
                <X size={16} />
              </AppButton>
            </div>
            <label className="form-label">
              Tên loại nợ
              <AppInput
                className="field"
                autoFocus
                required
                maxLength={160}
                value={newTypeName}
                onChange={(event) => setNewTypeName(event.target.value)}
                placeholder="Nhập tên loại nợ"
              />
            </label>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <div className="form-actions">
              <AppButton
                variant="secondary"
                type="button"
                disabled={typeBusy}
                onClick={() => setCreateTypeSource(null)}
              >
                Hủy
              </AppButton>
              <AppButton variant="primary" disabled={typeBusy}>
                {typeBusy ? "Đang lưu…" : "Tạo loại nợ"}
              </AppButton>
            </div>
          </form>
        </ModalLayer>
      )}
      {typeManagerOpen && (
        <ModalLayer
          className="modal-backdrop"
          onEscape={() => {
            if (!typeBusy) setTypeManagerOpen(false);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !typeBusy)
              setTypeManagerOpen(false);
          }}
        >
          <section
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="debt-item-manager-title"
            style={{
              width: "min(600px, 100%)",
              maxHeight: "85vh",
              overflow: "auto",
            }}
          >
            <div className="modal-title">
              <h2 id="debt-item-manager-title">Quản lý loại nợ</h2>
              <AppButton
                variant="ghost"
                type="button"
                aria-label="Đóng"
                disabled={typeBusy}
                onClick={() => setTypeManagerOpen(false)}
              >
                <X size={16} />
              </AppButton>
            </div>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            {debtTypes.length === 0 ? (
              <p className="muted">Chưa có loại nợ nào.</p>
            ) : (
              <div className="table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th scope="col">Tên loại nợ</th>
                      <th scope="col" style={{ width: 100 }}>
                        Thao tác
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtTypes.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <AppInput
                            className="field"
                            aria-label={`Tên loại nợ ${item.name}`}
                            maxLength={160}
                            value={typeDrafts[item.id] ?? item.name}
                            disabled={!canUpdate || savingTypeId === item.id}
                            onChange={(event) =>
                              setTypeDrafts((drafts) => ({
                                ...drafts,
                                [item.id]: event.target.value,
                              }))
                            }
                            onBlur={() => void saveDebtType(item)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        </td>
                        <td>
                          {canDelete && (
                            <AppButton
                              variant="danger"
                              type="button"
                              aria-label={`Xóa loại nợ ${item.name}`}
                              title="Xóa loại nợ"
                              disabled={typeBusy}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => requestDeleteDebtType(item)}
                            >
                              <Trash2 size={15} />
                            </AppButton>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ marginBottom: 0 }}>
              Xóa loại nợ sẽ bỏ loại đó khỏi danh sách chọn mới; các khoản nợ đã
              ghi vẫn giữ tên cũ.
            </p>
          </section>
        </ModalLayer>
      )}
    </>
  );
}
