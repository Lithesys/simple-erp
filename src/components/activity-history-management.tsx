"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History } from "lucide-react";
import { AppButton } from "@/components/app-button";
import { AppPagination } from "@/components/app-pagination";
import { AppInput } from "@/components/app-input";
import { AppSelect, type AppSelectOption } from "@/components/app-select";
import {
  DataTable,
  type DataColumn,
  type DataTableSort,
} from "@/components/data-table";
import { DateRangeInput } from "@/components/date-range-input";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { createClient } from "@/lib/data/client";
import { getUserPermissions } from "@/lib/auth";
import { canAccessPage } from "@/lib/access-control";
import { formatDateTime } from "@/lib/date";
import { todayLocal } from "@/lib/format";
import { mergeClassNames } from "@/lib/class-names";
import {
  getActivityPriceListName,
  getActivityHistoryTargetHref,
  formatActivityDateValue,
  getInvoiceDetailPresentation,
  isProductPriceUpdate,
  type ActivityHistoryChange,
} from "@/lib/activity-history-display";

type ActivityDetail = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  product_name?: string | null;
  related_entity_id?: string | null;
  changed_fields: Record<string, ActivityHistoryChange>;
  device: string | null;
  auth_event: "login" | "logout" | null;
};
type ActivityRow = {
  id: number;
  operation_id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string;
  feature: string;
  details?: ActivityDetail[];
  action?: string;
  entity_type?: string;
  entity_id?: string;
  entity_label?: string;
  related_entity_id?: string | null;
  changed_fields?: Record<string, ActivityHistoryChange>;
  device?: string | null;
  auth_event?: "login" | "logout" | null;
};
type ActivityResult = { rows: ActivityRow[]; total: number };
type EmployeeOption = { actor_id: string | null; actor_name: string };
type Filters = {
  from: string;
  to: string;
  query: string;
  employee: string;
  feature: string;
  action: string;
};

const pageSize = 20;
const features = ["Hàng hóa", "Đơn hàng", "Nhập hàng", "Công nợ", "Tài khoản"];
const actions = [
  "Tạo",
  "Cập nhật",
  "Ngừng kinh doanh",
  "Xóa",
  "Hoàn thành",
  "Hủy",
  "Điều chỉnh tồn kho",
  "Đăng nhập",
  "Đăng xuất",
];
const fieldLabels: Record<string, string> = {
  sku: "Mã hàng",
  name: "Tên hàng",
  product_name: "Tên hàng",
  order_no: "Mã đơn",
  purchase_no: "Mã phiếu nhập",
  price_list_name: "Bảng giá",
  unit: "Đơn vị tính",
  is_active: "Trạng thái kinh doanh",
  price: "Giá bán",
  cost: "Giá vốn",
  quantity: "Số lượng",
  unit_price: "Đơn giá",
  line_total: "Thành tiền",
  customer_name: "Khách hàng",
  customer_phone: "Số điện thoại",
  customer_address: "Địa chỉ",
  subtotal: "Tiền hàng",
  discount: "Giảm giá",
  total: "Tổng tiền",
  status: "Trạng thái",
  purchased_at: "Ngày nhập",
  received_at: "Ngày hoàn thành",
  debt_item: "Nội dung nợ",
  debt_date: "Ngày ghi nợ",
  paid_date: "Ngày thanh toán",
  stock: "Tồn kho",
  quantity_change: "Thay đổi tồn kho",
  reason: "Lý do",
  device: "Thiết bị",
  note: "Ghi chú",
  unit_cost: "Giá nhập",
  quantity_per_bundle: "Số lượng trong combo",
  display_order: "Vị trí sản phẩm",
};
const currencyFields = new Set([
  "price",
  "cost",
  "unit_price",
  "line_total",
  "subtotal",
  "discount",
  "total",
  "unit_cost",
]);

