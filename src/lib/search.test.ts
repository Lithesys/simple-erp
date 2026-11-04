import { describe, expect, it } from "vitest";
import { getSearchTokens, matchesSearchQuery } from "./search";

describe("semantic search", () => {
  it("matches every word in any order and across the full searchable text", () => {
    expect(matchesSearchQuery("Phú Thị · SKU 633", "thi phu 633")).toBe(true);
    expect(matchesSearchQuery("633 Phú", "thi phu 633")).toBe(false);
  });

  it("ignores Vietnamese diacritics and repeated whitespace", () => {
    expect(getSearchTokens("  Nguyen   Thi  ")).toEqual(["nguyen", "thi"]);
    expect(matchesSearchQuery("Nguyễn Thị Đặng", "dang nguyen thi")).toBe(
      true,
    );
  });

  it("matches all tokens as substrings and treats an empty query as a match", () => {
    expect(matchesSearchQuery("Nguyễn Thị Đặng 0901234567", "thi 090123")).toBe(
      true,
    );
    expect(matchesSearchQuery("Nguyễn Thị Đặng", "thi 633")).toBe(false);
    expect(matchesSearchQuery("anything", "   ")).toBe(true);
  });
});
