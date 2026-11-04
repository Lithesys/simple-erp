import { Buffer } from "node:buffer";

export function sessionIdFromToken(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { session_id?: unknown };
    return typeof claims.session_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        claims.session_id,
      )
      ? claims.session_id
      : null;
  } catch {
    return null;
  }
}

export function describeActivityDevice(userAgent: string | null) {
  const ua = userAgent ?? "";
  const device = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile\//i.test(ua))
    ? "iPad"
    : /iPhone|iPod/i.test(ua)
      ? "iPhone"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(ua)
            ? "macOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Thiết bị khác";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /Firefox\//i.test(ua)
      ? "Firefox"
      : /CriOS\//i.test(ua)
        ? "Chrome trên iOS"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Trình duyệt khác";
  return `${browser} · ${device}`;
}
