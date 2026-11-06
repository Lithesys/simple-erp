"use client";

import { useEffect, useMemo, useState } from "react";
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
import { AppInput } from "@/components/app-input";
import { AppButton } from "@/components/app-button";
import { AppSelect } from "@/components/app-select";
import { DateRangeInput } from "@/components/date-range-input";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { canAccessPage } from "@/lib/access-control";
import { getUserPermissions } from "@/lib/auth";
import { addCalendarDays, getReportingDate } from "@/lib/dashboard-metrics";
import { formatDate } from "@/lib/date";
import { formatVnd } from "@/lib/format";
import {
  fetchSalesAnalysisChart,
  fetchSalesAnalysisPriceLists,
  type SalesAnalysisMetric,
  type SalesAnalysisRange,
} from "@/lib/sales-analysis-api";
import { createClient } from "@/lib/data/client";

type SalesAnalysisAccess = NonNullable<
  Awaited<ReturnType<typeof getUserPermissions>>
>;

function currentWeekRange(): SalesAnalysisRange {
  const today = getReportingDate();
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const from = addCalendarDays(today, -mondayOffset);
  return { from, to: today };
}

const metricOptions: { value: SalesAnalysisMetric; label: string }[] = [
  { value: "time", label: "Thời gian" },
  { value: "profit", label: "Lợi nhuận" },
  { value: "discount", label: "Giảm giá HĐ" },
  { value: "returns", label: "Trả hàng" },
  { value: "employee", label: "Nhân viên" },
];

function metricTitle(metric: SalesAnalysisMetric) {
  if (metric === "profit") return "Lợi nhuận";
  if (metric === "discount") return "Giảm giá hóa đơn";
  if (metric === "returns") return "Giá trị trả hàng";
  if (metric === "employee") return "Doanh thu theo nhân viên";
  return "Doanh thu thuần";
}

function formatAxisAmount(value: number) {
  if (Math.abs(value) >= 1_000_000)
    return `${new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 0,
    }).format(value / 1_000_000)} tr`;
  if (Math.abs(value) >= 1_000)
    return `${new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 0,
    }).format(value / 1_000)} k`;
  return new Intl.NumberFormat("vi-VN").format(value);
}

