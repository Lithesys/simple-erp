import { describe, expect, it } from "vitest";
import { getDateRangePresets } from "./date-range-presets";

function presetMap(now: string) {
  return Object.fromEntries(
    getDateRangePresets(new Date(now)).map(({ label, start, end }) => [
      label,
      { start, end },
    ]),
  );
}

describe("getDateRangePresets", () => {
  it("creates calendar day, week, month, and year ranges in the app timezone", () => {
    const presets = presetMap("2026-10-29T16:30:00.000Z");

    expect(presets["Hôm nay"]).toEqual({
      start: "2026-10-29",
      end: "2026-10-29",
    });
    expect(presets["Hôm qua"]).toEqual({
      start: "2026-10-28",
      end: "2026-10-28",
    });
    expect(presets["Tuần này"]).toEqual({
      start: "2026-10-26",
      end: "2026-10-29",
    });
    expect(presets["Tháng này"]).toEqual({
      start: "2026-10-01",
      end: "2026-10-29",
    });
    expect(presets["Năm này (dương lịch)"]).toEqual({
      start: "2026-01-01",
      end: "2026-10-29",
    });
    expect(presets["Năm trước (dương lịch)"]).toEqual({
      start: "2025-01-01",
      end: "2025-12-31",
    });
  });

  it("returns adjacent lunar year ranges without gaps or overlaps", () => {
    const presets = presetMap("2026-10-29T16:30:00.000Z");
    const thisLunarYear = presets["Năm này (âm lịch)"];
    const previousLunarYear = presets["Năm trước (âm lịch)"];
    const dayAfterPreviousYear = new Date(
      `${previousLunarYear.end}T00:00:00.000Z`,
    );
    dayAfterPreviousYear.setUTCDate(dayAfterPreviousYear.getUTCDate() + 1);

    expect(thisLunarYear.start).toBe("2026-02-17");
    expect(previousLunarYear.end).toBe("2026-02-16");
    expect(dayAfterPreviousYear.toISOString().slice(0, 10)).toBe(
      thisLunarYear.start,
    );
    expect(thisLunarYear.start <= "2026-10-29").toBe(true);
    expect(thisLunarYear.end > "2026-10-29").toBe(true);
  });
});
