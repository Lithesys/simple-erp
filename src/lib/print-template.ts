export type PrintTemplate = {
  id: string;
  name: string;
  content: string;
  paper_width_mm: 58 | 80 | 210;
  paper_orientation: "portrait" | "landscape";
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ReceiptPrintData = {
  order_no: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  note: string;
  price_list_name: string;
  cashier_name?: string;
  document_title?: string;
  subtotal: number;
  discount: number;
  total: number;
  created_at: string;
};

export type ReceiptPrintItem = {
  key: string;
  sku?: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type PrintTemplatePreviewData = {
  storeName: string;
  receipt: ReceiptPrintData;
  items: ReceiptPrintItem[];
};

export type PrintTemplateField = {
  group: string;
  label: string;
  token: string;
  description: string;
};

export const PRINT_TEMPLATE_FONT_SIZES = [
  8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 24, 30,
] as const;

export const PRINT_TEMPLATE_FIELDS: PrintTemplateField[] = [
  {
    group: "Gian hàng",
    label: "Tên cửa hàng",
    token: "store.name",
    description: "Tên cửa hàng đang dùng trong hệ thống.",
  },
  {
    group: "Hóa đơn",
    label: "Tiêu đề hóa đơn",
    token: "invoice.document_title",
    description: "Tiêu đề hóa đơn bán hàng hoặc phiếu in nháp.",
  },
  {
    group: "Hóa đơn",
    label: "Mã đơn hàng",
    token: "invoice.order_no",
    description: "Mã của hóa đơn vừa thanh toán.",
  },
  {
    group: "Hóa đơn",
    label: "Ngày thanh toán",
    token: "invoice.created_at",
    description: "Thời điểm tạo hóa đơn.",
  },
  {
    group: "Khách hàng",
    label: "Khách hàng",
    token: "invoice.customer_name",
    description: "Tên khách hàng hoặc Khách lẻ.",
  },
  {
    group: "Khách hàng",
    label: "Số điện thoại",
    token: "invoice.customer_phone",
    description: "Số điện thoại khách hàng.",
  },
  {
    group: "Khách hàng",
    label: "Địa chỉ khách hàng",
    token: "invoice.customer_address",
    description: "Địa chỉ được lưu cùng hóa đơn.",
  },
  {
    group: "Hóa đơn",
    label: "Thu ngân",
    token: "invoice.cashier_name",
    description: "Tên tài khoản đã thực hiện thanh toán.",
  },
  {
    group: "Hóa đơn",
    label: "Bảng giá",
    token: "invoice.price_list_name",
    description: "Bảng giá áp dụng cho hóa đơn.",
  },
  {
    group: "Hóa đơn",
    label: "Ghi chú",
    token: "invoice.note",
    description: "Ghi chú của hóa đơn.",
  },
  {
    group: "Hàng hóa",
    label: "STT hàng hóa",
    token: "invoice.item.index",
    description: "Số thứ tự mặt hàng trong dòng lặp của bảng hàng hóa.",
  },
  {
    group: "Hàng hóa",
    label: "Mã hàng",
    token: "invoice.item.sku",
    description: "Mã SKU của mặt hàng trong dòng lặp của bảng hàng hóa.",
  },
  {
    group: "Hàng hóa",
    label: "Tên hàng",
    token: "invoice.item.name",
    description: "Tên mặt hàng trong dòng lặp của bảng hàng hóa.",
  },
  {
    group: "Hàng hóa",
    label: "Số lượng hàng",
    token: "invoice.item.quantity",
    description: "Số lượng trong dòng lặp của bảng hàng hóa.",
  },
  {
    group: "Hàng hóa",
    label: "Đơn vị hàng",
    token: "invoice.item.unit",
    description: "Đơn vị tính trong dòng lặp của bảng hàng hóa.",
  },
  {
    group: "Hàng hóa",
    label: "Đơn giá hàng",
    token: "invoice.item.unit_price",
    description: "Đơn giá trong dòng lặp của bảng hàng hóa.",
  },
  {
    group: "Hàng hóa",
    label: "Thành tiền hàng",
    token: "invoice.item.line_total",
    description: "Thành tiền trong dòng lặp của bảng hàng hóa.",
  },
  {
    group: "Tổng tiền",
    label: "Tổng tiền hàng",
    token: "invoice.subtotal",
    description: "Tổng tiền trước khi giảm giá.",
  },
  {
    group: "Tổng tiền",
    label: "Giảm giá",
    token: "invoice.discount",
    description: "Số tiền được giảm trên hóa đơn.",
  },
  {
    group: "Tổng tiền",
    label: "Thanh toán",
    token: "invoice.total",
    description: "Số tiền khách cần thanh toán.",
  },
];

export const DEFAULT_PRINT_TEMPLATE_ITEMS_TABLE = `| Hàng hóa | ĐVT | SL | Giá | Tiền |
| :--- | :--- | ---: | ---: | ---: |
| **{{invoice.item.name}}** | {{invoice.item.unit}} | {{invoice.item.quantity}} | {{invoice.item.unit_price}} | {{invoice.item.line_total}} |`;

export const DEFAULT_PRINT_TEMPLATE_CONTENT = `# {{store.name}}

:::print-align=center
{{invoice.document_title}}
:::

:::print-align=center
{{invoice.created_at}}
:::

---

Mã đơn: {{invoice.order_no}}

Khách hàng: **{{invoice.customer_name}}**

Số điện thoại: {{invoice.customer_phone}}

Địa chỉ: {{invoice.customer_address}}

Bảng giá: {{invoice.price_list_name}}

Ghi chú: {{invoice.note}}

${DEFAULT_PRINT_TEMPLATE_ITEMS_TABLE}

---

| Tổng tiền hàng | **{{invoice.subtotal}}** |
| :--- | ---: |
| Giảm giá | **{{invoice.discount}}** |
| **THANH TOÁN** | **{{invoice.total}}** |

:::print-align=center
Xin cảm ơn quý khách!
:::
`;

export const DEFAULT_PRINT_TEMPLATE: PrintTemplate = {
  id: "local-default",
  name: "Mẫu in hóa đơn",
  content: DEFAULT_PRINT_TEMPLATE_CONTENT,
  paper_width_mm: 80,
  paper_orientation: "portrait",
  is_default: true,
};

export const PRINT_TEMPLATE_PREVIEW_DATA: PrintTemplatePreviewData = {
  storeName: "NPP LAN DUY LINH",
  receipt: {
    order_no: "DH000020",
    document_title: "HÓA ĐƠN BÁN HÀNG",
    customer_name: "Anh Hòa Q.1",
    customer_phone: "0987654321",
    customer_address: "Số 10, Phố Quang, Tân Bình, TPHCM",
    cashier_name: "Nguyễn Hạnh Phúc",
    price_list_name: "Bán lẻ",
    note: "",
    subtotal: 82000,
    discount: 6000,
    total: 76000,
    created_at: "25/12/2024 21:30",
  },
  items: [
    {
      key: "sample-1",
      sku: "KM-XMAS",
      name: "Combo Váy nữ Alcado KM-XMAS",
      unit: "chiếc",
      quantity: 4,
      unitPrice: 12500,
      lineTotal: 50000,
    },
    {
      key: "sample-2",
      sku: "KM-XMAS",
      name: "KM-XMAS",
      unit: "cái",
      quantity: 1,
      unitPrice: 7000,
      lineTotal: 7000,
    },
    {
      key: "sample-3",
      sku: "KM-XMAS",
      name: "KM-XMAS",
      unit: "cái",
      quantity: 1,
      unitPrice: 25000,
      lineTotal: 25000,
    },
  ],
};

const moneyFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});
const quantityFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 3,
});

