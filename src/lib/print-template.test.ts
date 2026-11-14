import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRINT_TEMPLATE_CONTENT,
  PRINT_TEMPLATE_PREVIEW_DATA,
  getPrintTemplateColumnWidths,
  normalizePrintTemplateContent,
  renderPrintTemplate,
  setPrintTemplateColumnWidths,
} from "./print-template";

describe("print template rendering", () => {
  it("stores editable column proportions in hidden template metadata", () => {
    const withWidths = setPrintTemplateColumnWidths(
      "| A | B |\n| --- | --- |",
      [[35, 65]],
    );

    expect(getPrintTemplateColumnWidths(withWidths)).toEqual([[35, 65]]);
    expect(normalizePrintTemplateContent(withWidths)).toBe(
      "| A | B |\n| --- | --- |",
    );
  });

  it("fills invoice fields and expands the item table", () => {
    const rendered = renderPrintTemplate(
      DEFAULT_PRINT_TEMPLATE_CONTENT,
      PRINT_TEMPLATE_PREVIEW_DATA,
    );

    expect(rendered).toContain("NPP LAN DUY LINH");
    expect(rendered).toContain("DH000020");
    expect(rendered).toContain("Anh Hòa Q\\.1");
    expect(rendered).toContain("Combo Váy nữ Alcado KM-XMAS");
    expect(rendered).toContain("| Hàng hóa | ĐVT | SL | Giá | Tiền |");
    expect(rendered).toContain("| :--- | :--- | ---: | ---: | ---: |");
    expect(
      rendered.match(
        /^\| \*\*(?:Combo Váy nữ Alcado KM-XMAS|KM-XMAS)\*\* \|/gm,
      ),
    ).toHaveLength(3);
    expect(rendered).toContain("receipt-line-align-center");
    expect(rendered).toContain("| **THANH TOÁN** | **76\\.000 VNĐ** |");
    expect(rendered).not.toContain("{{invoice.items_table}}");
  });

  it("hides an empty optional note and prints it when present", () => {
    const withoutNote = renderPrintTemplate(
      DEFAULT_PRINT_TEMPLATE_CONTENT,
      PRINT_TEMPLATE_PREVIEW_DATA,
    );
    const withNote = renderPrintTemplate(DEFAULT_PRINT_TEMPLATE_CONTENT, {
      ...PRINT_TEMPLATE_PREVIEW_DATA,
      receipt: {
        ...PRINT_TEMPLATE_PREVIEW_DATA.receipt,
        note: "Giao hàng chiều nay",
      },
    });

    expect(withoutNote).not.toContain("Ghi chú:");
    expect(withNote).toContain("Ghi chú: Giao hàng chiều nay");
  });

  it("escapes values so product text cannot add markdown columns", () => {
    const rendered = renderPrintTemplate(
      `| Tên | Giá |\n| :--- | ---: |\n| {{invoice.item.name}} | {{invoice.item.unit_price}} |`,
      {
        ...PRINT_TEMPLATE_PREVIEW_DATA,
        items: [
          {
            key: "unsafe",
            sku: "SKU-1",
            name: "Tên hàng | dòng mới\n**in đậm**",
            unit: "cái",
            quantity: 1,
            unitPrice: 1000,
            lineTotal: 1000,
          },
        ],
      },
    );

    expect(rendered).toContain("Tên hàng \\| dòng mới \\*\\*in đậm\\*\\*");
    expect(rendered.split("\n")).toHaveLength(3);
    expect(rendered).toContain("| :--- | ---: |");
  });

  it("upgrades the legacy table placeholder to an editable repeating table", () => {
    const rendered = renderPrintTemplate(
      "Trước\n\n{{invoice.items_table}}\n\nSau",
      PRINT_TEMPLATE_PREVIEW_DATA,
    );

    expect(rendered).toContain("| Hàng hóa | ĐVT | SL | Giá | Tiền |");
    expect(rendered.match(/^\| \*\*.*\|$/gm)).toHaveLength(3);
    expect(rendered).not.toContain("{{invoice.item.");
  });

  it("repeats a user-edited row with the selected columns", () => {
    const rendered = renderPrintTemplate(
      "| SKU | Tên | Thành tiền |\n| :--- | :--- | ---: |\n| {{invoice.item.sku}} | {{invoice.item.name}} | {{invoice.item.line_total}} |",
      PRINT_TEMPLATE_PREVIEW_DATA,
    );

    expect(rendered).toContain("| SKU | Tên | Thành tiền |");
    expect(rendered).toContain(
      "| KM-XMAS | Combo Váy nữ Alcado KM-XMAS | 50\\.000 |",
    );
    expect(rendered.match(/^\| KM-XMAS \|/gm)).toHaveLength(3);
    expect(rendered).not.toContain("Hàng hóa | ĐVT");
  });

  it("removes unknown placeholders instead of printing template syntax", () => {
    expect(
      renderPrintTemplate(
        "Mã: {{invoice.missing}}",
        PRINT_TEMPLATE_PREVIEW_DATA,
      ),
    ).toBe("Mã: ");
  });
});
