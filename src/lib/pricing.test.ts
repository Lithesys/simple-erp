import { describe, expect, it } from "vitest";
import { calculateTotals } from "./pricing";

describe("calculateTotals", () => {
  it("rounds each fractional-quantity line to whole VND before summing", () => {
    expect(
      calculateTotals(
        [
          { price: 1001, quantity: 0.25 },
          { price: 1001, quantity: 0.25 },
        ],
        0,
      ),
    ).toEqual({ subtotal: 500, discount: 0, total: 500 });
  });

  it("subtracts a valid VND discount from the rounded subtotal", () => {
    expect(calculateTotals([{ price: 20000, quantity: 1.5 }], 5000)).toEqual({
      subtotal: 30000,
      discount: 5000,
      total: 25000,
    });
  });

  it.each([-1, 1001, Number.NaN])("rejects invalid discount %s", (discount) => {
    expect(() =>
      calculateTotals([{ price: 1000, quantity: 1 }], discount),
    ).toThrow();
  });

  it("supports a fully discounted order", () => {
    expect(calculateTotals([{ price: 500, quantity: 2 }], 1000)).toEqual({
      subtotal: 1000,
      discount: 1000,
      total: 0,
    });
  });
});
