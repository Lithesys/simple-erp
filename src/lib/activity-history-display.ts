import { formatDateTime } from "./date";

export type ActivityHistoryChange = { before: unknown; after: unknown };

const dateTimeFieldPattern = /(?:^|_)(?:at|date|time)$/i;

export function formatActivityDateValue(value: unknown, key: string) {
  if (
    !dateTimeFieldPattern.test(key) ||
    (typeof value !== "string" && !(value instanceof Date)) ||
    (typeof value === "string" && !Number.isFinite(Date.parse(value)))
  )
    return null;

  return formatDateTime(value);
}

export type ActivityHistoryDisplayDetail = {
  entity_type: string;
  entity_label: string;
  product_name?: string | null;
  changed_fields: Record<string, ActivityHistoryChange>;
};

export function isProductPriceUpdate(
  detail: ActivityHistoryDisplayDetail & { action: string },
) {
  return (
    detail.action === "Cập nhật" &&
    ["products", "product_prices", "product_costs"].includes(
      detail.entity_type,
    ) &&
    (Object.hasOwn(detail.changed_fields ?? {}, "price") ||
      Object.hasOwn(detail.changed_fields ?? {}, "cost"))
  );
}

export type ActivityHistoryTargetDetail = Pick<
  ActivityHistoryDisplayDetail,
  "entity_type" | "entity_label"
> & {
  entity_id: string;
  related_entity_id?: string | null;
};

type InvoiceOrderPresentation = {
  kind: "order";
  orderNumber: string;
  customerName: ActivityHistoryChange | null;
  amountDue: ActivityHistoryChange | null;
  note: ActivityHistoryChange | null;
};

type InvoiceItemPresentation = {
  kind: "item";
  productName: string;
  quantity: ActivityHistoryChange | null;
  unitPrice: ActivityHistoryChange | null;
  lineTotal: ActivityHistoryChange | null;
};

type PurchaseOrderPresentation = {
  kind: "purchase";
  purchaseNumber: string;
  total: ActivityHistoryChange | null;
  status: ActivityHistoryChange | null;
};

type PurchaseItemPresentation = {
  kind: "purchase-item";
  productName: string;
  quantity: ActivityHistoryChange | null;
  unit: ActivityHistoryChange | null;
  unitCost: ActivityHistoryChange | null;
  lineTotal: ActivityHistoryChange | null;
};

export type InvoiceDetailPresentation =
  | InvoiceOrderPresentation
  | InvoiceItemPresentation
  | PurchaseOrderPresentation
  | PurchaseItemPresentation
  | null;

function currentValue(change: ActivityHistoryChange | undefined) {
  if (!change) return undefined;
  return change.after === null || change.after === undefined
    ? change.before
    : change.after;
}

export function getActivityPriceListName(
  detail: ActivityHistoryDisplayDetail & { action: string },
) {
  if (
    detail.action !== "Cập nhật" ||
    detail.entity_type !== "product_prices" ||
    !Object.hasOwn(detail.changed_fields ?? {}, "price")
  )
    return null;

  const value = currentValue(detail.changed_fields.price_list_name);
  return typeof value === "string" && value.trim() ? value : null;
}

export function getInvoiceDetailPresentation(
  detail: ActivityHistoryDisplayDetail,
): InvoiceDetailPresentation {
  const fields = detail.changed_fields ?? {};

  if (detail.entity_type === "orders") {
    const orderNumber = String(
      detail.entity_label || currentValue(fields.order_no) || "",
    );
    return {
      kind: "order",
      orderNumber,
      customerName: fields.customer_name ?? null,
      amountDue: fields.total ?? null,
      note: fields.note ?? null,
    };
  }

  if (detail.entity_type === "order_items") {
    const productName = currentValue(fields.product_name);
    const savedProductName = detail.product_name?.trim();
    return {
      kind: "item",
      productName:
        typeof productName === "string" && productName.trim()
          ? productName
          : savedProductName || detail.entity_label || "Hàng hóa",
      quantity: fields.quantity ?? null,
      unitPrice: fields.unit_price ?? null,
      lineTotal: fields.line_total ?? null,
    };
  }

  if (detail.entity_type === "purchase_orders") {
    return {
      kind: "purchase",
      purchaseNumber: String(
        detail.entity_label || currentValue(fields.purchase_no) || "",
      ),
      total: fields.total ?? null,
      status: fields.status ?? null,
    };
  }

  if (detail.entity_type === "purchase_order_items") {
    const productName = currentValue(fields.product_name);
    const savedProductName = detail.product_name?.trim();
    return {
      kind: "purchase-item",
      productName:
        typeof productName === "string" && productName.trim()
          ? productName
          : savedProductName || detail.entity_label || "Hàng hóa",
      quantity: fields.quantity ?? null,
      unit: fields.unit ?? null,
      unitCost: fields.unit_cost ?? null,
      lineTotal: fields.line_total ?? null,
    };
  }

  return null;
}

export function formatInvoiceItemQuantityAdjustment(
  productName: string,
  quantity: ActivityHistoryChange,
) {
  const formatQuantity = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? value.toLocaleString("vi-VN")
      : String(value ?? "—");

  return `Điều chỉnh ${productName} từ ${formatQuantity(quantity.before)} qua ${formatQuantity(quantity.after)}`;
}

export function getActivityHistoryTargetHref(
  details: ActivityHistoryTargetDetail[],
) {
  const order = details.find((detail) => detail.entity_type === "orders");
  const orderItem = details.find(
    (detail) =>
      detail.entity_type === "order_items" && detail.related_entity_id,
  );
  const orderId = order?.entity_id || orderItem?.related_entity_id;
  if (orderId)
    return `/mobile/management/orders?${new URLSearchParams({ id: orderId })}`;

  const purchase = details.find(
    (detail) => detail.entity_type === "purchase_orders",
  );
  const purchaseItem = details.find(
    (detail) =>
      detail.entity_type === "purchase_order_items" && detail.related_entity_id,
  );
  const purchaseId = purchase?.entity_id || purchaseItem?.related_entity_id;
  if (purchaseId)
    return `/mobile/purchases?${new URLSearchParams({ id: purchaseId })}`;

  const debt = details.find((detail) => detail.entity_type === "debts");
  if (debt?.entity_id)
    return `/mobile/debt?${new URLSearchParams({ id: debt.entity_id })}`;

  const product = details.find((detail) =>
    [
      "products",
      "product_prices",
      "product_costs",
      "product_bundle_items",
      "inventory_movements",
    ].includes(detail.entity_type),
  );
  const productId = product?.related_entity_id || product?.entity_id;
  if (productId)
    return `/mobile/management/products?${new URLSearchParams({ id: productId })}`;

  return null;
}
