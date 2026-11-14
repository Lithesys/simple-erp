import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRINT_TEMPLATE_CONTENT,
  PRINT_TEMPLATE_PREVIEW_DATA,
  renderPrintTemplate,
} from "./print-template";

describe("print template rendering", () => {
  it("fills invoice fields and expands the item table", () => {
    const rendered = renderPrintTemplate(
      DEFAULT_PRINT_TEMPLATE_CONTENT,
      PRINT_TEMPLATE_PREVIEW_DATA,
    );

    expect(rendered).toContain("NPP LAN DUY LINH");
    expect(rendered).toContain("DH000020");
    expect(rendered).toContain("Anh Hòa Q\\.1");
    expect(rendered).toContain("Combo Váy nữ Alcado KM-XMAS");
    expect(rendered).toContain(
      "| STT | Tên hàng | SL | ĐVT | Giá | Thành tiền |",
    );
    expect(rendered).not.toContain("{{invoice.items_table}}");
  });

  it("escapes values so product text cannot add markdown columns", () => {
    const rendered = renderPrintTemplate("{{invoice.items_table}}", {
      ...PRINT_TEMPLATE_PREVIEW_DATA,
      items: [
        {
          key: "unsafe",
          name: "Tên hàng | dòng mới\n**in đậm**",
          unit: "cái",
          quantity: 1,
          unitPrice: 1000,
          lineTotal: 1000,
        },
      ],
    });

    expect(rendered).toContain("Tên hàng \\| dòng mới \\*\\*in đậm\\*\\*");
    expect(rendered.split("\n")).toHaveLength(3);
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
