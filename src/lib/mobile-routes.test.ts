import { describe, expect, it } from "vitest";
import { APP_NAVIGATION } from "../components/app-frame/navigation-config";
import {
  getMobileHref,
  getResponsiveHref,
  getResponsiveRoute,
  toDesktopRoute,
  toMobileRoute,
} from "./mobile-routes";

describe("responsive route mapping", () => {
  it("maps every primary navigation destination to a mobile route", () => {
    const navigationHrefs = APP_NAVIGATION.flatMap(({ children }) =>
      children.map(({ href }) => href),
    );

    for (const href of navigationHrefs) {
      expect(toMobileRoute(href), href).not.toBeNull();
    }
  });

  it("maps protected management routes to their mobile counterparts", () => {
    expect(toMobileRoute("/activity-history")).toBe("/mobile/activity-history");
    expect(toMobileRoute("/system/settings")).toBe(
      "/mobile/system/settings",
    );
    expect(toDesktopRoute("/mobile/system/settings")).toBe("/system/settings");
    expect(toMobileRoute("/analysis/products")).toBe(
      "/mobile/analysis/products",
    );
    expect(toDesktopRoute("/mobile/analysis/products")).toBe(
      "/analysis/products",
    );
    expect(getMobileHref("/not-yet-mapped")).toBe("/not-yet-mapped");
    expect(toDesktopRoute("/mobile/activity-history")).toBe(
      "/activity-history",
    );
    expect(toMobileRoute("/management/products")).toBe(
      "/mobile/management/products",
    );
    expect(toMobileRoute("/management/purchase")).toBe("/mobile/purchases");
    expect(toMobileRoute("/stock-check")).toBe("/mobile/stock-check");
    expect(toDesktopRoute("/mobile/stock-check")).toBe("/stock-check");
    expect(toDesktopRoute("/mobile/purchases")).toBe("/management/purchase");
    expect(toMobileRoute("/mobile/management/purchase")).toBe(
      "/mobile/purchases",
    );
    expect(toDesktopRoute("/mobile/management/purchase")).toBe(
      "/management/purchase",
    );
  });

  it("preserves nested path segments in both directions", () => {
    expect(toMobileRoute("/management/products/example")).toBe(
      "/mobile/management/products?id=example",
    );
    expect(toMobileRoute("/management/orders/example")).toBe(
      "/mobile/management/orders?id=example",
    );
    expect(toDesktopRoute("/mobile/management/products/example")).toBe(
      "/management/products?id=example",
    );
    expect(toDesktopRoute("/mobile/debt/example")).toBe("/debt?id=example");
  });

  it("selects a route for the current viewport and leaves unknown routes alone", () => {
    expect(getResponsiveRoute("/management/orders", true)).toBe(
      "/mobile/management/orders",
    );
    expect(getResponsiveRoute("/mobile/management/orders", false)).toBe(
      "/management/orders",
    );
    expect(toMobileRoute("/settings")).toBeNull();
  });

  it("preserves mobile detail ids on their desktop detail routes", () => {
    expect(toDesktopRoute("/mobile/product/product-1")).toBe(
      "/management/products?id=product-1",
    );
    expect(toDesktopRoute("/mobile/order/order-1")).toBe(
      "/management/orders?id=order-1",
    );
    expect(getResponsiveHref("/mobile/product/product-1", "", "", false)).toBe(
      "/management/products?id=product-1",
    );
    expect(getResponsiveHref("/mobile/order/order-1", "", "", false)).toBe(
      "/management/orders?id=order-1",
    );
    expect(getResponsiveHref("/mobile/debt/debt-1", "", "", false)).toBe(
      "/debt?id=debt-1",
    );
  });

  it("restores safe collection filters from the mobile detail return target", () => {
    expect(
      getResponsiveHref(
        "/mobile/product/product-1",
        "?returnTo=%2Fmobile%2Fmanagement%2Fproducts%3Fq%3Dtea%26stock%3Din-stock",
        "",
        false,
      ),
    ).toBe("/management/products?id=product-1&q=tea&stock=in-stock");
    expect(
      getResponsiveHref(
        "/mobile/order/order-1",
        "?returnTo=%2Fmobile%2Fmanagement%2Forders%3Fstatus%3Dcompleted",
        "",
        false,
      ),
    ).toBe("/management/orders?id=order-1&status=completed");
  });

  it("keeps detail routes mobile on narrow screens and rejects unsafe return targets", () => {
    expect(
      getResponsiveHref(
        "/mobile/product/product-1",
        "?returnTo=%2Fmobile%2Fmanagement%2Fproducts",
        "#inventory",
        true,
      ),
    ).toBe("/mobile/management/products?id=product-1#inventory");
    expect(
      getResponsiveHref("/settings", "?tab=profile", "#security", true),
    ).toBe("/settings?tab=profile#security");
    expect(
      getResponsiveHref(
        "/mobile/product/product-1",
        "?returnTo=%2Fmobile%2F..%2F..%2Fexternal",
        "",
        false,
      ),
    ).toBe("/management/products?id=product-1");
    expect(
      getResponsiveHref(
        "/mobile/order/order-1",
        "?returnTo=%2Fmobile%2Funrecognized",
        "",
        false,
      ),
    ).toBe("/management/orders?id=order-1");
  });
});
