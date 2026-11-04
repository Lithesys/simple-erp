import type { CartLine } from "@/lib/types";

export function calculateTotals(
  lines: Pick<CartLine, "price" | "quantity">[],
  discountInput: number,
) {
  const subtotal = lines.reduce(
    (sum, line) => sum + Math.round(line.price * line.quantity),
    0,
  );
  const discount = Math.round(discountInput);
  if (!Number.isFinite(discount) || discount < 0 || discount > subtotal)
    throw new Error("Mức giảm giá phải từ 0 đến tổng tiền hàng.");
  return { subtotal, discount, total: subtotal - discount };
}
