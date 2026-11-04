import { describe, expect, it } from "vitest";
import {
  aggregateDashboardProducts,
  sortDashboardProducts,
  type DashboardProductSalesLine,
} from "./dashboard-products";

const lines: DashboardProductSalesLine[] = [
  {
    product_id: "cola",
    product_name: "Coca lon",
    current_product_name: "Coca lon",
    quantity: 2,
    revenue: 20_000,
    stock: 8,
  },
  {
    product_id: "cola",
    product_name: "Coca lon cũ",
    current_product_name: "Coca lon",
    quantity: 3,
    revenue: 45_000,
    stock: 8,
  },
  {
    product_id: "water",
    product_name: "Nước suối",
    quantity: 4,
    revenue: 90_000,
    stock: 3,
  },
  {
    product_id: null,
    product_name: "Sản phẩm đã xóa",
    quantity: 1,
    revenue: 1_000,
    stock: null,
  },
];

describe("dashboard products", () => {
  it("groups sales by product, retaining current stock and revenue totals", () => {
    expect(aggregateDashboardProducts(lines)).toEqual([
      {
        key: "product:cola",
        product_name: "Coca lon",
        quantity: 5,
        revenue: 65_000,
        stock: 8,
      },
      {
        key: "product:water",
        product_name: "Nước suối",
        quantity: 4,
        revenue: 90_000,
        stock: 3,
      },
      {
        key: "name:Sản phẩm đã xóa",
        product_name: "Sản phẩm đã xóa",
        quantity: 1,
        revenue: 1_000,
        stock: null,
      },
    ]);
  });

  it("ranks by the selected metric and uses a stable name tie-breaker", () => {
    const products = aggregateDashboardProducts(lines);

    expect(
      sortDashboardProducts(products, "quantity").map((row) => row.key),
    ).toEqual(["product:cola", "product:water", "name:Sản phẩm đã xóa"]);
    expect(
      sortDashboardProducts(products, "revenue").map((row) => row.key),
    ).toEqual(["product:water", "product:cola", "name:Sản phẩm đã xóa"]);

    expect(
      sortDashboardProducts(
        [
          {
            key: "product:z",
            product_name: "Zulu",
            quantity: 1,
            revenue: 1_000,
            stock: null,
          },
          {
            key: "product:a",
            product_name: "Alpha",
            quantity: 1,
            revenue: 1_000,
            stock: null,
          },
        ],
        "quantity",
      ).map((row) => row.key),
    ).toEqual(["product:a", "product:z"]);
  });
});
