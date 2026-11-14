const routePairs = [
  ["/account", "/mobile/account"],
  ["/activity-history", "/mobile/activity-history"],
  ["/system/print-templates", "/mobile/system/print-templates"],
  ["/system/settings", "/mobile/system/settings"],
  ["/dashboard", "/mobile/dashboard"],
  ["/debt", "/mobile/debt"],
  ["/analysis/products", "/mobile/analysis/products"],
  ["/analysis/sales", "/mobile/analysis/sales"],
  ["/management/accounts", "/mobile/management/accounts"],
  ["/management/customers", "/mobile/management/customers"],
  ["/management/orders", "/mobile/management/orders"],
  ["/management/price-lists", "/mobile/management/price-lists"],
  ["/management/products", "/mobile/management/products"],
  ["/management/purchase", "/mobile/purchases"],
  ["/stock-check", "/mobile/stock-check"],
  ["/management/roles", "/mobile/management/roles"],
  ["/pos", "/mobile/pos"],
] as const;

const legacyDetailPairs = [
  [
    "/management/products",
    "/management/products",
    "/mobile/management/products",
  ],
  ["/management/orders", "/management/orders", "/mobile/management/orders"],
  ["/debt", "/debt", "/mobile/debt"],
  [
    "/mobile/management/products",
    "/management/products",
    "/mobile/management/products",
  ],
  [
    "/mobile/management/orders",
    "/management/orders",
    "/mobile/management/orders",
  ],
  ["/mobile/product", "/management/products", "/mobile/management/products"],
  ["/mobile/order", "/management/orders", "/mobile/management/orders"],
  ["/mobile/debt", "/debt", "/mobile/debt"],
] as const;

const legacyPurchaseRoutes = [
  ["/mobile/management/purchase", "/management/purchase", "/mobile/purchases"],
] as const;

function mapRoute(pathname: string, from: string, to: string) {
  if (pathname === from) return to;
  if (pathname.startsWith(`${from}/`))
    return `${to}${pathname.slice(from.length)}`;
  return null;
}

function getLegacyDetail(pathname: string, useMobilePath: boolean) {
  for (const [legacyPath, desktopPath, mobilePath] of legacyDetailPairs) {
    if (!pathname.startsWith(`${legacyPath}/`)) continue;
    const id = pathname.slice(legacyPath.length + 1);
    if (!id || id.includes("/")) continue;
    return {
      path: useMobilePath ? mobilePath : desktopPath,
      id: safeDecodeURIComponent(id),
    };
  }
  return null;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function mapLegacyPurchase(pathname: string, useMobilePath: boolean) {
  for (const [legacyPath, desktopPath, mobilePath] of legacyPurchaseRoutes) {
    const mapped = mapRoute(
      pathname,
      legacyPath,
      useMobilePath ? mobilePath : desktopPath,
    );
    if (mapped) return mapped;
  }
  return null;
}

export function toMobileRoute(pathname: string) {
  const legacyDetail = getLegacyDetail(pathname, true);
  if (legacyDetail)
    return `${legacyDetail.path}?${new URLSearchParams({ id: legacyDetail.id })}`;
  const legacyPurchase = mapLegacyPurchase(pathname, true);
  if (legacyPurchase) return legacyPurchase;
  for (const [desktopRoute, mobileRoute] of routePairs) {
    const mapped = mapRoute(pathname, desktopRoute, mobileRoute);
    if (mapped) return mapped;
  }
  return pathname.startsWith("/mobile/") ? pathname : null;
}

export function getMobileHref(pathname: string) {
  return toMobileRoute(pathname) ?? pathname;
}

export function toDesktopRoute(pathname: string) {
  const legacyDetail = getLegacyDetail(pathname, false);
  if (legacyDetail)
    return `${legacyDetail.path}?${new URLSearchParams({ id: legacyDetail.id })}`;
  const legacyPurchase = mapLegacyPurchase(pathname, false);
  if (legacyPurchase) return legacyPurchase;
  for (const [desktopRoute, mobileRoute] of routePairs) {
    const mapped = mapRoute(pathname, mobileRoute, desktopRoute);
    if (mapped) return mapped;
  }
  return pathname;
}

export function getResponsiveRoute(pathname: string, isMobile: boolean) {
  return isMobile ? toMobileRoute(pathname) : toDesktopRoute(pathname);
}

function mergeRouteSearch(route: string, search: string, pathname: string) {
  const routeUrl = new URL(route, "https://routes.invalid");
  const params = new URLSearchParams(routeUrl.search);
  const incoming = new URLSearchParams(search);
  const legacyDetail =
    getLegacyDetail(pathname, false) || getLegacyDetail(pathname, true);
  const returnTo = incoming.get("returnTo");

  if (
    legacyDetail &&
    returnTo?.startsWith("/mobile/") &&
    !returnTo.startsWith("//")
  ) {
    try {
      const parsedReturnTo = new URL(returnTo, "https://mobile.invalid");
      if (parsedReturnTo.origin === "https://mobile.invalid") {
        for (const [key, value] of parsedReturnTo.searchParams) {
          if (key !== "id" && key !== "returnTo" && !params.has(key))
            params.append(key, value);
        }
      }
    } catch {
      // Ignore malformed legacy return targets.
    }
  }

  for (const [key, value] of incoming) {
    if (key === "returnTo") continue;
    if (key === "id" && legacyDetail) continue;
    if (!params.has(key)) params.append(key, value);
  }

  const query = params.toString();
  return `${routeUrl.pathname}${query ? `?${query}` : ""}`;
}

export function getResponsiveHref(
  pathname: string,
  search: string,
  hash: string,
  isMobile: boolean,
) {
  const route = getResponsiveRoute(pathname, isMobile);
  if (!route) return `${pathname}${search}${hash}`;
  const next = mergeRouteSearch(route, search, pathname);
  return `${next}${hash}`;
}
