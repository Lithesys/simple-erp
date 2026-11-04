import { describe, expect, it } from "vitest";
import { createCsv } from "./csv-export";

describe("CSV export", () => {
  it("quotes cells, escapes embedded quotes, and adds a UTF-8 BOM", () => {
    const csv = createCsv(
      [
        {
          key: "name",
          label: "Tên",
          read: (row: { name: string }) => row.name,
        },
        {
          key: "amount",
          label: "Tổng",
          read: (row: { amount: number }) => row.amount,
        },
      ],
      [{ name: 'Khách "lẻ"', amount: 12000 }],
    );

    expect(csv).toBe('\ufeff"Tên","Tổng"\r\n"Khách ""lẻ""","12000"');
  });

  it("neutralizes formula-like text without changing numeric values", () => {
    const csv = createCsv(
      [
        {
          key: "name",
          label: "Tên",
          read: (row: { name: string }) => row.name,
        },
        {
          key: "amount",
          label: "Tổng",
          read: (row: { amount: number }) => row.amount,
        },
      ],
      [{ name: '=HYPERLINK("https://example.com")', amount: -500 }],
    );

    expect(csv).toContain("'=HYPERLINK(");
    expect(csv.endsWith('"-500"')).toBe(true);
  });
});
