import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_TEMPLATE_CONTENT } from "./print-template";
import { createPrintTemplateMarkdownManager } from "./print-template-editor";

describe("print template Markdown editor serialization", () => {
  it("loads the default receipt with editable item and total tables", () => {
    const manager = createPrintTemplateMarkdownManager();
    const document = manager.parse(DEFAULT_PRINT_TEMPLATE_CONTENT);
    const serialized = manager.serialize(document);
    const json = JSON.stringify(document);

    expect(json.match(/"type":"table"/g)).toHaveLength(2);
    expect(json).toContain('"token":"invoice.item.name"');
    expect(json).toContain('"token":"invoice.total"');
    expect(json).toContain('"textAlign":"center"');
    expect(serialized).toContain("| Tổng tiền hàng");
    expect(serialized).toContain(":::print-align=center");
  });

  it("round-trips invoice fields and common text formatting", () => {
    const manager = createPrintTemplateMarkdownManager();
    const markdown =
      "**Mã đơn:** **{{invoice.document_no}}**\n\n*Ngày:* <ins>{{invoice.created_at}}</ins> *{{invoice.customer_name}}* ~~{{invoice.total}}~~\n\n__Ghi chú__";

    const document = manager.parse(markdown);
    const serialized = manager.serialize(document);
    const roundTrippedDocument = manager.parse(serialized);

    expect(JSON.stringify(document)).toContain('"token":"invoice.document_no"');
    expect(JSON.stringify(document)).toContain('"token":"invoice.created_at"');
    expect(JSON.stringify(document)).toContain('"type":"underline"');
    expect(serialized).toContain("<strong>{{invoice.document_no}}</strong>");
    expect(serialized).toContain("*Ngày:* <ins>{{invoice.created_at}}</ins>");
    expect(serialized).toContain("<em>{{invoice.customer_name}}</em>");
    expect(serialized).toContain("<del>{{invoice.total}}</del>");
    expect(JSON.stringify(roundTrippedDocument)).toContain('"type":"bold"');
    expect(JSON.stringify(roundTrippedDocument)).toContain('"type":"italic"');
    expect(JSON.stringify(roundTrippedDocument)).toContain('"type":"strike"');
    expect(serialized).toContain("**Ghi chú**");
  });

  it("round-trips font size on text and invoice field chips", () => {
    const manager = createPrintTemplateMarkdownManager();
    const markdown =
      '<span class="receipt-font-size-14">Tổng tiền: <strong>{{invoice.total}}</strong></span>';

    const document = manager.parse(markdown);
    const serialized = manager.serialize(document);
    const roundTrippedDocument = manager.parse(serialized);
    const json = JSON.stringify(roundTrippedDocument);

    expect(JSON.stringify(document)).toContain(
      '"type":"printTemplateFontSize","attrs":{"fontSize":14}',
    );
    expect(serialized).toContain('<span class="receipt-font-size-14">');
    expect(json).toContain('"token":"invoice.total"');
    expect(json).toContain('"fontSize":14');
    expect(json).toContain('"type":"bold"');
  });

  it("round-trips aligned lines and an editable repeating items table", () => {
    const manager = createPrintTemplateMarkdownManager();
    const markdown =
      ":::print-align=right\n**Mã đơn:** {{invoice.order_no}}\n:::\n\n| Hàng hóa | SL |\n| :--- | ---: |\n| **{{invoice.item.name}}** | {{invoice.item.quantity}} |";

    const document = manager.parse(markdown);
    const serialized = manager.serialize(document);
    const roundTrippedDocument = manager.parse(serialized);
    const json = JSON.stringify(roundTrippedDocument);

    expect(JSON.stringify(document)).toContain('"textAlign":"right"');
    expect(JSON.stringify(document)).toContain('"type":"table"');
    expect(JSON.stringify(document)).toContain('"token":"invoice.item.name"');
    expect(serialized).toContain(":::print-align=right");
    expect(serialized).toMatch(/\|\s*Hàng hóa\s+\|\s*SL\s+\|/);
    expect(serialized).toMatch(/\|\s*:[-]+\s+\|\s*[-]+:\s+\|/);
    expect(json).toContain('"textAlign":"right"');
    expect(json).toContain('"token":"invoice.item.name"');
    expect(json).toContain('"type":"bold"');
  });

  it("round-trips a two-column text row without creating a table", () => {
    const manager = createPrintTemplateMarkdownManager();
    const document = manager.parse(
      ":::print-columns\nKhách hàng: {{invoice.customer_name}}\n|||\nĐịa chỉ: {{invoice.customer_address}}\n:::",
    );
    const serialized = manager.serialize(document);
    const roundTripped = manager.parse(serialized);
    const json = JSON.stringify(roundTripped);

    expect(json).toContain('"type":"printTemplateColumns"');
    expect(json).toContain('"token":"invoice.customer_name"');
    expect(json).toContain('"token":"invoice.customer_address"');
    expect(json).not.toContain('"type":"table"');
    expect(serialized).toContain("|||");
  });
});
