import { addCalendarDays, REPORTING_TIME_ZONE } from "./dashboard-metrics";

export type ProductAnalysisLine = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  current_product_name?: string | null;
  quantity: number;
  line_total: number;
  stock: number | null;
  unit_cost: number | null;
  created_at: string;
  order_discount: number;
};

export type ProductAnalysisProduct = {
  key: string;
  product_name: string;
  quantity: number;
  revenue: number;
  gross_profit: number | null;
  stock: number | null;
};

export type ProductComboSuggestion = {
  key: string;
  first_product: string;
  second_product: string;
  co_order_count: number;
};

export type ProductAnalysisTrendPoint = {
  label: string;
  quantity: number;
  revenue: number;
  gross_profit: number | null;
  product_count: number;
};

export type ProductAnalysisMetricDay = {
  date: string;
  version: number;
  quantity: number;
  revenue: number;
  gross_profit: number | null;
  missing_cost_line_count: number;
  product_count: number;
  value: number | null;
};

export type ProductAnalysisMetricTotal = {
  quantity: number;
  revenue: number;
  gross_profit: number | null;
  missing_cost_line_count: number;
  product_count: number;
  numerator: number | null;
  denominator: number;
  value: number | null;
};

export function productIdFromAnalysisKey(key: string) {
  const prefix = "product:";
  if (!key.startsWith(prefix)) return null;
  const productId = key.slice(prefix.length);
  return productId || null;
}

export function grossProfitPerUnitChartValue(
  day: ProductAnalysisMetricDay | undefined,
) {
  if (!day || day.missing_cost_line_count > 0) return null;
  if (day.quantity === 0) return 0;
  return day.value;
}

/** Use summed profit and quantity so higher-volume days carry their true weight. */
export function calculateGrossProfitPerUnit(
  grossProfit: number | null,
  quantity: number,
) {
  if (grossProfit === null || !Number.isFinite(grossProfit) || quantity === 0)
    return null;
  return grossProfit / quantity;
}

export function sumProductAnalysisMetricDays(days: ProductAnalysisMetricDay[]) {
  const quantity = days.reduce((sum, day) => sum + day.quantity, 0);
  const revenue = days.reduce((sum, day) => sum + day.revenue, 0);
  const missingCostLineCount = days.reduce(
    (sum, day) => sum + day.missing_cost_line_count,
    0,
  );
  const grossProfit =
    missingCostLineCount === 0
      ? days.reduce((sum, day) => sum + (day.gross_profit ?? 0), 0)
      : null;
  return {
    quantity,
    revenue,
    grossProfit,
    missingCostLineCount,
    grossProfitPerUnit: calculateGrossProfitPerUnit(grossProfit, quantity),
  };
}

/** Allocate an order-level discount to lines using stable largest remainders. */
export function allocateOrderDiscount(
  lineTotals: number[],
  discountValue: number,
) {
  if (lineTotals.length === 0) return [];
  const totals = lineTotals.map((value) => Math.max(0, Number(value) || 0));
  const discount = Math.min(
    totals.reduce((sum, value) => sum + value, 0),
    Math.max(0, Math.round(Number(discountValue) || 0)),
  );
  if (discount === 0) return totals.map(() => 0);

  const total = totals.reduce((sum, value) => sum + value, 0);
  const weights =
    total > 0
      ? totals.map((value) => value / total)
      : totals.map(() => 1 / totals.length);
  const exactShares = weights.map((weight) => weight * discount);
  const shares = exactShares.map(Math.floor);
  let remaining = discount - shares.reduce((sum, value) => sum + value, 0);
  const remainderOrder = exactShares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort(
      (left, right) =>
        right.remainder - left.remainder || left.index - right.index,
    );
  for (const { index } of remainderOrder) {
    if (remaining <= 0) break;
    shares[index] += 1;
    remaining -= 1;
  }
  return shares;
}

function productKey(productId: string | null, productName: string) {
  return productId
    ? `product:${productId}`
    : `name:${productName.trim().toLocaleLowerCase("vi")}`;
}

function linesWithAllocatedRevenue(lines: ProductAnalysisLine[]) {
  const orderGroups = new Map<string, ProductAnalysisLine[]>();
  for (const line of lines) {
    const group = orderGroups.get(line.order_id) ?? [];
    group.push(line);
    orderGroups.set(line.order_id, group);
  }

  const netRevenueByLine = new Map<string, number>();
  for (const orderLines of orderGroups.values()) {
    const subtotal = orderLines.reduce(
      (sum, line) => sum + Math.max(0, Number(line.line_total) || 0),
      0,
    );
    const discount = Math.min(
      subtotal,
      Math.max(0, Math.round(Number(orderLines[0]?.order_discount) || 0)),
    );
    const weights = orderLines.map((line) =>
      Math.max(0, Number(line.line_total) || 0),
    );
    const allocations = allocateOrderDiscount(weights, discount);
    for (let index = 0; index < orderLines.length; index += 1) {
      const line = orderLines[index];
      netRevenueByLine.set(
        line.id,
        Math.max(0, Number(line.line_total) || 0) - (allocations[index] ?? 0),
      );
    }
  }
  return netRevenueByLine;
}

