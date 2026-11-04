import { describe, expect, it } from "vitest";
import { customerValues } from "./customers";

describe("customer values", () => {
  it("preserves leading zeroes and missing contact fields", () => {
    expect(
      customerValues({ name: "  Louis ", phone: " 0901234567 ", address: "" }),
    ).toEqual({ name: "Louis", phone: "0901234567", address: "" });
  });
  it("rejects blank names and oversized fields", () => {
    expect(() =>
      customerValues({ name: " ", phone: "", address: "" }),
    ).toThrow();
    expect(() =>
      customerValues({ name: "Louis", phone: "", address: "x".repeat(1001) }),
    ).toThrow();
  });
});
