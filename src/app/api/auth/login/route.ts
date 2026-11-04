import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient, createServiceClient } from "@/lib/data/server";
import { recordActivityAuthEvent } from "@/lib/activity-auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const username = body.username?.trim().toLowerCase() || "";
    if (
      !/^[a-z0-9._-]{3,32}$/.test(username) ||
      typeof body.password !== "string" ||
      !body.password
    ) {
      return NextResponse.json(
        { error: "Tên đăng nhập hoặc mật khẩu chưa chính xác." },
        { status: 401 },
      );
    }
    if (process.env.ERP_DESKTOP_BUILD === "true") {
      const gateway = process.env.ERP_DESKTOP_GATEWAY_URL;
      if (!gateway)
        return NextResponse.json(
          { error: "Desktop database service is not running." },
          { status: 503 },
        );
      const response = await fetch(`${gateway}/desktop/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: body.password }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        return NextResponse.json(
          { error: result.error || "Tên đăng nhập hoặc mật khẩu chưa chính xác." },
          { status: response.status },
        );
      if (result.user_id) {
        await recordActivityAuthEvent({
          userId: result.user_id,
          accessToken: result.access_token,
          event: "login",
          userAgent: request.headers.get("user-agent"),
        });
      }
      return NextResponse.json(result);
    }
    const admin = createServiceClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id,is_active")
      .eq("username", username)
      .maybeSingle();
    if (!profile?.is_active)
      return NextResponse.json(
        { error: "Tên đăng nhập hoặc mật khẩu chưa chính xác." },
        { status: 401 },
      );
    const { data: account } = await admin.auth.admin.getUserById(profile.id);
    if (!account.user?.email)
      return NextResponse.json(
        { error: "Tên đăng nhập hoặc mật khẩu chưa chính xác." },
        { status: 401 },
      );
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey)
      return NextResponse.json(
        { error: "Ứng dụng chưa được cấu hình Supabase." },
        { status: 503 },
      );
    const auth = createAuthClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await auth.auth.signInWithPassword({
      email: account.user.email,
      password: body.password,
    });
    if (error || !data.session)
      return NextResponse.json(
        { error: "Tên đăng nhập hoặc mật khẩu chưa chính xác." },
        { status: 401 },
      );
    await recordActivityAuthEvent({
      userId: profile.id,
      accessToken: data.session.access_token,
      event: "login",
      userAgent: request.headers.get("user-agent"),
    });
    return NextResponse.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch {
    return NextResponse.json(
      { error: "Không thể đăng nhập lúc này." },
      { status: 500 },
    );
  }
}
