"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { AppTextarea } from "@/components/app-textarea";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "react-toastify";
import { createClient } from "@/lib/data/client";
import { customerValues, type Customer } from "@/lib/customers";
import { changedFieldPatch } from "@/lib/partial-update";
import { DataTable, type DataTableSort } from "@/components/data-table";
import { MobileTableToolbarMetrics } from "@/components/mobile-table-toolbar-metrics";
import { MobileSortControl } from "@/components/mobile-sort-control";
import { SearchInputField } from "@/components/search-input-field";
import { usePreference } from "@/lib/preferences";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import { useRef } from "react";
import { useDebounce } from "@/lib/debounce";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCachedQuery } from "@/lib/query-cache";
import { useInitialTableLoading } from "@/lib/use-initial-table-loading";
import { useForm } from "react-hook-form";
import {
  DataExportFieldModal,
  DataExportMenu,
  type DataExportFieldGroup,
} from "@/components/data-export-controls";
import type { DataColumn } from "@/components/data-table";
import { createCsv, downloadCsvFile } from "@/lib/csv-export";
import { useStableCallback } from "@/lib/use-stable-callback";
import { usePathname } from "next/navigation";
import { EntityDetailModal } from "@/components/entity-detail-modal";
import { ModalLayer } from "@/components/modal-layer";
import { useEntityDetailId } from "@/lib/use-entity-detail-id";
import { mergeClassNames } from "@/lib/class-names";

const defaultCustomerSort: DataTableSort = { key: "name", direction: "asc" };

