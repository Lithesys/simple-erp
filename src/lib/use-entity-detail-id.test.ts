import { describe, expect, it } from "vitest";
import { buildEntityDetailUrl } from "./use-entity-detail-id";

describe("entity detail query URLs", () => {
  it("sets a shared id while preserving list filters and hash", () => {
    expect(
      buildEntityDetailUrl(
        "https://erp.invalid/management/orders?status=completed&page=2#table",
        "order/1",
      ),
    ).toBe("/management/orders?status=completed&page=2&id=order%2F1#table");
  });

  it("removes a modal id immediately without discarding other query state", () => {
    expect(
      buildEntityDetailUrl(
        "https://erp.invalid/management/products?q=tea&id=product-1#inventory",
        null,
      ),
    ).toBe("/management/products?q=tea#inventory");
  });

  it("can replace legacy entity-specific detail keys with id", () => {
    expect(
      buildEntityDetailUrl(
        "https://erp.invalid/management/products?q=tea&openProduct=product-1",
        "product-1",
        ["openProduct"],
      ),
    ).toBe("/management/products?q=tea&id=product-1");
  });
});
