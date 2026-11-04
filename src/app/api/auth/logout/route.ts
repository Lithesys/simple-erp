import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/data/server";
import { recordActivityAuthEvent } from "@/lib/activity-auth";

export async function POST(request: NextRequest) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey)
    return NextResponse.json(
      { error: "Phiên đăng nhập không hợp lệ." },
      { status: 401 },
    );

  const auth = createAuthClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user)
    return NextResponse.json(
      { error: "Phiên đăng nhập không hợp lệ." },
      { status: 401 },
    );

  const recorded = await recordActivityAuthEvent({
    userId: data.user.id,
    accessToken: token,
    event: "logout",
    userAgent: request.headers.get("user-agent"),
  });
  return NextResponse.json({ recorded }, { status: recorded ? 200 : 503 });
}
