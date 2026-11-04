import { describe, expect, it } from "vitest";
import {
  aggregateProductAnalysis,
  allocateOrderDiscount,
  buildProductComboSuggestions,
  calculateGrossProfitPerUnit,
  grossProfitPerUnitChartValue,
  productIdFromAnalysisKey,
  sumProductAnalysisMetricDays,
  type ProductAnalysisLine,
  type ProductAnalysisMetricDay,
} from "./product-analysis";

function line(
  overrides: Partial<ProductAnalysisLine> = {},
): ProductAnalysisLine {
  return {
    id: "line-1",
    order_id: "order-1",
    product_id: "product-1",
    product_name: "Trà xanh",
    current_product_name: "Trà xanh",
    quantity: 1,
    line_total: 100,
    stock: 8,
    unit_cost: 20,
    created_at: "2026-10-28T03:00:00.000Z",
    order_discount: 0,
    ...overrides,
  };
}

describe("product analysis metrics", () => {
  it("allocates order discounts by largest remainder and preserves the total", () => {
    expect(allocateOrderDiscount([100, 200], 100)).toEqual([33, 67]);
    expect(allocateOrderDiscount([1, 1], 1)).toEqual([1, 0]);
    expect(allocateOrderDiscount([100, 200], 500)).toEqual([100, 200]);
  });

  it("aggregates net revenue and leaves profit unavailable when a cost snapshot is missing", () => {
    const products = aggregateProductAnalysis([
      line({
        id: "line-1",
        line_total: 100,
        order_discount: 30,
        unit_cost: 20,
      }),
      line({
        id: "line-2",
        product_id: "product-2",
        product_name: "Cà phê",
        line_total: 200,
        order_discount: 30,
        unit_cost: null,
      }),
    ]);

    expect(products).toEqual([
      expect.objectContaining({
        key: "product:product-1",
        revenue: 90,
        gross_profit: 70,
      }),
      expect.objectContaining({
        key: "product:product-2",
        revenue: 180,
        gross_profit: null,
      }),
    ]);
  });

  it("counts each product pair once per completed order", () => {
    const combos = buildProductComboSuggestions([
      line({
        id: "line-1",
        product_id: "a",
        product_name: "A",
        current_product_name: "A",
      }),
      line({
        id: "line-2",
        product_id: "a",
        product_name: "A",
        current_product_name: "A",
        quantity: 2,
      }),
      line({
        id: "line-3",
        product_id: "b",
        product_name: "B",
        current_product_name: "B",
      }),
      line({
        id: "line-4",
        order_id: "order-2",
        product_id: "a",
        product_name: "A",
        current_product_name: "A",
      }),
      line({
        id: "line-5",
        order_id: "order-2",
        product_id: "b",
        product_name: "B",
        current_product_name: "B",
      }),
    ]);

    expect(combos).toEqual([
      expect.objectContaining({
        first_product: "A",
        second_product: "B",
        co_order_count: 2,
      }),
    ]);
  });

  it("keeps decimal invoice quantities for bundles and individual products", () => {
    const products = aggregateProductAnalysis([
      line({ quantity: 1.25, line_total: 250, unit_cost: 100 }),
      line({
        id: "line-2",
        product_id: "combo-1",
        product_name: "Combo",
        quantity: 0.5,
        line_total: 200,
        unit_cost: 120,
      }),
    ]);

    expect(products.map(({ quantity }) => quantity)).toEqual([1.25, 0.5]);
    expect(products.map(({ gross_profit }) => gross_profit)).toEqual([
      125, 140,
    ]);
  });

  it("divides total gross profit by total sold quantity rather than averaging daily ratios", () => {
    const days: ProductAnalysisMetricDay[] = [
      {
        date: "2026-10-26",
        version: 1,
        quantity: 2,
        revenue: 400,
        gross_profit: 100,
        missing_cost_line_count: 0,
        product_count: 1,
        value: 50,
      },
      {
        date: "2026-10-27",
        version: 1,
        quantity: 10,
        revenue: 3000,
        gross_profit: 300,
        missing_cost_line_count: 0,
        product_count: 1,
        value: 30,
      },
    ];

    const totals = sumProductAnalysisMetricDays(days);
    expect(totals.grossProfitPerUnit).toBe(400 / 12);
    expect(totals.grossProfitPerUnit).not.toBe((50 + 30) / 2);
    expect(calculateGrossProfitPerUnit(400, 0)).toBeNull();
  });

  it("keeps profit unavailable when any daily source line lacks a cost snapshot", () => {
    const totals = sumProductAnalysisMetricDays([
      {
        date: "2026-10-26",
        version: 1,
        quantity: 2.5,
        revenue: 1000,
        gross_profit: 500,
        missing_cost_line_count: 0,
        product_count: 1,
        value: 200,
      },
      {
        date: "2026-10-27",
        version: 1,
        quantity: 1,
        revenue: 400,
        gross_profit: null,
        missing_cost_line_count: 1,
        product_count: 1,
        value: null,
      },
    ]);

    expect(totals.grossProfit).toBeNull();
    expect(totals.grossProfitPerUnit).toBeNull();
  });

  it("plots a zero gross-profit-per-unit value on a day without sales", () => {
    expect(
      grossProfitPerUnitChartValue({
        date: "2026-10-28",
        version: 1,
        quantity: 0,
        revenue: 0,
        gross_profit: 0,
        missing_cost_line_count: 0,
        product_count: 0,
        value: null,
      }),
    ).toBe(0);
    expect(grossProfitPerUnitChartValue(undefined)).toBeNull();
    expect(
      grossProfitPerUnitChartValue({
        date: "2026-10-27",
        version: 1,
        quantity: 0,
        revenue: 0,
        gross_profit: null,
        missing_cost_line_count: 1,
        product_count: 0,
        value: null,
      }),
    ).toBeNull();
  });

  it("does not make historical products without IDs navigable", () => {
    expect(productIdFromAnalysisKey("product:product-id")).toBe("product-id");
    expect(productIdFromAnalysisKey("name:legacy product")).toBeNull();
  });
});
