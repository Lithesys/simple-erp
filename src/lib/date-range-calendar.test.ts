import { describe, expect, it, vi } from "vitest";
import { selectAvailableDateCell } from "./date-range-calendar";

describe("selectAvailableDateCell", () => {
  it("selects an available calendar cell inside the picker", () => {
    const cell = { tagName: "TD" } as unknown as Element;
    const closest = vi.fn(() => cell);
    const target = { closest } as unknown as EventTarget;
    const calendarElement = {
      contains: vi.fn(() => true),
    } as unknown as Pick<HTMLElement, "contains">;
    const clickDate = vi.fn();
    const stopPropagation = vi.fn();

    expect(
      selectAvailableDateCell(
        target,
        calendarElement,
        clickDate,
        stopPropagation,
      ),
    ).toBe(true);
    expect(closest).toHaveBeenCalledWith("td.available");
    expect(calendarElement.contains).toHaveBeenCalledWith(cell);
    expect(clickDate).toHaveBeenCalledWith({
      target: cell,
      stopPropagation,
    });
  });

  it("ignores targets outside available date cells or outside the picker", () => {
    const cell = { tagName: "TD" } as unknown as Element;
    const clickDate = vi.fn();
    const calendarElement = {
      contains: vi.fn(() => false),
    } as unknown as Pick<HTMLElement, "contains">;

    expect(
      selectAvailableDateCell(
        {} as EventTarget,
        calendarElement,
        clickDate,
        vi.fn(),
      ),
    ).toBe(false);
    expect(
      selectAvailableDateCell(
        { closest: vi.fn(() => null) } as unknown as EventTarget,
        calendarElement,
        clickDate,
        vi.fn(),
      ),
    ).toBe(false);
    expect(
      selectAvailableDateCell(
        { closest: vi.fn(() => cell) } as unknown as EventTarget,
        calendarElement,
        clickDate,
        vi.fn(),
      ),
    ).toBe(false);
    expect(clickDate).not.toHaveBeenCalled();
  });
});