export function CustomerManagement({
  canCreate,
  canUpdate,
  canDelete,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const pathname = usePathname();
  const isMobileRoute = pathname.startsWith("/mobile/");
  const detailModal = useEntityDetailId();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Customer[]>([]);
  const [query, setQuery] = usePreference("customers.search", "");
  const debouncedQuery = useDebounce(query);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const confirmAction = useRef<(() => Promise<void>) | null>(null);
  const [page, setPage] = useState(0);
  const [savedSort, setSort] = usePreference<DataTableSort | null>(
    "table.customers.sort",
    defaultCustomerSort,
  );
  const sort = savedSort ?? defaultCustomerSort;
  const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [detailLoadError, setDetailLoadError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const { register, handleSubmit, reset } = useForm<Customer>({
    defaultValues: { id: "", name: "", phone: "", address: "" },
  });
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [detailExportOpen, setDetailExportOpen] = useState(false);
  const [exportError, setExportError] = useState("");
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>([]);
  const { loading, finishInitialLoad } = useInitialTableLoading();
  const [error, setError] = useState("");

  useEffect(() => {
    const id = detailModal.id;
    if (!id || rows.some((customer) => customer.id === id)) return;

    let active = true;
    void (async () => {
      try {
        const { data, error: detailError } = await supabase
          .from("customers")
          .select("id,name,phone,address")
          .eq("id", id)
          .maybeSingle();
        if (!active) return;
        setViewingCustomer(data as Customer | null);
        if (detailError || !data)
          setDetailLoadError({
            id,
            message:
              detailError?.message ||
              "Không tìm thấy khách hàng hoặc không có quyền xem.",
          });
      } catch (caught) {
        if (!active) return;
        setDetailLoadError({
          id,
          message:
            caught instanceof Error
              ? caught.message
              : "Không tải được thông tin khách hàng.",
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [detailModal, rows, supabase]);

  const activeCustomer =
    (detailModal.id
      ? rows.find((customer) => customer.id === detailModal.id)
      : null) ||
    (viewingCustomer?.id === detailModal.id ? viewingCustomer : null);
  const detailLoading = Boolean(
    detailModal.id && !activeCustomer && detailLoadError?.id !== detailModal.id,
  );

  function openCustomer(customer: Customer) {
    setViewingCustomer(customer);
    setDetailLoadError(null);
    detailModal.open(customer.id);
  }

  function closeCustomerDetail() {
    detailModal.close();
    setViewingCustomer(null);
  }
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const data = await fetchCachedQuery(
          queryClient,
          supabase,
          ["customers", debouncedQuery, page, 20, sort.key, sort.direction],
          async () => {
            const response = await supabase.rpc("search_customers", {
              p_query: debouncedQuery,
              p_offset: page * 20,
              p_limit: 20,
              p_sort: sort.key,
              p_direction: sort.direction,
            });
            if (response.error) throw response.error;
            return response.data;
          },
        );
        if (!active) return;
        finishInitialLoad();
        setRows(data?.rows ?? []);
        setTotal(data?.total ?? 0);
        setError("");
        if (page > 0 && !data?.rows?.length) setPage(page - 1);
      } catch (caught) {
        if (!active) return;
        finishInitialLoad();
        setError(
          caught instanceof Error
            ? caught.message
            : "Không tải được khách hàng.",
        );
      }
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    supabase,
    queryClient,
    debouncedQuery,
    finishInitialLoad,
    page,
    revision,
    sort,
  ]);

  async function save(values: Customer) {
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    try {
      const payload = customerValues(values);
      if (editing.id) {
        const patch = changedFieldPatch(editing, payload, [
          "name",
          "phone",
          "address",
        ]);
        if (Object.keys(patch).length) {
          const result = await supabase
            .from("customers")
            .update(patch)
            .eq("id", editing.id)
            .select("id")
            .single();
          if (result.error) throw result.error;
        }
        setRows((current) =>
          current.map((customer) =>
            customer.id === editing.id ? { ...customer, ...payload } : customer,
          ),
        );
      } else {
        const result = await supabase.from("customers").insert(payload);
        if (result.error) throw result.error;
      }
      setEditing(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-suggestions"] }),
      ]);
      setRevision((value) => value + 1);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : (error as { message: string }).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(customer: Customer) {
    if (busy) return;
    confirmAction.current = async () => {
      setBusy(true);
      setError("");
      const result = await supabase
        .from("customers")
        .delete()
        .eq("id", customer.id)
        .select("id")
        .single();
      setBusy(false);
      if (result.error) setError(result.error.message);
      else {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["customers"] }),
          queryClient.invalidateQueries({ queryKey: ["customer-suggestions"] }),
        ]);
        setRevision((value) => value + 1);
      }
    };
    setConfirmRequest({
      title: "Xóa khách hàng?",
      message: `Xóa "${customer.name}"? Thông tin trên hóa đơn cũ vẫn được giữ nguyên.`,
      confirmLabel: "Xóa khách hàng",
    });
  }

  const customerColumns: DataColumn<Customer>[] = [
    {
      key: "name",
      label: "Tên khách hàng",
      value: (row) => row.name,
      summary: `Tổng ${total} khách hàng`,
      render: (row) => row.name,
    },
    {
      key: "phone",
      label: "Số điện thoại",
      value: (row) => row.phone,
      render: (row) => row.phone || "—",
    },
    {
      key: "address",
      label: "Địa chỉ",
      value: (row) => row.address,
      render: (row) => (
        <span
          style={{
            whiteSpace: "normal",
            overflowWrap: "anywhere",
          }}
        >
          {row.address || "—"}
        </span>
      ),
    },
    ...(canDelete
      ? [
          {
            key: "actions",
            label: "Thao tác",
            hideable: false,
            render: (row: Customer) => (
              <>
                {canDelete && (
                  <AppButton
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Xóa ${row.name}`}
                    onClick={() => remove(row)}
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
  const customerExportGroups: DataExportFieldGroup[] = [
    {
      key: "customer",
      label: "Khách hàng",
      fields: customerColumns
        .filter((column) => column.key !== "actions")
        .map((column) => ({ key: column.key, label: column.label })),
    },
  ];

  const loadAllFilteredCustomers = useStableCallback(async () => {
    const customers: Customer[] = [];
    let totalRows = 0;
    let offset = 0;
    do {
      const response = await supabase.rpc("search_customers", {
        p_query: debouncedQuery,
        p_offset: offset,
        p_limit: 100,
        p_sort: sort.key,
        p_direction: sort.direction,
      });
      if (response.error) throw response.error;
      const data = response.data as {
        rows?: Customer[];
        total?: number;
      } | null;
      const batch = data?.rows ?? [];
      totalRows = Number(data?.total ?? 0);
      if (!batch.length) break;
      customers.push(...batch);
      offset += batch.length;
    } while (offset < totalRows);
    return customers;
  });

  const exportCustomers = useStableCallback(
    async (selectedKeys: string[], overview: boolean) => {
      if (exportBusy) return;
      const columns = customerColumns
        .filter(
          (column) =>
            column.key !== "actions" &&
            selectedKeys.includes(column.key) &&
            Boolean(column.value),
        )
        .map((column) => ({
          key: column.key,
          label: column.label,
          read: (customer: Customer) => column.value?.(customer) ?? "",
        }));
      if (!columns.length) {
        toast.error("Hãy chọn ít nhất một cột để xuất.");
        return;
      }
      setExportBusy(true);
      setExportError("");
      try {
        const customers = await loadAllFilteredCustomers();
        downloadCsvFile(
          `khach-hang-${overview ? "tong-quan" : "chi-tiet"}.csv`,
          createCsv(columns, customers),
        );
        setDetailExportOpen(false);
        toast.success(`Đã xuất ${customers.length} khách hàng.`);
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Không xuất được danh sách khách hàng.";
        setExportError(message);
        toast.error(message);
      } finally {
        setExportBusy(false);
      }
    },
  );

  const handleExportOverview = useStableCallback(() =>
    exportCustomers(
      visibleColumnKeys.filter((key) => key !== "actions"),
      true,
    ),
  );
  const handleOpenDetailExport = useStableCallback(() => {
    setExportError("");
    setDetailExportOpen(true);
  });
  const handleCloseDetailExport = useStableCallback(() =>
    setDetailExportOpen(false),
  );
  const handleExportDetails = useStableCallback((selectedKeys: string[]) =>
    exportCustomers(selectedKeys, false),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Khách hàng</h1>
          <p>{total} khách hàng · Tìm theo tên, số điện thoại hoặc địa chỉ.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <DataExportMenu
            disabled={loading || visibleColumnKeys.length === 0}
            busy={exportBusy}
            onOverview={handleExportOverview}
            onDetails={handleOpenDetailExport}
          />
          {canCreate && (
            <AppButton
              variant="primary"
              aria-label="Thêm khách hàng"
              onClick={() => {
                setError("");
                const blank = { id: "", name: "", phone: "", address: "" };
                reset(blank);
                setEditing(blank);
              }}
            >
              <Plus size={16} />
              <span className="mobile-button-label">Thêm khách hàng</span>
            </AppButton>
          )}
        </div>
      </div>
      <div className="customer-table-workspace">
        <aside className="product-filters card">
          <label className="filter-label" htmlFor="customer-search">
            Tìm khách hàng
          </label>
          <SearchInputField
            id="customer-search"
            showSearchIcon={false}
            aria-label="Tìm khách hàng"
            placeholder="Tên, số điện thoại hoặc địa chỉ"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(0);
            }}
          />
        </aside>
        <div>
          {error && !detailModal.id && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {loading ? (
            <LoadingSkeleton rows={6} />
          ) : (
            <section className="card table-wrap">
              {isMobileRoute && (
                <div className="mobile-record-list customer-mobile-list">
                  <MobileTableToolbarMetrics
                    metrics={[{ label: "Tổng khách hàng", value: total }]}
                  />
                  <MobileSortControl
                    columns={customerColumns.map(
                      ({ key, label, sortable }) => ({
                        key,
                        label,
                        sortable,
                      }),
                    )}
                    sort={sort}
                    onChange={(nextSort) => {
                      setSort(nextSort);
                      setPage(0);
                    }}
                  />
                  {rows.length ? (
                    rows.map((customer) => (
                      <article
                        className="mobile-record-card-shell"
                        key={customer.id}
                      >
                        <AppButton
                          variant="ghost"
                          className={mergeClassNames(
                            "mobile-record-card customer-mobile-card mobile-unified-card mobile-unified-card--interactive",
                            detailModal.activeId === customer.id &&
                              "mobile-unified-card--selected",
                          )}
                          type="button"
                          onClick={() => openCustomer(customer)}
                          aria-label={`Xem thông tin khách hàng ${customer.name}`}
                        >
                          <strong>{customer.name}</strong>
                          <span>
                            {customer.phone || "Chưa có số điện thoại"}
                          </span>
                          <span>{customer.address || "Chưa có địa chỉ"}</span>
                        </AppButton>
                        {canDelete && (
                          <div className="mobile-record-card-actions">
                            {canDelete && (
                              <AppButton
                                variant="ghost"
                                disabled={busy}
                                aria-label={`Xóa ${customer.name}`}
                                onClick={() => remove(customer)}
                              >
                                <Trash2 size={16} />
                              </AppButton>
                            )}
                          </div>
                        )}
                      </article>
                    ))
                  ) : (
                    <p className="muted mobile-record-empty">
                      Không tìm thấy khách hàng.
                    </p>
                  )}
                </div>
              )}
              <div className="desktop-record-table">
                <DataTable
                  storageKey="customers"
                  onVisibleColumnsChange={setVisibleColumnKeys}
                  serverSort={{
                    value: sort,
                    onChange: (nextSort) => {
                      setSort(nextSort);
                      setPage(0);
                    },
                  }}
                  rows={rows}
                  rowKey={(row) => row.id}
                  totalRows={total}
                  empty="Không tìm thấy khách hàng."
                  toolbarSummary={
                    <span>
                      Tổng khách hàng: <b>{total}</b>
                    </span>
                  }
                  columns={customerColumns}
                  onRowClick={openCustomer}
                  activeRowId={detailModal.activeId}
                />
              </div>
              <div className="pagination">
                <span>
                  Trang {page + 1} / {Math.max(1, Math.ceil(total / 20))}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <AppButton
                    variant="secondary"

                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    Trước
                  </AppButton>
                  <AppButton
                    variant="secondary"

                    disabled={(page + 1) * 20 >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    Sau
                  </AppButton>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
      {detailExportOpen && (
        <DataExportFieldModal
          title="Tùy chọn cột xuất file"
          description="Chọn các thông tin khách hàng cần tải xuống."
          groups={customerExportGroups}
          defaultSelectedKeys={customerExportGroups.flatMap((group) =>
            group.fields.map((field) => field.key),
          )}
          busy={exportBusy}
          error={exportError}
          onCancel={handleCloseDetailExport}
          onExport={handleExportDetails}
        />
      )}
      <EntityDetailModal
        open={Boolean(detailModal.id && activeCustomer)}
        onClose={closeCustomerDetail}
        panelClassName="mobile-customer-detail"
        ariaLabel={`Thông tin khách hàng ${activeCustomer?.name || ""}`}
      >
        {activeCustomer && (
          <>
            <div className="modal-title">
              <div>
                <h2>{activeCustomer.name}</h2>
                <p className="muted">Thông tin khách hàng</p>
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                {canUpdate && (
                  <AppButton
                    variant="ghost"
                    type="button"
                    title="Chỉnh sửa khách hàng"
                    aria-label="Chỉnh sửa khách hàng"
                    onClick={() => {
                      setError("");
                      reset(activeCustomer);
                      setEditing(activeCustomer);
                      closeCustomerDetail();
                    }}
                  >
                    <Pencil size={16} />
                  </AppButton>
                )}
                <AppButton
                  variant="ghost"
                  type="button"
                  aria-label="Đóng thông tin khách hàng"
                  onClick={closeCustomerDetail}
                >
                  <X size={18} />
                </AppButton>
              </div>
            </div>
            <dl className="mobile-detail-list">
              <div>
                <dt>Số điện thoại</dt>
                <dd>
                  {activeCustomer.phone ? (
                    <a href={`tel:${activeCustomer.phone}`}>
                      {activeCustomer.phone}
                    </a>
                  ) : (
                    "Chưa có"
                  )}
                </dd>
              </div>
              <div>
                <dt>Địa chỉ</dt>
                <dd>{activeCustomer.address || "Chưa có"}</dd>
              </div>
            </dl>
            {canDelete && (
              <div className="form-actions">
                {canDelete && (
                  <AppButton
                    variant="danger"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const customer = activeCustomer;
                      closeCustomerDetail();
                      remove(customer);
                    }}
                  >
                    Xóa khách hàng
                  </AppButton>
                )}
              </div>
            )}
          </>
        )}
      </EntityDetailModal>
      <EntityDetailModal
        open={Boolean(detailModal.id && !activeCustomer)}
        onClose={closeCustomerDetail}
        panelClassName="mobile-customer-detail"
        ariaLabel="Thông tin khách hàng"
      >
        <div className="entity-detail-loading">
          {detailLoading
            ? "Đang tải thông tin khách hàng…"
            : detailModal.id && detailLoadError?.id === detailModal.id
              ? detailLoadError.message
              : "Không tìm thấy khách hàng hoặc không có quyền xem."}
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
      {editing && (
        <ModalLayer
          className="modal-backdrop"
          onEscape={() => setEditing(null)}
        >
          <form
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-label={editing.id ? "Sửa khách hàng" : "Thêm khách hàng"}
            onSubmit={handleSubmit(save)}
          >
            <h2>{editing.id ? "Sửa khách hàng" : "Thêm khách hàng"}</h2>
            <div style={{ display: "grid", gap: 13 }}>
              <label className="form-label">
                Tên khách hàng
                <AppInput
                  className="field"
                  autoFocus
                  required
                  maxLength={300}
                  {...register("name", { required: true, maxLength: 300 })}
                />
              </label>
              <label className="form-label">
                Số điện thoại
                <AppInput
                  className="field"
                  type="tel"
                  maxLength={100}
                  {...register("phone", { maxLength: 100 })}
                />
              </label>
              <label className="form-label">
                Địa chỉ
                <AppTextarea
                  noBorder
                  maxLength={1000}
                  {...register("address", { maxLength: 1000 })}
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
                {busy ? "Đang lưu…" : "Lưu khách hàng"}
              </AppButton>
            </div>
          </form>
        </ModalLayer>
      )}
    </>
  );
}
