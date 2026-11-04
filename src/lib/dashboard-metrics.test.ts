import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  buildDashboardRevenueChart,
  getReportingRangeBounds,
  summarizeDashboardOrders,
} from "./dashboard-metrics";

describe("dashboard metrics", () => {
  it("uses an exclusive next-day boundary for the selected local date range", () => {
    expect(getReportingRangeBounds("2026-10-06", "2026-10-08")).toEqual({
      start: "2026-10-06T00:00:00+07:00",
      endExclusive: "2026-10-09T00:00:00+07:00",
    });
  });

  it("advances dates across month, year, and leap-day boundaries", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("totals revenue, order count, and available profit snapshots", () => {
    expect(
      summarizeDashboardOrders([
        {
          total: 125_000,
          subtotal: 125_000,
          discount: 0,
          order_profit_snapshots: { profit: 28_000 },
        },
        {
          total: 75_000,
          subtotal: 100_000,
          discount: 25_000,
          order_profit_snapshots: null,
        },
      ]),
    ).toEqual({
      revenue: 200_000,
      subtotal: 225_000,
      discount: 25_000,
      orderCount: 2,
      profit: 28_000,
    });
  });

  it("shows only hours containing invoices for a single-day chart", () => {
    expect(
      buildDashboardRevenueChart(
        [
          { total: 100_000, created_at: "2026-10-20T03:10:00.000Z" },
          { total: 25_000, created_at: "2026-10-20T03:55:00.000Z" },
          { total: 70_000, created_at: "2026-10-20T07:05:00.000Z" },
          { total: 999_000, created_at: "2026-10-19T16:00:00.000Z" },
        ],
        { from: "2026-10-20", to: "2026-10-20" },
      ),
    ).toEqual([
      {
        label: "10:00",
        revenue: 125_000,
        from: "2026-10-20",
        to: "2026-10-20",
        fromTime: "10:00",
        toTime: "10:59",
      },
      {
        label: "14:00",
        revenue: 70_000,
        from: "2026-10-20",
        to: "2026-10-20",
        fromTime: "14:00",
        toTime: "14:59",
      },
    ]);
  });

  it("keeps a same-day chart empty when there are no invoices", () => {
    expect(
      buildDashboardRevenueChart([], {
        from: "2026-10-20",
        to: "2026-10-20",
      }),
    ).toEqual([]);
  });

  it("keeps the exact date on each multi-day chart point", () => {
    expect(
      buildDashboardRevenueChart(
        [
          { total: 100_000, created_at: "2026-10-20T03:10:00.000Z" },
          { total: 70_000, created_at: "2026-10-21T03:10:00.000Z" },
        ],
        { from: "2026-10-20", to: "2026-10-21" },
      ),
    ).toEqual([
      {
        label: "20/10/2026",
        revenue: 100_000,
        from: "2026-10-20",
        to: "2026-10-20",
      },
      {
        label: "21/10/2026",
        revenue: 70_000,
        from: "2026-10-21",
        to: "2026-10-21",
      },
    ]);
  });
});