export default function SalesAnalysisPage() {
  const supabase = createClient();
  const [access, setAccess] = useState<SalesAnalysisAccess | null>(null);
  const [accessResolved, setAccessResolved] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [metric, setMetric] = useState<SalesAnalysisMetric>("time");
  const [view, setView] = useState<"chart" | "report">("chart");
  const [rangeMode, setRangeMode] = useState<"week" | "custom">("week");
  const [range, setRange] = useState<SalesAnalysisRange>(currentWeekRange);
  const [priceListId, setPriceListId] = useState("");

  useEffect(() => {
    let active = true;
    void getUserPermissions({ throwOnError: true })
      .then((result) => {
        if (!active) return;
        setAccess(result);
        setAccessResolved(true);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setAccessError(
          caught instanceof Error
            ? caught.message
            : "Không kiểm tra được quyền truy cập.",
        );
        setAccessResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const hasPageAccess = Boolean(
    access && canAccessPage("salesAnalysis", access.permissions),
  );
  const canViewProfit = Boolean(access?.permissions.includes("products.cost.read"));
  const priceListsQuery = useQuery({
    queryKey: ["sales-analysis-price-lists", access?.user.id],
    enabled: Boolean(access?.user.id) && hasPageAccess,
    queryFn: () => fetchSalesAnalysisPriceLists(supabase),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const rangeTooLong = useMemo(() => {
    if (!range.from || !range.to) return false;
    const from = new Date(`${range.from}T00:00:00.000Z`).getTime();
    const to = new Date(`${range.to}T00:00:00.000Z`).getTime();
    return to < from || (to - from) / 86_400_000 > 365;
  }, [range.from, range.to]);
  const chartQuery = useQuery({
    queryKey: [
      "sales-analysis-chart",
      access?.user.id,
      range.from,
      range.to,
      metric,
      priceListId,
    ],
    enabled:
      Boolean(access?.user.id) &&
      hasPageAccess &&
      !rangeTooLong &&
      Boolean(range.from && range.to) &&
      (metric !== "profit" || canViewProfit),
    queryFn: () =>
      fetchSalesAnalysisChart(supabase, range, metric, priceListId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const chartRows = chartQuery.data ?? [];
  const title = `${metricTitle(metric)}${rangeMode === "week" ? " tuần này" : " theo thời gian"}`;

  if (!accessResolved) return <LoadingSkeleton rows={6} />;
  if (accessError)
    return (
      <div className="alert" role="alert">
        {accessError}
      </div>
    );
  if (!access)
    return <div className="alert">Không thể tải quyền tài khoản.</div>;
  if (!hasPageAccess)
    return <div className="alert">Tài khoản không có quyền xem phân tích bán hàng.</div>;

  return (
    <div className="sales-analysis-page">
      <div className="page-heading sales-analysis-heading">
        <div>
          <h1>Báo cáo bán hàng</h1>
        </div>
      </div>
      <div className="sales-analysis-layout">
        <aside className="card sales-analysis-filters" aria-label="Bộ lọc báo cáo bán hàng">
          <div className="sales-analysis-filter-group">
            <span>Kiểu hiển thị</span>
            <div className="sales-analysis-view-toggle" role="group" aria-label="Kiểu hiển thị">
              <AppButton
                type="button"
                variant={view === "chart" ? "primary" : "secondary"}
                aria-pressed={view === "chart"}
                onClick={() => setView("chart")}
              >
                Biểu đồ
              </AppButton>
              <AppButton
                type="button"
                variant={view === "report" ? "primary" : "secondary"}
                aria-pressed={view === "report"}
                onClick={() => setView("report")}
              >
                Báo cáo
              </AppButton>
            </div>
          </div>
          <label className="sales-analysis-filter-group">
            <span>Mối quan tâm</span>
            <AppSelect
              ariaLabel="Mối quan tâm"
              value={metric}
              options={metricOptions.filter(
                (option) => option.value !== "profit" || canViewProfit,
              )}
              onChange={(next) => setMetric(next as SalesAnalysisMetric)}
            />
          </label>
          <label className="sales-analysis-filter-group">
            <span>Bảng giá</span>
            <AppSelect
              ariaLabel="Bảng giá"
              value={priceListId}
              options={(priceListsQuery.data ?? []).map((list) => ({
                value: list.id,
                label: list.name,
              }))}
              onChange={setPriceListId}
              placeholder="Tất cả bảng giá"
              isClearable
              isDisabled={priceListsQuery.isPending}
            />
          </label>
          <fieldset className="sales-analysis-filter-group">
            <legend>Thời gian</legend>
            <label className="sales-analysis-radio">
              <AppInput
                type="radio"
                name="sales-analysis-range"
                value="week"
                checked={rangeMode === "week"}
                onChange={() => {
                  setRangeMode("week");
                  setRange(currentWeekRange());
                }}
              />
              <span>Tuần này</span>
            </label>
            <label className="sales-analysis-radio">
              <AppInput
                type="radio"
                name="sales-analysis-range"
                value="custom"
                checked={rangeMode === "custom"}
                onChange={() => setRangeMode("custom")}
              />
              <span>Tùy chỉnh</span>
            </label>
            {rangeMode === "custom" && (
              <DateRangeInput
                start={range.from}
                end={range.to}
                ariaLabel="Khoảng thời gian báo cáo bán hàng"
                className="field date-range-field sales-analysis-date-range"
                onChange={(from, to) => setRange({ from, to })}
              />
            )}
          </fieldset>
          <label className="sales-analysis-filter-group">
            <span>Phương thức bán hàng</span>
            <AppSelect
              ariaLabel="Phương thức bán hàng"
              value="counter"
              options={[{ value: "counter", label: "Bán tại quầy" }]}
              onChange={() => undefined}
              isDisabled
            />
          </label>
          <label className="sales-analysis-filter-group">
            <span>Kênh bán</span>
            <AppSelect
              ariaLabel="Kênh bán"
              value="pos"
              options={[{ value: "pos", label: "POS" }]}
              onChange={() => undefined}
              isDisabled
            />
          </label>
          <p className="sales-analysis-filter-note">
            Báo cáo hiện gồm các đơn bán tại quầy qua POS.
          </p>
        </aside>
        <section className="card sales-analysis-chart-card" aria-label={title}>
          <h2>{title}</h2>
          {rangeTooLong ? (
            <div className="sales-analysis-chart-message" role="alert">
              Khoảng thời gian tối đa là một năm.
            </div>
          ) : chartQuery.isError ? (
            <div className="sales-analysis-chart-message alert" role="alert">
              {chartQuery.error instanceof Error
                ? chartQuery.error.message
                : "Không tải được báo cáo bán hàng."}
            </div>
          ) : chartQuery.isPending && !chartRows.length ? (
            <div className="sales-analysis-chart-loading">
              <LoadingSkeleton rows={6} />
            </div>
          ) : chartRows.length && view === "chart" ? (
            <div className="sales-analysis-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 18, right: 16, bottom: 4, left: 0 }}>
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
                    width={68}
                    tick={{ fontSize: 11 }}
                    tickFormatter={formatAxisAmount}
                  />
                  <Tooltip
                    labelFormatter={(_, payload) => {
                      const date = payload?.[0]?.payload?.business_date;
                      return date ? formatDate(String(date)) : _;
                    }}
                    formatter={(value) => formatVnd(Number(value))}
                  />
                  <Bar
                    dataKey="amount"
                    name={metricTitle(metric)}
                    fill="var(--chart-blue, var(--primary))"
                    radius={[1, 1, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : chartRows.length && view === "report" ? (
            <div className="sales-analysis-report-wrap">
              <table className="app-table sales-analysis-report">
                <thead>
                  <tr>
                    <th scope="col">{metric === "employee" ? "Nhân viên" : "Ngày"}</th>
                    <th scope="col" className="sales-analysis-report-amount">
                      {metricTitle(metric)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {chartRows.map((point, index) => (
                    <tr key={`${point.business_date ?? point.label}-${index}`}>
                      <td>{point.business_date ? formatDate(point.business_date) : point.label}</td>
                      <td className="sales-analysis-report-amount">
                        {formatVnd(point.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Tổng</th>
                    <th className="sales-analysis-report-amount">
                      {formatVnd(chartRows.reduce((sum, point) => sum + point.amount, 0))}
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="sales-analysis-chart-message muted">
              Chưa có dữ liệu trong khoảng thời gian đã chọn.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
