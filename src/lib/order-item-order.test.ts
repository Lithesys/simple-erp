import { describe, expect, it } from "vitest";
import { sortOrderItemsForDisplay } from "./order-item-order";

describe("sortOrderItemsForDisplay", () => {
  it("restores the order in which an order's items were completed", () => {
    const loadedItems = [
      { id: "line-3", display_order: 2 },
      { id: "line-1", display_order: 0 },
      { id: "line-2", display_order: 1 },
    ];

    expect(
      sortOrderItemsForDisplay(loadedItems).map((item) => item.id),
    ).toEqual(["line-1", "line-2", "line-3"]);
    expect(loadedItems.map((item) => item.id)).toEqual([
      "line-3",
      "line-1",
      "line-2",
    ]);
  });
});
