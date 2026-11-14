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
    label: "Bảng hàng hóa",
    token: "invoice.items_table",
    description: "Danh sách mặt hàng, số lượng, đơn giá và thành tiền.",
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

export const DEFAULT_PRINT_TEMPLATE_CONTENT = `# {{store.name}}

**{{invoice.document_title}}**\
**Mã đơn:** {{invoice.order_no}}\
**Ngày:** {{invoice.created_at}}

---

**Tên KH:** {{invoice.customer_name}}\
**Địa chỉ:** {{invoice.customer_address}}\
**SĐT:** {{invoice.customer_phone}}\
**Thu ngân:** {{invoice.cashier_name}}

{{invoice.items_table}}

**Tổng tiền hàng:** {{invoice.subtotal}}\
**Giảm:** {{invoice.discount}}\
**Thanh toán:** {{invoice.total}}

*Cảm ơn quý khách, hẹn gặp lại!*
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
      name: "Combo Váy nữ Alcado KM-XMAS",
      unit: "chiếc",
      quantity: 4,
      unitPrice: 12500,
      lineTotal: 50000,
    },
    {
      key: "sample-2",
      name: "KM-XMAS",
      unit: "cái",
      quantity: 1,
      unitPrice: 7000,
      lineTotal: 7000,
    },
    {
      key: "sample-3",
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

export function formatPrintMoney(value: number) {
  return `${moneyFormatter.format(Math.round(value))} ₫`;
}

function escapeMarkdownText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}<>#+.!|])/g, "\\$1")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replace(/[\r\n]+/g, " ");
}

function makeItemsTable(items: ReceiptPrintItem[]) {
  const rows = items.map(
    (item, index) =>
      `| ${index + 1} | ${escapeMarkdownText(item.name)} | ${escapeMarkdownText(String(item.quantity))} | ${escapeMarkdownText(item.unit)} | ${escapeMarkdownText(moneyFormatter.format(Math.round(item.unitPrice)))} | ${escapeMarkdownText(moneyFormatter.format(Math.round(item.lineTotal)))} |`,
  );
  return [
    "| STT | Tên hàng | SL | ĐVT | Giá | Thành tiền |",
    "| ---: | :--- | ---: | :--- | ---: | ---: |",
    ...rows,
  ].join("\n");
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
    "invoice.customer_phone": receipt.customer_phone,
    "invoice.customer_address": receipt.customer_address,
    "invoice.cashier_name": receipt.cashier_name || "",
    "invoice.price_list_name": receipt.price_list_name,
    "invoice.note": receipt.note,
    "invoice.subtotal": formatPrintMoney(receipt.subtotal),
    "invoice.discount": formatPrintMoney(receipt.discount),
    "invoice.total": formatPrintMoney(receipt.total),
  };

  return template.replace(
    /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi,
    (match, token: string) => {
      if (token === "invoice.items_table") return makeItemsTable(items);
      if (!Object.prototype.hasOwnProperty.call(values, token)) return "";
      return escapeMarkdownText(values[token]);
    },
  );
}
