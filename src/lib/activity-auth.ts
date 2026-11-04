import "server-only";
import { createServiceClient } from "@/lib/data/server";
import {
  describeActivityDevice,
  sessionIdFromToken,
} from "@/lib/activity-device";

type AuthEvent = "login" | "logout";

export async function recordActivityAuthEvent({
  userId,
  accessToken,
  event,
  userAgent,
}: {
  userId: string;
  accessToken: string;
  event: AuthEvent;
  userAgent: string | null;
}) {
  const sessionId = sessionIdFromToken(accessToken);
  if (!sessionId) return false;

  try {
    const admin = createServiceClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name,username")
      .eq("id", userId)
      .maybeSingle();
    const { error } = await admin.from("activity_history").insert({
      operation_id: `auth:${sessionId}:${event}`,
      actor_id: userId,
      actor_name: profile?.display_name || profile?.username || "Tài khoản",
      feature: "Tài khoản",
      action: event === "login" ? "Đăng nhập" : "Đăng xuất",
      entity_type: "auth_session",
      entity_id: sessionId,
      entity_label: event === "login" ? "Phiên đăng nhập" : "Phiên đăng xuất",
      changed_fields: {},
      device: describeActivityDevice(userAgent),
      session_id: sessionId,
      auth_event: event,
    });
    // The unique session/event index makes retries idempotent.
    if (error?.code === "23505") return true;
    return !error;
  } catch {
    // An audit outage must never prevent login or leave a user half signed out.
    return false;
  }
}
