export function hasInvalidPurchaseQuantity(quantity: number | string) {
  const parsed = Number(quantity);
  return !Number.isFinite(parsed) || parsed <= 0;
}
