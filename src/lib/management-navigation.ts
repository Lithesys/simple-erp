export function productDetailsHref(productSku: string, productId: string) {
  const params = new URLSearchParams({
    q: productSku,
    id: productId,
  });
  return `/management/products?${params.toString()}`;
}

export function productDetailsHrefForRoute(
  isMobileRoute: boolean,
  productSku: string,
  productId: string,
) {
  return isMobileRoute
    ? mobileProductDetailsHref(productId)
    : productDetailsHref(productSku, productId);
}

export function productManagementListHref(
  isMobileRoute: boolean,
  params: URLSearchParams,
  hash = "",
) {
  const pathname = isMobileRoute
    ? "/mobile/management/products"
    : "/management/products";
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

function mobileDetailsHref(kind: "product" | "order", id: string) {
  const listPath =
    kind === "product"
      ? "/mobile/management/products"
      : "/mobile/management/orders";
  return `${listPath}?${new URLSearchParams({ id }).toString()}`;
}

export function mobileProductDetailsHref(productId: string) {
  return mobileDetailsHref("product", productId);
}

export function mobileOrderDetailsHref(orderId: string) {
  return mobileDetailsHref("order", orderId);
}

export function orderDetailsHref(
  orderId: string,
  orderNo: string | null,
  sourceDate: string | null,
) {
  const params = new URLSearchParams({
    id: orderId,
    status: "all",
  });
  if (orderNo) params.set("invoice", orderNo);
  if (sourceDate) {
    params.set("from", sourceDate);
    params.set("to", sourceDate);
  }
  return `/management/orders?${params.toString()}`;
}

export function productOrdersHref(
  productId: string,
  productName: string,
  from: string,
  to: string,
  isMobileRoute: boolean,
) {
  const params = new URLSearchParams({
    productId,
    productName,
    status: "completed",
    from,
    to,
  });
  const pathname = isMobileRoute
    ? "/mobile/management/orders"
    : "/management/orders";
  return `${pathname}?${params.toString()}`;
}

export type OrderMetricColumn = "subtotal" | "discount" | "profit";

export function dashboardChartOrdersHref(
  from: string,
  to: string,
  isMobileRoute: boolean,
  fromTime?: string,
  toTime?: string,
) {
  const params = new URLSearchParams({ status: "completed", from, to });
  if (fromTime) params.set("fromTime", fromTime);
  if (toTime) params.set("toTime", toTime);
  const pathname = isMobileRoute
    ? "/mobile/management/orders"
    : "/management/orders";
  return `${pathname}?${params.toString()}`;
}

export function dashboardRevenueOrdersHref(
  metricColumn: OrderMetricColumn,
  from: string,
  to: string,
  isMobileRoute: boolean,
) {
  const params = new URLSearchParams({ status: "completed", from, to });
  if (!isMobileRoute) params.set("metricColumn", metricColumn);
  const pathname = isMobileRoute
    ? "/mobile/management/orders"
    : "/management/orders";
  return `${pathname}?${params.toString()}`;
}

export function purchaseOrderDetailsHref(
  purchaseOrderId: string,
  purchaseNo: string | null,
) {
  const params = new URLSearchParams({
    id: purchaseOrderId,
    status: "all",
  });
  if (purchaseNo) params.set("q", purchaseNo);
  return `/management/purchase?${params.toString()}`;
}