export function aggregateProductAnalysis(
  lines: ProductAnalysisLine[],
): ProductAnalysisProduct[] {
  const revenueByLine = linesWithAllocatedRevenue(lines);
  const products = new Map<string, ProductAnalysisProduct>();

  for (const line of lines) {
    const key = productKey(line.product_id, line.product_name);
    const currentName = line.current_product_name?.trim();
    const revenue =
      revenueByLine.get(line.id) ?? (Number(line.line_total) || 0);
    const quantity = Number(line.quantity) || 0;
    const unitCost = line.unit_cost;
    const lineProfit =
      unitCost === null || !Number.isFinite(Number(unitCost))
        ? null
        : revenue - Math.round(Number(unitCost) * quantity);
    const product = products.get(key);

    if (product) {
      product.quantity += quantity;
      product.revenue += revenue;
      product.gross_profit =
        product.gross_profit === null || lineProfit === null
          ? null
          : product.gross_profit + lineProfit;
      if (product.stock === null && line.stock !== null)
        product.stock = Number(line.stock);
      if (currentName) product.product_name = currentName;
      continue;
    }

    products.set(key, {
      key,
      product_name: currentName || line.product_name,
      quantity,
      revenue,
      gross_profit: lineProfit,
      stock: line.stock === null ? null : Number(line.stock),
    });
  }

  return [...products.values()];
}

export function buildProductComboSuggestions(
  lines: ProductAnalysisLine[],
): ProductComboSuggestion[] {
  const orderProducts = new Map<string, Map<string, string>>();
  for (const line of lines) {
    const products =
      orderProducts.get(line.order_id) ?? new Map<string, string>();
    const key = productKey(line.product_id, line.product_name);
    products.set(key, line.current_product_name?.trim() || line.product_name);
    orderProducts.set(line.order_id, products);
  }

  const pairs = new Map<string, ProductComboSuggestion>();
  for (const products of orderProducts.values()) {
    const entries = [...products.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < entries.length;
        rightIndex += 1
      ) {
        const [leftKey, leftName] = entries[leftIndex];
        const [rightKey, rightName] = entries[rightIndex];
        const key = `${leftKey}|${rightKey}`;
        const existing = pairs.get(key);
        if (existing) existing.co_order_count += 1;
        else
          pairs.set(key, {
            key,
            first_product: leftName,
            second_product: rightName,
            co_order_count: 1,
          });
      }
    }
  }

  return [...pairs.values()].sort(
    (left, right) =>
      right.co_order_count - left.co_order_count ||
      left.key.localeCompare(right.key),
  );
}

export function buildProductAnalysisTrend(
  lines: ProductAnalysisLine[],
  range: { from: string; to: string },
): ProductAnalysisTrendPoint[] {
  const isSingleDay = Boolean(range.from && range.from === range.to);
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hourFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORTING_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const revenueByLine = linesWithAllocatedRevenue(lines);
  const points = new Map<
    string,
    ProductAnalysisTrendPoint & { keys: Set<string> }
  >();

  for (const line of lines) {
    const createdAt = new Date(line.created_at);
    if (Number.isNaN(createdAt.getTime())) continue;
    const date = dateFormatter.format(createdAt);
    if (isSingleDay && date !== range.from) continue;
    const label = isSingleDay ? `${hourFormatter.format(createdAt)}:00` : date;
    const key = isSingleDay ? label.slice(0, 2) : date;
    const point = points.get(key) ?? {
      label: isSingleDay ? label : `${date.slice(8, 10)}/${date.slice(5, 7)}`,
      quantity: 0,
      revenue: 0,
      gross_profit: 0,
      product_count: 0,
      keys: new Set<string>(),
    };
    const netRevenue =
      revenueByLine.get(line.id) ?? (Number(line.line_total) || 0);
    point.quantity += Number(line.quantity) || 0;
    point.revenue += netRevenue;
    point.keys.add(productKey(line.product_id, line.product_name));
    if (line.unit_cost === null || !Number.isFinite(Number(line.unit_cost))) {
      point.gross_profit = null;
    } else if (point.gross_profit !== null) {
      point.gross_profit +=
        netRevenue - Math.round(Number(line.unit_cost) * Number(line.quantity));
    }
    points.set(key, point);
  }

  if (isSingleDay) {
    return Array.from({ length: 24 }, (_, hour) => {
      const point = points.get(String(hour).padStart(2, "0"));
      return point
        ? { ...point, product_count: point.keys.size }
        : {
            label: `${String(hour).padStart(2, "0")}:00`,
            quantity: 0,
            revenue: 0,
            gross_profit: 0,
            product_count: 0,
          };
    });
  }

  const dateKeys = new Set(points.keys());
  if (range.from && range.to) {
    let cursor = range.from;
    let count = 0;
    while (cursor <= range.to && count < 366) {
      dateKeys.add(cursor);
      cursor = addCalendarDays(cursor, 1);
      count += 1;
    }
  }
  return [...dateKeys].sort().map((key) => {
    const point = points.get(key);
    return point
      ? { ...point, product_count: point.keys.size }
      : {
          label: `${key.slice(8, 10)}/${key.slice(5, 7)}`,
          quantity: 0,
          revenue: 0,
          gross_profit: 0,
          product_count: 0,
        };
  });
}
