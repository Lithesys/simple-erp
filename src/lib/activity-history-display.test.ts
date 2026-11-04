import { describe, expect, it } from "vitest";
import {
  getActivityPriceListName,
  formatActivityDateValue,
  formatInvoiceItemQuantityAdjustment,
  getActivityHistoryTargetHref,
  getInvoiceDetailPresentation,
  isProductPriceUpdate,
} from "./activity-history-display";

describe("formatActivityDateValue", () => {
  it("formats activity timestamps with the app's centralized date formatter", () => {
    expect(
      formatActivityDateValue(
        "2026-10-27T13:49:23.664819+00:00",
        "received_at",
      ),
    ).toBe("27/10/2026 20:49");
  });

  it("formats date-only activity values at midnight in the app timezone", () => {
    expect(formatActivityDateValue("2026-10-27", "debt_date")).toBe(
      "27/10/2026 00:00",
    );
  });

  it("leaves non-date fields and invalid date values unchanged", () => {
    expect(
      formatActivityDateValue("2026-10-27T13:49:23Z", "note"),
    ).toBeNull();
    expect(formatActivityDateValue("not-a-date", "received_at")).toBeNull();
  });
});

describe("getActivityPriceListName", () => {
  it("returns the saved price list for a selling price update", () => {
    expect(
      getActivityPriceListName({
        action: "Cập nhật",
        entity_type: "product_prices",
        entity_label: "LDL-001",
        changed_fields: {
          price: { before: 10000, after: 12000 },
          price_list_name: { before: null, after: "Giá sỉ" },
        },
      }),
    ).toBe("Giá sỉ");
  });

  it("does not treat cost or unrelated product changes as a price list update", () => {
    expect(
      getActivityPriceListName({
        action: "Cập nhật",
        entity_type: "product_costs",
        entity_label: "LDL-001",
        changed_fields: {
          cost: { before: 8000, after: 9000 },
          price_list_name: { before: null, after: "Giá sỉ" },
        },
      }),
    ).toBeNull();
    expect(
      getActivityPriceListName({
        action: "Cập nhật",
        entity_type: "product_prices",
        entity_label: "LDL-001",
        changed_fields: { name: { before: "A", after: "B" } },
      }),
    ).toBeNull();
  });
});

describe("isProductPriceUpdate", () => {
  it("identifies product price and cost updates", () => {
    expect(
      isProductPriceUpdate({
        action: "Cập nhật",
        entity_type: "product_prices",
        entity_label: "LDL-1",
        changed_fields: { price: { before: 10, after: 12 } },
      }),
    ).toBe(true);
    expect(
      isProductPriceUpdate({
        action: "Cập nhật",
        entity_type: "product_costs",
        entity_label: "LDL-1",
        changed_fields: { cost: { before: 8, after: 9 } },
      }),
    ).toBe(true);
  });

  it("ignores unrelated product edits and other actions", () => {
    expect(
      isProductPriceUpdate({
        action: "Cập nhật",
        entity_type: "products",
        entity_label: "LDL-1",
        changed_fields: { name: { before: "A", after: "B" } },
      }),
    ).toBe(false);
    expect(
      isProductPriceUpdate({
        action: "Tạo",
        entity_type: "product_prices",
        entity_label: "LDL-1",
        changed_fields: { price: { before: null, after: 12 } },
      }),
    ).toBe(false);
  });
});

describe("getInvoiceDetailPresentation", () => {
  it("keeps only the compact order summary and note fields", () => {
    expect(
      getInvoiceDetailPresentation({
        entity_type: "orders",
        entity_label: "LDL-001",
        changed_fields: {
          customer_name: { before: null, after: "Khách lẻ" },
          total: { before: null, after: 125000 },
          note: { before: null, after: "Giao buổi chiều" },
          customer_phone: { before: null, after: "0900000000" },
          discount: { before: null, after: 5000 },
        },
      }),
    ).toEqual({
      kind: "order",
      orderNumber: "LDL-001",
      customerName: { before: null, after: "Khách lẻ" },
      amountDue: { before: null, after: 125000 },
      note: { before: null, after: "Giao buổi chiều" },
    });
  });

  it("keeps each product line name, quantity change, and line total", () => {
    expect(
      getInvoiceDetailPresentation({
        entity_type: "order_items",
        entity_label: "LDL-002",
        changed_fields: {
          product_name: { before: null, after: "Coca lon" },
          quantity: { before: 2, after: 3 },
          line_total: { before: 20000, after: 30000 },
          unit_price: { before: 10000, after: 10000 },
        },
      }),
    ).toEqual({
      kind: "item",
      productName: "Coca lon",
      quantity: { before: 2, after: 3 },
      unitPrice: { before: 10000, after: 10000 },
      lineTotal: { before: 20000, after: 30000 },
    });
  });

  it("uses the saved entity label when an update omits an unchanged product name", () => {
    expect(
      getInvoiceDetailPresentation({
        entity_type: "order_items",
        entity_label: "Coca lon",
        changed_fields: { quantity: { before: 2, after: 1 } },
      }),
    ).toMatchObject({ kind: "item", productName: "Coca lon" });
  });

  it("prefers the saved product name snapshot over an old SKU label", () => {
    expect(
      getInvoiceDetailPresentation({
        entity_type: "order_items",
        entity_label: "LDL-000051",
        product_name: "Nước ngọt Coca",
        changed_fields: { quantity: { before: 50, after: 30 } },
      }),
    ).toMatchObject({ kind: "item", productName: "Nước ngọt Coca" });
  });

  it("formats a product quantity update with the requested wording", () => {
    expect(
      formatInvoiceItemQuantityAdjustment("Coca lon", {
        before: 1200,
        after: 950,
      }),
    ).toBe("Điều chỉnh Coca lon từ 1.200 qua 950");
  });

  it("opens a product for standalone product activity", () => {
    expect(
      getActivityHistoryTargetHref([
        {
          entity_type: "product_prices",
          entity_id: "price-row-id",
          entity_label: "LDL-1",
          related_entity_id: "product-id",
        },
      ]),
    ).toBe("/mobile/management/products?id=product-id");
  });

  it("opens the order for grouped order-line activity", () => {
    expect(
      getActivityHistoryTargetHref([
        {
          entity_type: "order_items",
          entity_id: "line-id",
          entity_label: "Nước ngọt Coca",
          related_entity_id: "order-id",
        },
      ]),
    ).toBe("/mobile/management/orders?id=order-id");
  });

  it("opens the related purchase and debt records", () => {
    expect(
      getActivityHistoryTargetHref([
        {
          entity_type: "purchase_order_items",
          entity_id: "line-id",
          entity_label: "Nước ngọt Coca",
          related_entity_id: "purchase-id",
        },
      ]),
    ).toBe("/mobile/purchases?id=purchase-id");
    expect(
      getActivityHistoryTargetHref([
        {
          entity_type: "debts",
          entity_id: "debt-id",
          entity_label: "Nợ hàng",
        },
      ]),
    ).toBe("/mobile/debt?id=debt-id");
  });
});
