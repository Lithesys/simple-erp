"use client";

import { AppTable, type AppTableColumn } from "@/components/app-table";
import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { AppSelect } from "@/components/app-select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModalLayer } from "@/components/modal-layer";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { createClient } from "@/lib/data/client";
import { formatDate } from "@/lib/date";
import { formatQuantity, formatVnd } from "@/lib/format";
import { DateRangeInput } from "@/components/date-range-input";
import { usePreference } from "@/lib/preferences";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { getUserPermissions } from "@/lib/auth";
import { canAccessPage } from "@/lib/access-control";
import {
  buildDashboardRevenueChart,
  getReportingDate,
  getReportingRangeBounds,
  summarizeDashboardOrders,
  type DashboardChartPoint,
  type DashboardOrder,
} from "@/lib/dashboard-metrics";
import {
  aggregateDashboardProducts,
  sortDashboardProducts,
  type DashboardProductMetric,
  type DashboardProductSalesRow,
} from "@/lib/dashboard-products";
import {
  dashboardRevenueOrdersHref,
  dashboardChartOrdersHref,
  productOrdersHref,
  type OrderMetricColumn,
} from "@/lib/management-navigation";
import { announceAppNavigationStart } from "@/lib/navigation-progress";

type Order = DashboardOrder & { id: string; created_at: string };
type SoldLine = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  line_total: number;
  products: { name: string; stock: number } | null;
};
type DashboardRange = { from: string; to: string };
type PendingProductOrdersNavigation = {
  productId: string;
  productName: string;
  from: string;
  to: string;
};
type PendingChartOrdersNavigation = DashboardRange & {
  fromTime?: string;
  toTime?: string;
};
type RevenueMetricRow = {
  key: OrderMetricColumn;
  label: string;
  amount: number;
};

function dashboardProductId(product: DashboardProductSalesRow) {
  return product.key.startsWith("product:")
    ? product.key.slice("product:".length)
    : "";
}

function formatDashboardPointDateTime(date: string, time?: string) {
  return time ? `${formatDate(date)} ${time}` : formatDate(date);
}

async function readAllPages<T>(
  loadPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
) {
  const pageSize = 1000;
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const result = await loadPage(offset, offset + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += pageSize;
  }
}