function displayValue(value: unknown, key: string) {
  if (value === null || value === undefined || value === "") return "—";
  const formattedDate = formatActivityDateValue(value, key);
  if (formattedDate) return formattedDate;
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (value === "pending") return "Chờ nhập kho";
  if (value === "received" || value === "completed") return "Hoàn thành";
  if (value === "cancelled") return "Đã hủy";
  if (currencyFields.has(key)) {
    const amount = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(amount)) {
      return `${amount.toLocaleString("vi-VN", {
        maximumFractionDigits: key === "unit_price" ? 2 : 0,
      })} ₫`;
    }
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getActivityDetails(row: ActivityRow): ActivityDetail[] {
  if (row.details?.length) return row.details;
  if (!row.action) return [];
  return [
    {
      id: row.id,
      action: row.action,
      entity_type: row.entity_type ?? "",
      entity_id: row.entity_id ?? "",
      entity_label: row.entity_label ?? "",
      product_name: null,
      related_entity_id: row.related_entity_id ?? null,
      changed_fields: row.changed_fields ?? {},
      device: row.device ?? null,
      auth_event: row.auth_event ?? null,
    },
  ];
}

function getActivityTargetHref(row: ActivityRow) {
  return getActivityHistoryTargetHref(getActivityDetails(row));
}

function openActivityTarget(row: ActivityRow) {
  const href = getActivityTargetHref(row);
  if (href) window.open(href, "_blank", "noopener,noreferrer");
}

function formatActivityChange(
  change: ActivityHistoryChange | null,
  key: string,
) {
  if (!change) return null;
  const { before, after } = change;
  if (
    before !== null &&
    before !== undefined &&
    after !== null &&
    after !== undefined &&
    before !== after
  ) {
    return `${displayValue(before, key)} → ${displayValue(after, key)}`;
  }
  const value = after === null || after === undefined ? before : after;
  return displayValue(value, key);
}

function ActivityDetailContent({
  detail,
  compactDocument,
}: {
  detail: ActivityDetail;
  compactDocument: boolean;
}) {
  const presentation = compactDocument
    ? getInvoiceDetailPresentation(detail)
    : null;

  if (presentation?.kind === "order") {
    const customerName = formatActivityChange(
      presentation.customerName,
      "customer_name",
    );
    const amountDue = formatActivityChange(presentation.amountDue, "total");
    const note = formatActivityChange(presentation.note, "note");
    const orderIdentity = [presentation.orderNumber, customerName]
      .filter(Boolean)
      .join(" - ");

    return (
      <section className="activity-details">
        <div className="activity-details-title">
          <strong>{detail.action}</strong>
          <div className="activity-invoice-summary">
            {orderIdentity && <span>{orderIdentity}</span>}
            {amountDue && (
              <strong className="activity-invoice-due">
                {orderIdentity
                  ? ` - Khách phải trả ${amountDue}`
                  : `Khách phải trả ${amountDue}`}
              </strong>
            )}
          </div>
        </div>
        {note && note !== "—" && (
          <p className="activity-invoice-note">
            <strong>Ghi chú đơn hàng</strong>
            <span>{note}</span>
          </p>
        )}
      </section>
    );
  }

  if (presentation?.kind === "purchase") {
    const total = formatActivityChange(presentation.total, "total");
    const status = formatActivityChange(presentation.status, "status");
    return (
      <section className="activity-details">
        <div className="activity-details-title">
          <strong>{detail.action}</strong>
          <div className="activity-invoice-summary">
            {presentation.purchaseNumber && (
              <span>{presentation.purchaseNumber}</span>
            )}
            {total && (
              <strong className="activity-invoice-due">
                {presentation.purchaseNumber
                  ? ` - Tổng tiền nhập ${total}`
                  : `Tổng tiền nhập ${total}`}
              </strong>
            )}
            {status && (
              <span className="activity-purchase-status">{status}</span>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (presentation?.kind === "item" || presentation?.kind === "purchase-item") {
    const isPurchaseItem = presentation.kind === "purchase-item";
    const quantityAdjustment =
      detail.action === "Cập nhật" &&
      presentation.quantity?.before !== null &&
      presentation.quantity?.before !== undefined &&
      presentation.quantity?.after !== null &&
      presentation.quantity?.after !== undefined
        ? presentation.quantity
        : null;
    const quantity = formatActivityChange(presentation.quantity, "quantity");
    const unitPriceChange =
      presentation.kind === "purchase-item"
        ? (presentation.unitCost ??
          deriveInvoiceUnitPrice(presentation.quantity, presentation.lineTotal))
        : (presentation.unitPrice ??
          deriveInvoiceUnitPrice(
            presentation.quantity,
            presentation.lineTotal,
          ));
    const unitPrice = formatActivityChange(
      unitPriceChange,
      isPurchaseItem ? "unit_cost" : "unit_price",
    );
    const lineTotal = formatActivityChange(
      presentation.lineTotal,
      "line_total",
    );
    const unit =
      presentation.kind === "purchase-item"
        ? formatActivityChange(presentation.unit, "unit")
        : null;
    const itemQuantity = [quantity, unit && unit !== "—" ? unit : null]
      .filter(Boolean)
      .join(" ");
    return (
      <section className="activity-details">
        <p className="activity-invoice-item">
          {quantityAdjustment ? (
            <>
              Điều chỉnh {presentation.productName} từ{" "}
              <strong>
                {displayValue(quantityAdjustment.before, "quantity")}
              </strong>{" "}
              qua{" "}
              <strong>
                {displayValue(quantityAdjustment.after, "quantity")}
              </strong>
            </>
          ) : (
            <>
              {presentation.productName} -{" "}
              <strong>{itemQuantity || "—"}</strong>
            </>
          )}
          {" - "}
          {isPurchaseItem ? "Giá nhập" : "Đơn giá"} {unitPrice ?? "—"} - Thành
          tiền <strong>{lineTotal ?? "—"}</strong>
        </p>
      </section>
    );
  }

  const priceListName = getActivityPriceListName(detail);
  const changedFieldEntries = Object.entries(detail.changed_fields ?? {});

  return (
    <section
      className={mergeClassNames(
        "activity-details",
        isProductPriceUpdate(detail) && "activity-details--price-update",
      )}
    >
      <div className="activity-details-title">
        <strong>{detail.action}</strong>
        {isProductPriceUpdate(detail) && detail.product_name && (
          <strong className="activity-product-name">
            {detail.product_name}
          </strong>
        )}
        {detail.entity_label && <span>{detail.entity_label}</span>}
        {detail.device && (
          <span className="activity-device">{detail.device}</span>
        )}
      </div>
      {(priceListName || changedFieldEntries.length > 0) && (
        <ul>
          {priceListName && (
            <li key="price_list_name">
              <span>Bảng giá</span>
              <strong>{priceListName}</strong>
            </li>
          )}
          {changedFieldEntries
            .filter(([key]) => key !== "price_list_name" || !priceListName)
            .map(([key, change]) => (
              <li key={key}>
                <span>{fieldLabels[key] ?? key}</span>
                {change.before !== null && change.before !== undefined ? (
                  <span>
                    {displayValue(change.before, key)} →{" "}
                    {displayValue(change.after, key)}
                  </span>
                ) : (
                  <span>{displayValue(change.after, key)}</span>
                )}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function deriveInvoiceUnitPrice(
  quantity: ActivityHistoryChange | null,
  lineTotal: ActivityHistoryChange | null,
): ActivityHistoryChange | null {
  const derive = (amount: unknown, units: unknown) => {
    const numericAmount = Number(amount);
    const numericUnits = Number(units);
    return Number.isFinite(numericAmount) &&
      Number.isFinite(numericUnits) &&
      numericUnits !== 0
      ? numericAmount / numericUnits
      : null;
  };
  const before = derive(lineTotal?.before, quantity?.before);
  const after = derive(lineTotal?.after, quantity?.after);
  if (before === null && after === null) return null;
  return { before, after };
}

function ActivityDetails({ row }: { row: ActivityRow }) {
  const [expanded, setExpanded] = useState(false);
  const details = getActivityDetails(row);
  const visibleDetails = expanded ? details : details.slice(0, 3);
  const hiddenCount = details.length - visibleDetails.length;

  return (
    <div className="activity-operation-details">
      {visibleDetails.map((detail) => (
        <ActivityDetailContent
          key={detail.id}
          detail={detail}
          compactDocument={
            row.feature === "Đơn hàng" || row.feature === "Nhập hàng"
          }
        />
      ))}
      {details.length > 3 && (
        <button
          className="activity-details-expand"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Thu gọn" : `Xem thêm ${hiddenCount} dòng`}
        </button>
      )}
    </div>
  );
}

export function ActivityHistoryManagement() {
  const supabase = useMemo(() => createClient(), []);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<Filters>(() => {
    const today = todayLocal();
    return {
      from: today,
      to: today,
      query: "",
      employee: "",
      feature: "",
      action: "",
    };
  });
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<DataTableSort>({
    key: "occurred_at",
    direction: "desc",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  useEffect(() => {
    let active = true;
    getUserPermissions()
      .then((access) => {
        if (active)
          setAuthorized(
            Boolean(
              access && canAccessPage("activityHistory", access.permissions),
            ),
          );
      })
      .catch(() => {
        if (active) setAuthorized(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(filters.query.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [filters.query]);

  useEffect(() => {
    if (!authorized) return;
    let active = true;
    supabase
      .rpc("get_activity_history_employees")
      .then((result: { data: unknown }) => {
        if (active) setEmployees((result.data ?? []) as EmployeeOption[]);
      });
    return () => {
      active = false;
    };
  }, [authorized, supabase]);

  const loadRows = useCallback(async () => {
    if (!authorized) return;
    const requestId = ++requestVersion.current;
    const { data, error: queryError } = await supabase.rpc(
      "get_activity_history",
      {
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_query: debouncedQuery,
        p_employee: filters.employee || null,
        p_feature: filters.feature || null,
        p_action: filters.action || null,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
        p_sort: sort.key,
        p_direction: sort.direction,
      },
    );
    if (requestId !== requestVersion.current) return;
    if (queryError) {
      setError("Không thể tải lịch sử thao tác. Vui lòng thử lại.");
      setRows([]);
      setTotal(0);
    } else {
      const result = data as ActivityResult | null;
      setRows(result?.rows ?? []);
      setTotal(Number(result?.total ?? 0));
    }
    setLoading(false);
  }, [
    authorized,
    debouncedQuery,
    filters.action,
    filters.employee,
    filters.feature,
    filters.from,
    filters.to,
    page,
    sort,
    supabase,
  ]);

  // This effect synchronizes the remote query with filters and pagination.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
  }, [loadRows]);

  const changeFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setLoading(true);
  };
  const changeDates = (from: string, to: string) => {
    setFilters((current) => ({ ...current, from, to }));
    setPage(1);
    setLoading(true);
  };

  const columns: DataColumn<ActivityRow>[] = [
    {
      key: "actor_name",
      label: "Nhân viên",
      headerClassName: "activity-history-column-employee",
      cellClassName: "activity-history-column-employee",
      value: (row) => row.actor_name,
      render: (row) => row.actor_name,
    },
    {
      key: "feature",
      label: "Tính năng",
      headerClassName: "activity-history-column-feature",
      cellClassName: "activity-history-column-feature",
      value: (row) => row.feature,
      render: (row) => row.feature,
    },
    {
      key: "occurred_at",
      label: "Thời gian",
      headerClassName: "activity-history-column-time",
      cellClassName: "activity-history-column-time",
      value: (row) => row.occurred_at,
      render: (row) => formatDateTime(row.occurred_at),
    },
    {
      key: "details",
      label: "Chi tiết",
      headerClassName: "activity-history-column-details",
      cellClassName: "activity-history-column-details",
      value: (row) =>
        getActivityDetails(row)
          .map(
            ({ action, entity_label, changed_fields }) =>
              `${action} ${entity_label} ${JSON.stringify(changed_fields)}`,
          )
          .join(" "),
      render: (row) => <ActivityDetails row={row} />,
    },
  ];

  if (authorized === null) return <LoadingSkeleton rows={6} />;
  if (!authorized)
    return (
      <div className="alert">
        Tài khoản không có quyền xem lịch sử thao tác.
      </div>
    );

  const selectOptions = (values: string[]): AppSelectOption[] => [
    { value: "", label: "Tất cả" },
    ...values.map((value) => ({ value, label: value })),
  ];
  const employeeOptions: AppSelectOption[] = [
    { value: "", label: "Tất cả nhân viên" },
    ...employees.map(({ actor_id, actor_name }) => ({
      value: actor_id ?? "",
      label: actor_name,
    })),
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Lịch sử thao tác</h1>
          <p>Theo dõi các thay đổi của nhân viên trong hệ thống.</p>
        </div>
      </div>
      <div className="activity-history-workspace">
        <aside
          className="product-filters card activity-history-filters"
          aria-label="Bộ lọc lịch sử thao tác"
        >
          <h2 className="filter-panel-title">Bộ lọc</h2>
          <label className="form-label activity-date-filter">
            Khoảng thời gian
            <DateRangeInput
              start={filters.from}
              end={filters.to}
              ariaLabel="Lọc lịch sử theo khoảng thời gian"
              onChange={changeDates}
            />
          </label>
          <label className="form-label">
            Tìm kiếm
            <AppInput
              className="field"
              placeholder="Tính năng, nhân viên, chi tiết"
              value={filters.query}
              onChange={(event) => changeFilter("query", event.target.value)}
            />
          </label>
          <label className="form-label">
            Nhân viên
            <AppSelect
              ariaLabel="Lọc theo nhân viên"
              options={employeeOptions}
              value={filters.employee}
              onChange={(value) => changeFilter("employee", value)}
              isSearchable
            />
          </label>
          <label className="form-label">
            Tính năng
            <AppSelect
              ariaLabel="Lọc theo tính năng"
              options={selectOptions(features)}
              value={filters.feature}
              onChange={(value) => changeFilter("feature", value)}
            />
          </label>
          <label className="form-label">
            Thao tác
            <AppSelect
              ariaLabel="Lọc theo thao tác"
              options={selectOptions(actions)}
              value={filters.action}
              onChange={(value) => changeFilter("action", value)}
            />
          </label>
          <AppButton
            variant="ghost"
            type="button"
            onClick={() => {
              const today = todayLocal();
              setFilters({
                from: today,
                to: today,
                query: "",
                employee: "",
                feature: "",
                action: "",
              });
              setPage(1);
              setLoading(true);
            }}
          >
            Đặt lại
          </AppButton>
        </aside>
        <section
          className="activity-history-results card table-wrap"
          aria-label="Bảng lịch sử thao tác"
        >
          <div className="activity-history-desktop">
            {loading && rows.length === 0 ? (
              <LoadingSkeleton rows={7} />
            ) : (
              <DataTable
                rows={rows}
                columns={columns}
                rowKey={(row) => String(row.id)}
                empty={
                  error ? (
                    <span className="alert">{error}</span>
                  ) : (
                    <span>Không có lịch sử thao tác phù hợp.</span>
                  )
                }
                storageKey="activity-history"
                title="Lịch sử thao tác"
                toolbarSummary={
                  <span>
                    Tổng số lượt: <b>{total.toLocaleString("vi-VN")}</b>
                  </span>
                }
                serverSort={{
                  value: sort,
                  onChange: (value) => {
                    setLoading(true);
                    setSort(value);
                  },
                }}
                onRowClick={openActivityTarget}
                isRowClickable={(row) => Boolean(getActivityTargetHref(row))}
                totalRows={total}
              />
            )}
          </div>
          <div className="activity-history-mobile">
            {loading && rows.length === 0 ? (
              <LoadingSkeleton rows={5} />
            ) : error ? (
              <div className="alert">{error}</div>
            ) : rows.length ? (
              rows.map((row) => {
                const targetHref = getActivityTargetHref(row);
                return (
                  <article
                    className={mergeClassNames(
                      "activity-history-card",
                      targetHref && "activity-history-card--clickable",
                    )}
                    key={row.id}
                    data-operation-id={row.operation_id}
                    role={targetHref ? "link" : undefined}
                    tabIndex={targetHref ? 0 : undefined}
                    aria-label={
                      targetHref
                        ? `Mở chi tiết ${row.feature.toLocaleLowerCase("vi-VN")}`
                        : undefined
                    }
                    onClick={(event) => {
                      if (
                        !targetHref ||
                        (event.target instanceof Element &&
                          event.target.closest(
                            "button, a, input, select, textarea",
                          ))
                      )
                        return;
                      openActivityTarget(row);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.target !== event.currentTarget ||
                        (event.key !== "Enter" && event.key !== " ") ||
                        !targetHref
                      )
                        return;
                      event.preventDefault();
                      openActivityTarget(row);
                    }}
                  >
                    <div className="activity-history-card-meta">
                      <strong>{row.actor_name}</strong>
                      <time dateTime={row.occurred_at}>
                        {formatDateTime(row.occurred_at)}
                      </time>
                    </div>
                    <div className="activity-history-card-feature">
                      {row.feature}
                    </div>
                    <ActivityDetails row={row} />
                  </article>
                );
              })
            ) : (
              <div className="empty-state">
                Không có lịch sử thao tác phù hợp.
              </div>
            )}
          </div>
          <AppPagination
            page={page - 1}
            pageSize={pageSize}
            totalRows={total}
            disabled={loading}
            onPageChange={(nextPage) => {
              setLoading(true);
              setPage(nextPage + 1);
            }}
          />
          {loading && rows.length > 0 && (
            <div className="activity-history-refresh" role="status">
              <History size={14} /> Đang cập nhật…
            </div>
          )}
        </section>
      </div>
    </>
  );
}
