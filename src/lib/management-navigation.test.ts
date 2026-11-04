import { describe, expect, it } from "vitest";
import {
  dashboardChartOrdersHref,
  dashboardRevenueOrdersHref,
  mobileOrderDetailsHref,
  mobileProductDetailsHref,
  orderDetailsHref,
  productOrdersHref,
  productManagementListHref,
  productDetailsHref,
  productDetailsHrefForRoute,
  purchaseOrderDetailsHref,
} from "./management-navigation";

describe("management detail navigation", () => {
  it("filters completed orders using the clicked chart date range", () => {
    expect(
      dashboardChartOrdersHref("2026-10-20", "2026-10-20", false),
    ).toBe(
      "/management/orders?status=completed&from=2026-10-20&to=2026-10-20",
    );
    expect(
      dashboardChartOrdersHref("2026-10-01", "2026-10-20", true),
    ).toBe(
      "/mobile/management/orders?status=completed&from=2026-10-01&to=2026-10-20",
    );
  });

  it("includes the selected chart hour and minute range", () => {
    expect(
      dashboardChartOrdersHref(
        "2026-10-20",
        "2026-10-20",
        false,
        "09:00",
        "09:59",
      ),
    ).toBe(
      "/management/orders?status=completed&from=2026-10-20&to=2026-10-20&fromTime=09%3A00&toTime=09%3A59",
    );
  });

  it("filters the product list and requests its detail row", () => {
    expect(productDetailsHref("SKU 10", "product-id")).toBe(
      "/management/products?q=SKU+10&id=product-id",
    );
  });

  it("keeps product detail links on the matching desktop or mobile route", () => {
    expect(productDetailsHrefForRoute(false, "SKU 10", "product-id")).toBe(
      "/management/products?q=SKU+10&id=product-id",
    );
    expect(productDetailsHrefForRoute(true, "SKU 10", "product-id")).toBe(
      "/mobile/management/products?id=product-id",
    );
  });

  it("targets the source order, status, and local document date", () => {
    expect(orderDetailsHref("order-id", "HD/10", "2026-10-12")).toBe(
      "/management/orders?id=order-id&status=all&invoice=HD%2F10&from=2026-10-12&to=2026-10-12",
    );
  });

  it("filters completed orders for a product and the selected local date range", () => {
    expect(
      productOrdersHref(
        "product-id",
        "Trà sữa trân châu",
        "2026-10-01",
        "2026-10-28",
        false,
      ),
    ).toBe(
      "/management/orders?productId=product-id&productName=Tr%C3%A0+s%E1%BB%AFa+tr%C3%A2n+ch%C3%A2u&status=completed&from=2026-10-01&to=2026-10-28",
    );
  });

  it("keeps product order filters on the mobile orders route", () => {
    expect(
      productOrdersHref("product-id", "Tea", "2026-10-01", "2026-10-28", true),
    ).toBe(
      "/mobile/management/orders?productId=product-id&productName=Tea&status=completed&from=2026-10-01&to=2026-10-28",
    );
  });

  it("opens completed orders with the selected metric and date range", () => {
    expect(
      dashboardRevenueOrdersHref(
        "subtotal",
        "2026-10-01",
        "2026-10-28",
        false,
      ),
    ).toBe(
      "/management/orders?status=completed&from=2026-10-01&to=2026-10-28&metricColumn=subtotal",
    );
  });

  it("sends mobile revenue navigation to orders without a focused metric", () => {
    expect(
      dashboardRevenueOrdersHref(
        "profit",
        "2026-10-01",
        "2026-10-28",
        true,
      ),
    ).toBe(
      "/mobile/management/orders?status=completed&from=2026-10-01&to=2026-10-28",
    );
  });

  it("opens a purchase order with all statuses included", () => {
    expect(purchaseOrderDetailsHref("purchase-id", "PN-10")).toBe(
      "/management/purchase?id=purchase-id&status=all&q=PN-10",
    );
  });
});

describe("product management list navigation", () => {
  it("keeps filters on the mobile route while preserving query and hash", () => {
    expect(
      productManagementListHref(
        true,
        new URLSearchParams("sort=name&dir=asc&q=tea"),
        "#table",
      ),
    ).toBe("/mobile/management/products?sort=name&dir=asc&q=tea#table");
  });

  it("keeps desktop filters on the desktop route", () => {
    expect(
      productManagementListHref(false, new URLSearchParams("q=tea")),
    ).toBe("/management/products?q=tea");
  });
});

describe("mobile management detail routes", () => {
  it("builds product and order collection URLs with encoded ids", () => {
    expect(mobileProductDetailsHref("product-1")).toBe(
      "/mobile/management/products?id=product-1",
    );
    expect(mobileOrderDetailsHref("order/1")).toBe(
      "/mobile/management/orders?id=order%2F1",
    );
  });
});