export default function DashboardPage() {
  const pathname = usePathname();
  const router = useRouter();
  const isMobileRoute = pathname.startsWith("/mobile/");
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof getUserPermissions>>>(null);
  const [range, setRange] = useState<DashboardRange>(() => {
    const today = getReportingDate();
    return { from: today, to: today };
  });
  const [productMetric, setProductMetric] =
    useState<DashboardProductMetric>("quantity");
  const [pendingProductOrdersNavigation, setPendingProductOrdersNavigation] =
    useState<PendingProductOrdersNavigation | null>(null);
  const [pendingChartOrdersNavigation, setPendingChartOrdersNavigation] =
    useState<PendingChartOrdersNavigation | null>(null);
  const [revenueDetailsOpen, setRevenueDetailsOpen] = useState(false);
  const [productLimit, setProductLimit] = usePreference(
    "dashboard.products.limit",
    8,
  );
  const visibleProductLimit = Number.isFinite(Number(productLimit))
    ? Math.min(1000, Math.max(1, Math.floor(Number(productLimit))))
    : 8;

  useEffect(() => {
    getUserPermissions().then(setAccess);
  }, []);

  const supabase = createClient();
  const canViewDashboard = Boolean(
    access && canAccessPage("dashboard", access.permissions),
  );
  const canViewProfit = Boolean(
    access?.permissions.includes("products.cost.read"),
  );
  const canViewOrders = Boolean(
    access && canAccessPage("orders", access.permissions),
  );
  const { start, endExclusive } = getReportingRangeBounds(range.from, range.to);
  const {
    data,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ["dashboard", range.from, range.to, canViewProfit],
    enabled: canViewDashboard,
    queryFn: async () => {
      const orderColumns =
        "id,total,subtotal,discount,created_at" +
        (canViewProfit ? ",order_profit_snapshots(profit)" : "");
      const [orders, soldLines] = await Promise.all([
        readAllPages<Order>(async (from, to) => {
          let request = supabase
            .from("orders")
            .select(orderColumns)
            .eq("status", "completed")
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to);
          if (start) request = request.gte("created_at", start);
          if (endExclusive) request = request.lt("created_at", endExclusive);
          const result = await request;
          return {
            data: result.data as unknown as Order[] | null,
            error: result.error,
          };
        }),
        readAllPages<SoldLine>(async (from, to) => {
          let request = supabase
            .from("order_items")
            .select(
              "id,product_id,product_name,quantity,line_total,products(name,stock),orders!inner(created_at,status)",
            )
            .eq("orders.status", "completed")
            .order("id", { ascending: true })
            .range(from, to);
          if (start) request = request.gte("orders.created_at", start);
          if (endExclusive)
            request = request.lt("orders.created_at", endExclusive);
          const result = await request;
          return {
            data: result.data as unknown as SoldLine[] | null,
            error: result.error,
          };
        }),
      ]);

      return {
        orders,
        metrics: summarizeDashboardOrders(orders),
        sold: aggregateDashboardProducts(
          soldLines.map((line) => ({
            product_id: line.product_id,
            product_name: line.product_name,
            current_product_name: line.products?.name,
            quantity: Number(line.quantity),
            revenue: Number(line.line_total),
            stock: line.products?.stock ?? null,
          })),
        ),
      };
    },
  });

  const orders = useMemo(() => data?.orders ?? [], [data?.orders]);
  const sold = sortDashboardProducts(data?.sold ?? [], productMetric).slice(
    0,
    visibleProductLimit,
  );
  const productColumns = useMemo<AppTableColumn<DashboardProductSalesRow>[]>(
    () => [
      {
        key: "product_name",
        title: "Hàng hóa",
        sortable: false,
        render: (item) => (
          <div className="dashboard-product-name">
            <strong>{item.product_name}</strong>
            <span>
              Hàng tồn: {item.stock === null ? "—" : formatQuantity(item.stock)}
            </span>
          </div>
        ),
      },
      {
        key: "metric",
        title: productMetric === "quantity" ? "Số lượng bán" : "Doanh thu",
        sortable: false,
        align: "right",
        cellClassName: "dashboard-products-metric-cell",
        render: (item) =>
          productMetric === "quantity"
            ? formatQuantity(item.quantity)
            : formatVnd(item.revenue),
      },
    ],
    [productMetric],
  );
  const soldTotal = sold.reduce((sum, item) => sum + item[productMetric], 0);
  const chart = useMemo(
    () => buildDashboardRevenueChart(orders, range),
    [orders, range],
  );
  const error = queryError instanceof Error ? queryError.message : "";
  const revenueMetricRows: RevenueMetricRow[] = [
    {
      key: "subtotal",
      label: "Tổng tiền hàng",
      amount: data?.metrics.subtotal ?? 0,
    },
    {
      key: "discount",
      label: "Giảm giá hóa đơn",
      amount: data?.metrics.discount ?? 0,
    },
    ...(canViewProfit
      ? [
          {
            key: "profit" as const,
            label: "Tiền lời",
            amount: data?.metrics.profit ?? 0,
          },
        ]
      : []),
  ];
  const revenueMetricColumns: AppTableColumn<RevenueMetricRow>[] = [
    {
      key: "label",
      title: "Thông tin",
      sortable: false,
      render: (row) => row.label,
    },
    {
      key: "amount",
      title: "Giá trị",
      sortable: false,
      align: "right",
      cellClassName: "dashboard-revenue-breakdown-value",
      render: (row) => formatVnd(row.amount),
    },
  ];

  function confirmProductOrders(product: DashboardProductSalesRow) {
    const productId = dashboardProductId(product);
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

  function openRevenueDetails() {
    if (!canViewOrders) return;
    if (isMobileRoute) {
      announceAppNavigationStart();
      router.push(
        dashboardRevenueOrdersHref("subtotal", range.from, range.to, true),
      );
      return;
    }
    setRevenueDetailsOpen(true);
  }

  function openRevenueMetricOrders(metricColumn: OrderMetricColumn) {
    setRevenueDetailsOpen(false);
    announceAppNavigationStart();
    router.push(
      dashboardRevenueOrdersHref(
        metricColumn,
        range.from,
        range.to,
        isMobileRoute,
      ),
    );
  }

  function confirmChartOrders(point: DashboardChartPoint | undefined) {
    if (!canViewOrders || !point) return;
    setPendingChartOrdersNavigation({
      from: point.from,
      to: point.to,
      fromTime: point.fromTime,
      toTime: point.toTime,
    });
  }

  function openChartOrders() {
    const pending = pendingChartOrdersNavigation;
    setPendingChartOrdersNavigation(null);
    if (!pending) return;
    announceAppNavigationStart();
    router.push(
      dashboardChartOrdersHref(
        pending.from,
        pending.to,
        isMobileRoute,
        pending.fromTime,
        pending.toTime,
      ),
    );
  }

  if (!access) return <LoadingSkeleton rows={6} />;
  if (!canViewDashboard)
    return (
      <div className="alert">
        Tài khoản không có quyền xem thống kê đơn hàng.
      </div>
    );

  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <h1>Tổng quan</h1>
          <p>Số liệu bán hàng theo khoảng thời gian đã chọn.</p>
        </div>
        <DateRangeInput
          start={range.from}
          end={range.to}
          className="field date-range-field dashboard-date-range-field"
          ariaLabel="Khoảng thời gian báo cáo"
          onChange={(from, to) => setRange({ from, to })}
        />
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <>
          <section className="dashboard-metrics">
            {canViewOrders ? (
              <AppButton
                variant="ghost"
                type="button"
                className="card dashboard-metric dashboard-metric-button"
                aria-haspopup={isMobileRoute ? undefined : "dialog"}
                onClick={openRevenueDetails}
              >
                <span>Doanh thu</span>
                <strong>{formatVnd(data?.metrics.revenue ?? 0)}</strong>
              </AppButton>
            ) : (
              <article className="card dashboard-metric">
                <span>Doanh thu</span>
                <strong>{formatVnd(data?.metrics.revenue ?? 0)}</strong>
              </article>
            )}
            <article className="card dashboard-metric">
              <span>Số đơn</span>
              <strong>{formatQuantity(data?.metrics.orderCount ?? 0)}</strong>
            </article>
            {canViewProfit && (
              <article className="card dashboard-metric">
                <span>Tiền lời</span>
                <strong>{formatVnd(data?.metrics.profit ?? 0)}</strong>
              </article>
            )}
          </section>
          <section className="card dashboard-card">
            <h2>
              Doanh thu theo{" "}
              {range.from && range.from === range.to ? "giờ" : "ngày"}
            </h2>
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border-subtle)"
                  />
                  <XAxis
                    dataKey="label"
                    interval="preserveStartEnd"
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value: number) =>
                      new Intl.NumberFormat("vi-VN", {
                        notation: "compact",
                      }).format(value)
                    }
                  />
                  <Tooltip formatter={(value) => formatVnd(Number(value))} />
                  <Bar
                    dataKey="revenue"
                    name="Doanh thu"
                    fill="var(--primary)"
                    radius={[4, 4, 0, 0]}
                    cursor={canViewOrders ? "pointer" : "default"}
                    onClick={(entry) =>
                      confirmChartOrders(
                        entry?.payload as DashboardChartPoint | undefined,
                      )
                    }
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card table-wrap dashboard-products">
            <AppTable
              heading={<h2>Hàng hoá bán chạy</h2>}
              tools={
                <div className="dashboard-products-tools">
                  <label className="dashboard-product-sort">
                    <span>Sắp xếp</span>
                    <AppSelect
                      ariaLabel="Sắp xếp hàng hóa bán chạy theo"
                      value={productMetric}
                      onChange={(value) =>
                        setProductMetric(value as DashboardProductMetric)
                      }
                      options={[
                        { value: "quantity", label: "Số lượng bán" },
                        { value: "revenue", label: "Doanh thu" },
                      ]}
                    />
                  </label>
                  <label className="dashboard-product-limit">
                    <span>Số hàng hiển thị</span>
                    <AppInput
                      className="field"
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      aria-label="Số hàng hóa hiển thị"
                      value={visibleProductLimit}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setProductLimit(
                          Number.isFinite(value)
                            ? Math.min(1000, Math.max(1, Math.floor(value)))
                            : 8,
                        );
                      }}
                    />
                  </label>
                </div>
              }
            >
              <thead>
                <tr>
                  <th>Hàng hóa</th>
                  <th className="dashboard-products-metric-heading">
                    {productMetric === "quantity"
                      ? "Số lượng bán"
                      : "Doanh thu"}
                  </th>
                </tr>
                <tr className="table-summary-row">
                  <th>Tổng (top {sold.length})</th>
                  <th className="dashboard-products-metric-heading">
                    {productMetric === "quantity"
                      ? formatQuantity(soldTotal)
                      : formatVnd(soldTotal)}
                  </th>
                </tr>
              </thead>
              <AppTable.Body
                rows={sold}
                columns={productColumns}
                rowKey={(item) => item.key}
                empty="Chưa có hàng bán trong khoảng thời gian này."
                onRowClick={confirmProductOrders}
                isRowClickable={(item) =>
                  canViewOrders && Boolean(dashboardProductId(item))
                }
              />
            </AppTable>
          </section>
        </>
      )}
      <ModalLayer
        open={revenueDetailsOpen}
        className="modal-backdrop dashboard-revenue-modal-backdrop"
        onEscape={() => setRevenueDetailsOpen(false)}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget)
            setRevenueDetailsOpen(false);
        }}
      >
        <section
          className="card modal dashboard-revenue-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-revenue-modal-title"
        >
          <div className="modal-title">
            <div>
              <h2 id="dashboard-revenue-modal-title">Doanh thu</h2>
              <strong>{formatVnd(data?.metrics.revenue ?? 0)}</strong>
            </div>
            <AppButton
              variant="ghost"
              type="button"
              iconOnly
              aria-label="Đóng chi tiết doanh thu"
              onClick={() => setRevenueDetailsOpen(false)}
            >
              <X size={18} aria-hidden="true" />
            </AppButton>
          </div>
          <p className="dashboard-revenue-modal-range">
            {formatDate(range.from)} – {formatDate(range.to)}
          </p>
          <AppTable className="dashboard-revenue-breakdown" striped={false}>
            <AppTable.Header
              columns={revenueMetricColumns}
              showTotalsRow={false}
            />
            <AppTable.Body
              rows={revenueMetricRows}
              columns={revenueMetricColumns}
              rowKey={(row) => row.key}
              empty="Chưa có số liệu doanh thu."
              onRowClick={(row) => openRevenueMetricOrders(row.key)}
              isRowClickable={(row) =>
                canViewOrders && (row.key !== "profit" || canViewProfit)
              }
            />
          </AppTable>
        </section>
      </ModalLayer>
      <ConfirmDialog
        request={
          pendingChartOrdersNavigation
            ? {
                title: "Xem những hóa đơn liên quan?",
                message: `Danh sách sẽ được lọc từ ${formatDashboardPointDateTime(
                  pendingChartOrdersNavigation.from,
                  pendingChartOrdersNavigation.fromTime,
                )} tới ${formatDashboardPointDateTime(
                  pendingChartOrdersNavigation.to,
                  pendingChartOrdersNavigation.toTime,
                )}`,
                confirmLabel: "Xem hóa đơn",
                confirmVariant: "primary",
                showCloseButton: true,
              }
            : pendingProductOrdersNavigation
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
        onCancel={() => {
          setPendingChartOrdersNavigation(null);
          setPendingProductOrdersNavigation(null);
        }}
        onConfirm={
          pendingChartOrdersNavigation ? openChartOrders : openProductOrders
        }
      />
    </>
  );
}
