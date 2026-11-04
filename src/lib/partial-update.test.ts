import { describe, expect, it } from "vitest";
import { changedFieldPatch } from "./partial-update";

type ExampleEntity = {
  name: string;
  stock: number;
  note: string | null;
  description: string | null;
};

describe("changedFieldPatch", () => {
  it("includes only supplied fields that changed", () => {
    const patch = changedFieldPatch<ExampleEntity, keyof ExampleEntity>(
      { name: "Tea", stock: 12, note: "Keep" },
      { name: "Tea", stock: 10 },
      ["name", "stock", "note"] as const,
    );

    expect(patch).toEqual({ stock: 10 });
  });

  it("keeps explicit nulls and omits undefined fields", () => {
    const patch = changedFieldPatch<ExampleEntity, keyof ExampleEntity>(
      { note: "Keep", description: "Existing" },
      { note: null, description: undefined },
      ["note", "description"] as const,
    );

    expect(patch).toEqual({ note: null });
  });

  it("supports equality for structured fields", () => {
    const patch = changedFieldPatch(
      { permissions: ["products.read", "sales.create"] },
      { permissions: ["sales.create", "products.read"] },
      ["permissions"] as const,
      (left, right) =>
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((value) => right.includes(value)),
    );

    expect(patch).toEqual({});
  });
});
