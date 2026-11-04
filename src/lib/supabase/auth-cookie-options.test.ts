import { describe, expect, it } from "vitest";
import { AUTH_SESSION_COOKIE_OPTIONS } from "./auth-cookie-options";

describe("Supabase auth cookie options", () => {
  it("keeps the refresh session available for one year", () => {
    expect(AUTH_SESSION_COOKIE_OPTIONS.maxAge).toBe(365 * 24 * 60 * 60);
  });
});
