import { describe, expect, it } from "vitest";
import { describeActivityDevice, sessionIdFromToken } from "./activity-device";

function tokenWithSession(sessionId: string) {
  const payload = Buffer.from(
    JSON.stringify({ session_id: sessionId }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

describe("activity device snapshots", () => {
  it("labels common browser and device categories without storing the user agent", () => {
    expect(
      describeActivityDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15 Safari/604.1",
      ),
    ).toBe("Safari · iPhone");
    expect(
      describeActivityDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Version/17.0 Mobile/15 Safari/604.1",
      ),
    ).toBe("Safari · iPad");
    expect(
      describeActivityDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/126.0 Safari/537.36",
      ),
    ).toBe("Chrome · Windows");
    expect(describeActivityDevice(null)).toBe(
      "Trình duyệt khác · Thiết bị khác",
    );
  });

  it("extracts only a UUID session id and rejects malformed or absent claims", () => {
    const sessionId = "2a223bb6-2815-4b7a-9e93-b9b0a9cfa548";
    expect(sessionIdFromToken(tokenWithSession(sessionId))).toBe(sessionId);
    expect(sessionIdFromToken("not-a-token")).toBeNull();
    expect(
      sessionIdFromToken(tokenWithSession("user-id-not-session-id")),
    ).toBeNull();
  });
});