export function formatPrintMoney(value: number) {
  return `${moneyFormatter.format(Math.round(value))} VNĐ`;
}

function escapeMarkdownText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}<>#+.!|])/g, "\\$1")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replace(/[\r\n]+/g, " ");
}

export function normalizePrintTemplateContent(template: string) {
  return template
    .replace(/\n*<!--print-template-column-widths:[\s\S]*?-->/g, "")
    .replace(
      /^[ \t]*\{\{\s*invoice\.items_table\s*\}\}[ \t]*$/gim,
      DEFAULT_PRINT_TEMPLATE_ITEMS_TABLE,
    );
}

export function getPrintTemplateColumnWidths(template: string) {
  const match = /<!--print-template-column-widths:([\s\S]*?)-->/.exec(template);
  if (!match) return [] as number[][];
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((table) =>
      Array.isArray(table)
        ? table.map((width) => {
            const value = Number(width);
            return Number.isFinite(value) && value > 0
              ? Math.max(1, Math.min(99, value))
              : 0;
          })
        : [],
    ) as number[][];
  } catch {
    return [];
  }
}

export function setPrintTemplateColumnWidths(
  template: string,
  widths: number[][],
) {
  const clean = normalizePrintTemplateContent(template).trimEnd();
  const marker = `<!--print-template-column-widths:${JSON.stringify(widths)}-->`;
  return `${clean}\n\n${marker}`;
}

