import { describe, expect, it } from "vitest";
import { hasInvalidPurchaseQuantity } from "./purchase-validation";

describe("purchase quantity validation", () => {
  it("allows entering zero but marks it invalid for saving", () => {
    expect(hasInvalidPurchaseQuantity("0")).toBe(true);
  });

  it("accepts positive whole and fractional quantities", () => {
    expect(hasInvalidPurchaseQuantity("1")).toBe(false);
    expect(hasInvalidPurchaseQuantity("0.125")).toBe(false);
  });

  it("rejects empty and non-finite quantities", () => {
    expect(hasInvalidPurchaseQuantity("")).toBe(true);
    expect(hasInvalidPurchaseQuantity("not a number")).toBe(true);
  });
});
