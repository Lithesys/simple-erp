import { describe, expect, it } from "vitest";
import { currentMonthDateRange } from "./debt-date-range";

describe("debt date range defaults", () => {
  it("covers the current month", () => {
    expect(currentMonthDateRange("2026-10-10")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("handles leap February", () => {
    expect(currentMonthDateRange("2024-02-13")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });
});
