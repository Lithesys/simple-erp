"use client";

import MarkdownPreview from "@uiw/react-markdown-preview";
import rehypeSanitize from "rehype-sanitize";
import { useMemo } from "react";
import { useStoreBrand } from "@/components/store-brand-provider";
import {
  renderPrintTemplate,
  type PrintTemplate,
  type PrintTemplatePreviewData,
  type ReceiptPrintData,
  type ReceiptPrintItem,
} from "@/lib/print-template";
import { usePrintTemplates } from "@/lib/use-print-templates";

export type { ReceiptPrintData, ReceiptPrintItem } from "@/lib/print-template";

export function ReceiptPrint({
  receipt,
  items,
  isDraft = false,
  templateOverride,
}: {
  receipt: ReceiptPrintData;
  items: ReceiptPrintItem[];
  isDraft?: boolean;
  templateOverride?: PrintTemplate;
}) {
  const { displayName } = useStoreBrand();
  const { defaultTemplate } = usePrintTemplates();
  const template = templateOverride ?? defaultTemplate;
  const width = [58, 80, 210].includes(template.paper_width_mm)
    ? template.paper_width_mm
    : 80;
  const orientation =
    template.paper_orientation === "landscape" ? "landscape" : "portrait";
  const source = useMemo(() => {
    const data: PrintTemplatePreviewData = {
      storeName: displayName,
      receipt: {
        ...receipt,
        document_title: isDraft ? "PHIẾU IN NHÁP" : "HÓA ĐƠN BÁN HÀNG",
      },
      items,
    };
    return renderPrintTemplate(template.content, data);
  }, [displayName, isDraft, items, receipt, template.content]);

  return (
    <article
      className={`print-only receipt-print paper-${width}-${orientation}`}
      style={{ page: `invoice-${width}-${orientation}` }}
      aria-hidden="true"
      data-paper-width={width}
      data-paper-orientation={orientation}
    >
      <MarkdownPreview
        source={source}
        rehypePlugins={[[rehypeSanitize]]}
        className="receipt-markdown"
        wrapperElement={{ "data-color-mode": "light" }}
      />
    </article>
  );
}
