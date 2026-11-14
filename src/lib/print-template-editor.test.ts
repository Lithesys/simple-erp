import { describe, expect, it } from "vitest";
import { createPrintTemplateMarkdownManager } from "./print-template-editor";

describe("print template Markdown editor serialization", () => {
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
});
