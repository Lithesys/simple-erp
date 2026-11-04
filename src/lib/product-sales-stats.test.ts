import { describe, expect, it } from "vitest";
import {
  buildProductSalesTrend,
  formatProductSalesDate,
  type ProductSalesDay,
} from "./product-sales-stats";

describe("product sales trend", () => {
  it("fills days without sales with zero values and preserves decimal quantity", () => {
    const days: ProductSalesDay[] = [
      {
        date: "2026-10-28",
        quantity: 1.5,
        revenue: 15000,
        gross_profit: 3000,
        missing_cost_line_count: 0,
      },
    ];

    expect(buildProductSalesTrend(days, "2026-10-27", "2026-10-29")).toEqual([
      {
        date: "2026-10-27",
        quantity: 0,
        revenue: 0,
        gross_profit: 0,
        missing_cost_line_count: 0,
        hasSales: false,
      },
      { ...days[0], hasSales: true },
      {
        date: "2026-10-29",
        quantity: 0,
        revenue: 0,
        gross_profit: 0,
        missing_cost_line_count: 0,
        hasSales: false,
      },
    ]);
  });

  it("keeps profit unavailable on dates with missing cost snapshots", () => {
    expect(
      buildProductSalesTrend(
        [
          {
            date: "2026-02-28",
            quantity: 2,
            revenue: 12000,
            gross_profit: null,
            missing_cost_line_count: 1,
          },
        ],
        "2026-02-28",
        "2026-02-28",
      )[0].gross_profit,
    ).toBeNull();
  });

  it("handles leap days and formats the full tooltip date", () => {
    expect(
      buildProductSalesTrend([], "2024-02-28", "2024-03-01").map(
        (day) => day.date,
      ),
    ).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    expect(formatProductSalesDate("2024-02-29")).toBe("29/02/2024");
  });

  it("returns no points for an invalid range", () => {
    expect(buildProductSalesTrend([], "2026-10-29", "2026-10-28")).toEqual([]);
  });
});
