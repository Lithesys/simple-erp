export type ProductSalesDay = {
  date: string;
  quantity: number;
  revenue: number;
  gross_profit: number | null;
  missing_cost_line_count: number;
};

export type ProductSalesSummary = {
  quantity: number;
  revenue: number;
  gross_profit: number | null;
  missing_cost_line_count: number;
  days: ProductSalesDay[];
};

export type ProductSalesTrendPoint = ProductSalesDay & {
  hasSales: boolean;
};

function addCalendarDay(date: string) {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

export function buildProductSalesTrend(
  days: ProductSalesDay[],
  from: string,
  to: string,
): ProductSalesTrendPoint[] {
  if (!from || !to || from > to) return [];

  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const trend: ProductSalesTrendPoint[] = [];

  for (let date = from; date <= to; date = addCalendarDay(date)) {
    const day = dayByDate.get(date);
    const quantity = Number(day?.quantity ?? 0);
    trend.push({
      date,
      quantity,
      revenue: Number(day?.revenue ?? 0),
      gross_profit: day
        ? day.gross_profit === null
          ? null
          : Number(day.gross_profit)
        : 0,
      missing_cost_line_count: day?.missing_cost_line_count ?? 0,
      hasSales: quantity !== 0,
    });
  }

  return trend;
}

export function formatProductSalesDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}
