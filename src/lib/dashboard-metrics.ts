export const REPORTING_TIME_ZONE = "Asia/Bangkok";

export function getReportingDate(date: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addCalendarDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Ngày không hợp lệ.");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function getReportingRangeBounds(from: string, to: string) {
  return {
    start: from ? `${from}T00:00:00+07:00` : undefined,
    endExclusive: to ? `${addCalendarDays(to, 1)}T00:00:00+07:00` : undefined,
  };
}

export type DashboardOrder = {
  total: number;
  subtotal?: number;
  discount?: number;
  order_profit_snapshots?: { profit: number } | null;
};

export type DashboardChartOrder = Pick<DashboardOrder, "total"> & {
  created_at: string;
};

export type DashboardChartPoint = {
  label: string;
  revenue: number;
  from: string;
  to: string;
  fromTime?: string;
  toTime?: string;
};

export function buildDashboardRevenueChart(
  orders: DashboardChartOrder[],
  range: { from: string; to: string },
): DashboardChartPoint[] {
  const revenueByHour = new Map<number, number>();
  const revenueByDate = new Map<string, number>();
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

  for (const order of orders) {
    const createdAt = new Date(order.created_at);
    const dateKey = dateFormatter.format(createdAt);
    const revenue = Number(order.total || 0);
    revenueByDate.set(dateKey, (revenueByDate.get(dateKey) || 0) + revenue);
    if (range.from && range.from === range.to && dateKey === range.from) {
      const hour = Number(hourFormatter.format(createdAt));
      revenueByHour.set(hour, (revenueByHour.get(hour) || 0) + revenue);
    }
  }

  if (range.from && range.from === range.to) {
    return [...revenueByHour]
      .sort(([leftHour], [rightHour]) => leftHour - rightHour)
      .map(([hour, revenue]) => ({
        label: `${String(hour).padStart(2, "0")}:00`,
        revenue,
        from: range.from,
        to: range.to,
        fromTime: `${String(hour).padStart(2, "0")}:00`,
        toTime: `${String(hour).padStart(2, "0")}:59`,
      }));
  }

  const dateKeys = new Set(revenueByDate.keys());
  if (range.from && range.to) {
    let cursor = range.from;
    let daysAdded = 0;
    while (cursor <= range.to && daysAdded < 366) {
      dateKeys.add(cursor);
      cursor = addCalendarDays(cursor, 1);
      daysAdded += 1;
    }
  }

  return [...dateKeys].sort().map((date) => {
    const [year, month, day] = date.split("-");
    return {
      label: `${day}/${month}/${year}`,
      revenue: revenueByDate.get(date) || 0,
      from: date,
      to: date,
    };
  });
}

export function summarizeDashboardOrders(orders: DashboardOrder[]) {
  return orders.reduce(
    (summary, order) => ({
      revenue: summary.revenue + Number(order.total || 0),
      subtotal: summary.subtotal + Number(order.subtotal || 0),
      discount: summary.discount + Number(order.discount || 0),
      orderCount: summary.orderCount + 1,
      profit:
        summary.profit + Number(order.order_profit_snapshots?.profit || 0),
    }),
    { revenue: 0, subtotal: 0, discount: 0, orderCount: 0, profit: 0 },
  );
}
