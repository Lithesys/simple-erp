import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fetchSalesAnalysisChart } from "./sales-analysis-api";

describe("fetchSalesAnalysisChart", () => {
  it("combines daily revenue and profit into revenue, cost, and profit", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          { label: "02", business_date: "2026-11-02", amount: "300" },
          { label: "01", business_date: "2026-11-01", amount: "100" },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { label: "01", business_date: "2026-11-01", amount: "500" },
          { label: "02", business_date: "2026-11-02", amount: "700" },
        ],
        error: null,
      });
    const supabase = { rpc } as unknown as SupabaseClient;

    const rows = await fetchSalesAnalysisChart(
      supabase,
      { from: "2026-11-01", to: "2026-11-30" },
      "profit",
      "",
    );

    expect(rpc).toHaveBeenNthCalledWith(1, "get_sales_analysis_chart", {
      p_from: "2026-11-01",
      p_to: "2026-11-30",
      p_metric: "profit",
      p_price_list_id: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "get_sales_analysis_chart", {
      p_from: "2026-11-01",
      p_to: "2026-11-30",
      p_metric: "time",
      p_price_list_id: null,
    });
    expect(rows).toEqual([
      {
        label: "02",
        business_date: "2026-11-02",
        amount: 300,
        revenue: 700,
        cost: 400,
      },
      {
        label: "01",
        business_date: "2026-11-01",
        amount: 100,
        revenue: 500,
        cost: 400,
      },
    ]);
  });

  it("uses one request for non-profit metrics", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ label: "01", business_date: "2026-11-01", amount: "250" }],
      error: null,
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    const rows = await fetchSalesAnalysisChart(
      supabase,
      { from: "2026-11-01", to: "2026-11-01" },
      "time",
      "price-list-id",
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([
      { label: "01", business_date: "2026-11-01", amount: 250 },
    ]);
  });
});
