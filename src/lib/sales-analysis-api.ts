import type { SupabaseClient } from "@supabase/supabase-js";

export type SalesAnalysisMetric =
  | "time"
  | "profit"
  | "discount"
  | "returns"
  | "employee";
export type SalesAnalysisRange = { from: string; to: string };
export type SalesAnalysisPoint = {
  label: string;
  business_date: string | null;
  amount: number;
};
export type SalesAnalysisPriceList = { id: string; name: string };

export async function fetchSalesAnalysisPriceLists(
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase.rpc(
    "get_sales_analysis_price_lists",
  );
  if (error) throw error;
  return (data ?? []) as unknown as SalesAnalysisPriceList[];
}

export async function fetchSalesAnalysisChart(
  supabase: SupabaseClient,
  range: SalesAnalysisRange,
  metric: SalesAnalysisMetric,
  priceListId: string,
) {
  const { data, error } = await supabase.rpc("get_sales_analysis_chart", {
    p_from: range.from,
    p_to: range.to,
    p_metric: metric,
    p_price_list_id: priceListId || null,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    label: string;
    business_date: string | null;
    amount: number | string;
  }[];
  return rows.map((point) => ({
    ...point,
    amount: Number(point.amount) || 0,
  }));
}
