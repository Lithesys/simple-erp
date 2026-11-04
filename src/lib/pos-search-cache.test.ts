import { describe, expect, it } from "vitest";
import {
  matchesCachedCustomerText,
  searchProductsLocally,
} from "./pos-search-cache";
import { normalizeSearchText } from "./search";

describe("cached POS customer search", () => {
  it("matches Vietnamese customer names without diacritics", () => {
    const customerText = normalizeSearchText("Nguyễn Thị Đặng 0901234567");

    expect(matchesCachedCustomerText(customerText, "dang nguyen thi")).toBe(
      true,
    );
    expect(matchesCachedCustomerText(customerText, "thi 090123")).toBe(true);
    expect(matchesCachedCustomerText(customerText, "trần")).toBe(false);
  });
});

describe("searchProductsLocally", () => {
  const products = [
    { id: "1", sku: "LDL-1", name: "Số vuông" },
    { id: "2", sku: "LDL-2", name: "Số tròn" },
    { id: "3", sku: "LDL-3", name: "Bình nước" },
  ];

  it("matches product names and SKUs immediately with Vietnamese accents ignored", () => {
    expect(searchProductsLocally(products, "so vuong")).toEqual([products[0]]);
    expect(searchProductsLocally(products, "ldl-2")).toEqual([products[1]]);
  });

  it("does not show suggestions for an empty query and respects the result limit", () => {
    expect(searchProductsLocally(products, "   ")).toEqual([]);
    expect(searchProductsLocally(products, "so", 1)).toEqual([products[0]]);
  });
});
