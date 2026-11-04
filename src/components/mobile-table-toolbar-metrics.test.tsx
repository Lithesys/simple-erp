import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MobileTableToolbarMetrics } from "./mobile-table-toolbar-metrics";

describe("MobileTableToolbarMetrics", () => {
  it("renders each table summary as an accessible dashboard metric card", () => {
    const markup = renderToStaticMarkup(
      createElement(MobileTableToolbarMetrics, {
        metrics: [
          { label: "Tổng số đơn", value: 12 },
          { label: "Tổng tiền hàng", value: "1.200.000 đ" },
        ],
      }),
    );

    expect(markup).toContain('aria-label="Thống kê bảng"');
    expect(markup.match(/class="card dashboard-metric"/g)).toHaveLength(2);
    expect(markup).toContain("Tổng số đơn");
    expect(markup).toContain("1.200.000 đ");
  });

  it("renders nothing when a table has no summary metrics", () => {
    expect(
      renderToStaticMarkup(
        createElement(MobileTableToolbarMetrics, { metrics: [] }),
      ),
    ).toBe("");
  });
});