function itemFieldValue(item: ReceiptPrintItem, index: number, field: string) {
  switch (field) {
    case "index":
      return String(index + 1);
    case "sku":
      return item.sku || "";
    case "name":
      return item.name;
    case "quantity":
      return quantityFormatter.format(item.quantity);
    case "unit":
      return item.unit;
    case "unit_price":
      return moneyFormatter.format(Math.round(item.unitPrice));
    case "line_total":
      return moneyFormatter.format(Math.round(item.lineTotal));
    default:
      return "";
  }
}

function expandItemRows(template: string, items: ReceiptPrintItem[]) {
  return template
    .split("\n")
    .flatMap((line) => {
      if (!line.startsWith("|") || !/\{\{\s*invoice\.item\./i.test(line)) {
        return [line];
      }
      return items.map((item, index) =>
        line.replace(
          /\{\{\s*invoice\.item\.([a-z0-9_]+)\s*\}\}/gi,
          (_match, field: string) =>
            escapeMarkdownText(itemFieldValue(item, index, field)),
        ),
      );
    })
    .join("\n");
}

export function renderPrintTemplate(
  template: string,
  data: PrintTemplatePreviewData,
) {
  const { receipt, items } = data;
  const values: Record<string, string> = {
    "store.name": data.storeName,
    "invoice.document_title": receipt.document_title || "HÓA ĐƠN BÁN HÀNG",
    "invoice.order_no": receipt.order_no,
    "invoice.created_at": receipt.created_at,
    "invoice.customer_name": receipt.customer_name,
    "invoice.customer_phone": receipt.customer_phone || "—",
    "invoice.customer_address": receipt.customer_address || "—",
    "invoice.cashier_name": receipt.cashier_name || "",
    "invoice.price_list_name": receipt.price_list_name,
    "invoice.note": receipt.note,
    "invoice.subtotal": formatPrintMoney(receipt.subtotal),
    "invoice.discount": formatPrintMoney(receipt.discount),
    "invoice.total": formatPrintMoney(receipt.total),
  };

  const normalizedTemplate = normalizePrintTemplateContent(template);
  const alignedTemplate = normalizedTemplate.replace(
    /:::print-align=(left|center|right)\s*\r?\n([\s\S]*?)\r?\n:::/gi,
    (_match, alignment: string, content: string) =>
      `<span class="receipt-line-align-${alignment.toLowerCase()}">${content}</span>`,
  );
  const columnTemplate = alignedTemplate.replace(
    /:::print-columns\s*\r?\n([\s\S]*?)\r?\n\|\|\|\r?\n([\s\S]*?)\r?\n:::/gi,
    (_match, left: string, right: string) =>
      `<div class="print-template-columns" data-print-columns="2"><div>${left}</div><div>${right}</div></div>`,
  );
  const withOptionalNote = receipt.note.trim()
    ? columnTemplate
    : columnTemplate
        .split("\n")
        .filter((line) => !line.includes("{{invoice.note}}"))
        .join("\n");
  const expandedRows = expandItemRows(withOptionalNote, items);

  return expandedRows.replace(
    /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi,
    (match, token: string) => {
      if (token === "invoice.items_table" || token.startsWith("invoice.item."))
        return "";
      if (!Object.prototype.hasOwnProperty.call(values, token)) return "";
      return escapeMarkdownText(values[token]);
    },
  );
}
