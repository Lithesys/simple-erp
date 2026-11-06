import type { SupabaseClient } from "@supabase/supabase-js";

export type SalesAnalysisMetric = "time" | "profit" | "discount" | "employee";
export type SalesAnalysisRange = { from: string; to: string };
export type SalesAnalysisPoint = {
  label: string;
  business_date: string | null;
  amount: number;
  revenue?: number;
  cost?: number;
};
export type SalesAnalysisPriceList = { id: string; name: string };

export async function fetchSalesAnalysisPriceLists(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("get_sales_analysis_price_lists");
  if (error) throw error;
  return (data ?? []) as unknown as SalesAnalysisPriceList[];
}

export async function fetchSalesAnalysisChart(
  supabase: SupabaseClient,
  range: SalesAnalysisRange,
  metric: SalesAnalysisMetric,
  priceListId: string,
): Promise<SalesAnalysisPoint[]> {
  async function fetchMetric(metricName: SalesAnalysisMetric) {
    const { data, error } = await supabase.rpc("get_sales_analysis_chart", {
      p_from: range.from,
      p_to: range.to,
      p_metric: metricName,
      p_price_list_id: priceListId || null,
    });
    if (error) throw error;
    return (data ?? []) as unknown as {
      label: string;
      business_date: string | null;
      amount: number | string;
    }[];
  }

  if (metric === "profit") {
    const [profitRows, revenueRows] = await Promise.all([
      fetchMetric("profit"),
      fetchMetric("time"),
    ]);
    const revenueByDate = new Map(
      revenueRows.map((point) => [
        point.business_date ?? point.label,
        Number(point.amount) || 0,
      ]),
    );
    return profitRows.map((point) => {
      const amount = Number(point.amount) || 0;
      const revenue =
        revenueByDate.get(point.business_date ?? point.label) ?? 0;
      return { ...point, amount, revenue, cost: revenue - amount };
    });
  }

  const rows = await fetchMetric(metric);
  return rows.map((point) => ({
    ...point,
    amount: Number(point.amount) || 0,
  }));
}
