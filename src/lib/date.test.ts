import { describe, expect, it } from "vitest";
import { formatDate } from "./date";

describe("formatDate", () => {
  it("formats date-only values in the app timezone", () => {
    expect(formatDate("2026-10-01")).toBe("01/10/2026");
    expect(formatDate("2026-10-29")).toBe("29/10/2026");
  });
});
