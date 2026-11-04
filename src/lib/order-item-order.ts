type OrderItemPosition = { id: string; display_order: number };

export function sortOrderItemsForDisplay<T extends OrderItemPosition>(
  items: T[],
): T[] {
  return [...items].sort(
    (left, right) =>
      left.display_order - right.display_order ||
      left.id.localeCompare(right.id),
  );
}
