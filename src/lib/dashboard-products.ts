export type DashboardProductMetric = "quantity" | "revenue";

export type DashboardProductSalesRow = {
  key: string;
  product_name: string;
  quantity: number;
  revenue: number;
  stock: number | null;
};

export type DashboardProductSalesLine = {
  product_id: string | null;
  product_name: string;
  current_product_name?: string | null;
  quantity: number;
  revenue: number;
  stock: number | null;
};

export function aggregateDashboardProducts(
  lines: DashboardProductSalesLine[],
): DashboardProductSalesRow[] {
  const products = new Map<string, DashboardProductSalesRow>();

  for (const line of lines) {
    const key = line.product_id
      ? `product:${line.product_id}`
      : `name:${line.product_name}`;
    const currentProductName = line.current_product_name?.trim();
    const name = currentProductName || line.product_name;
    const existing = products.get(key);

    if (existing) {
      existing.quantity += Number(line.quantity) || 0;
      existing.revenue += Number(line.revenue) || 0;
      if (existing.stock === null && line.stock !== null) {
        existing.stock = Number(line.stock);
      }
      if (currentProductName) existing.product_name = currentProductName;
      continue;
    }

    products.set(key, {
      key,
      product_name: name,
      quantity: Number(line.quantity) || 0,
      revenue: Number(line.revenue) || 0,
      stock: line.stock === null ? null : Number(line.stock),
    });
  }

  return [...products.values()];
}

export function sortDashboardProducts(
  products: DashboardProductSalesRow[],
  metric: DashboardProductMetric,
): DashboardProductSalesRow[] {
  return [...products].sort(
    (left, right) =>
      right[metric] - left[metric] ||
      left.product_name.localeCompare(right.product_name, "vi") ||
      left.key.localeCompare(right.key),
  );
}
