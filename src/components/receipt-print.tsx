"use client";

import { AppTable } from "@/components/app-table";
import { formatQuantity } from "@/lib/format";
import { useStoreBrand } from "@/components/store-brand-provider";

const vndNumberFormat = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

function formatVndNumber(value: number) {
  return vndNumberFormat.format(Math.round(value));
}

export type ReceiptPrintData = {
  order_no: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  note: string;
  price_list_name: string;
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

export function ReceiptPrint({
  receipt,
  items,
  isDraft = false,
}: {
  receipt: ReceiptPrintData;
  items: ReceiptPrintItem[];
  isDraft?: boolean;
}) {
  const { displayName } = useStoreBrand();
  return (
    <article
      className="print-only"
      style={{
        fontFamily: "var(--font-family)",
        color: "var(--print-text)",
        fontSize: 11,
      }}
    >
      <div
        style={{
          textAlign: "center",
          borderBottom: "1px dashed var(--print-border)",
          paddingBottom: 9,
          marginBottom: 8,
        }}
      >
        <b style={{ fontSize: 15 }}>{displayName}</b>
        <div>{isDraft ? "PHIẾU IN NHÁP" : "HÓA ĐƠN BÁN HÀNG"}</div>
        <div>{receipt.created_at}</div>
      </div>
      <div>Mã đơn: {receipt.order_no}</div>
      <div>
        Khách hàng: <b>{receipt.customer_name}</b>
      </div>
      <div>Số điện thoại: {receipt.customer_phone || "—"}</div>
      <div style={{ overflowWrap: "anywhere" }}>
        Địa chỉ: {receipt.customer_address || "—"}
      </div>
      <div>Bảng giá: {receipt.price_list_name}</div>
      {receipt.note && (
        <div style={{ overflowWrap: "anywhere" }}>
          Ghi chú: {receipt.note}
        </div>
      )}
      <AppTable
        className="receipt-items-table"
        style={{
          minWidth: 0,
          width: "100%",
          tableLayout: "fixed",
          fontSize: 12,
          marginTop: 9,
        }}
      >
        <colgroup>
          <col style={{ width: "33%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "21%" }} />
          <col style={{ width: "21%" }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ padding: "4px 1px", textAlign: "left" }}>Hàng hóa</th>
            <th
              className="receipt-unit-cell"
              style={{ padding: "4px 1px", textAlign: "left" }}
            >
              ĐVT
            </th>
            <th
              className="receipt-quantity-cell"
              style={{ padding: "4px 1px", textAlign: "right" }}
            >
              SL
            </th>
            <th
              className="receipt-money-cell"
              style={{ padding: "4px 1px", textAlign: "right" }}
            >
              Giá
            </th>
            <th
              className="receipt-money-cell"
              style={{ padding: "4px 1px", textAlign: "right" }}
            >
              Tiền
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <td
                className="receipt-product-name"
                style={{ padding: "5px 1px", overflowWrap: "anywhere" }}
              >
                <b>{item.name}</b>
              </td>
              <td
                className="receipt-unit-cell"
                style={{ padding: "5px 1px", overflowWrap: "anywhere" }}
              >
                {item.unit}
              </td>
              <td
                className="receipt-quantity-cell"
                style={{ padding: "5px 1px", textAlign: "right" }}
              >
                {formatQuantity(item.quantity)}
              </td>
              <td
                className="receipt-money-cell"
                style={{ padding: "5px 1px", textAlign: "right" }}
              >
                {formatVndNumber(item.unitPrice)}
              </td>
              <td
                className="receipt-money-cell"
                style={{ padding: "5px 1px", textAlign: "right" }}
              >
                {formatVndNumber(item.lineTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </AppTable>
      <div
        style={{
          borderTop: "1px dashed var(--print-border)",
          paddingTop: 7,
          marginTop: 7,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Tổng tiền hàng</span>
          <b>{formatVndNumber(receipt.subtotal)} VNĐ</b>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 4,
          }}
        >
          <span>Giảm giá</span>
          <b>{formatVndNumber(receipt.discount)} VNĐ</b>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 14,
            marginTop: 6,
          }}
        >
          <b>THANH TOÁN</b>
          <b>{formatVndNumber(receipt.total)} VNĐ</b>
        </div>
      </div>
      <div style={{ textAlign: "center", marginTop: 15 }}>
        Xin cảm ơn quý khách!
      </div>
    </article>
  );
}
