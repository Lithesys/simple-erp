import { describe, expect, it } from "vitest";
import { productCost } from "./products";

describe("productCost", () => {
  it("reads the one-to-one cost returned by the product query for display and editing", () => {
    expect(productCost({ product_costs: { cost: 252000 } })).toBe(252000);
  });

  it("preserves a zero cost", () => {
    expect(productCost({ product_costs: { cost: 0 } })).toBe(0);
  });

  it("defaults to zero when the cost is missing or omitted by permissions", () => {
    expect(productCost({ product_costs: null })).toBe(0);
    expect(productCost({})).toBe(0);
  });
});
