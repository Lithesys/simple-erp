import { describe, expect, it } from "vitest";
import {
  getBundleComponentQuantity,
  hasSellableBundleItems,
} from "./product-bundles";
import type { Product } from "./types";

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "combo-1",
  sku: "LDL-000001",
  name: "Combo",
  unit: "combo",
  stock: 0,
  kind: "combo",
  is_active: true,
  product_prices: [],
  ...overrides,
});

describe("product bundles", () => {
  it("keeps displayed component quantities within three decimals", () => {
    expect(getBundleComponentQuantity(1.234, 2)).toBe(2.468);
    expect(getBundleComponentQuantity(0.333, 3)).toBe(0.999);
  });

  it("requires every bundle component to remain active", () => {
    expect(hasSellableBundleItems(product())).toBe(false);
    expect(
      hasSellableBundleItems(
        product({
          bundle_items: [
            {
              product_id: "product-1",
              sku: "LDL-000002",
              name: "Hàng lẻ",
              unit: "cái",
              stock: 5,
              is_active: true,
              quantity_per_bundle: 0.5,
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
