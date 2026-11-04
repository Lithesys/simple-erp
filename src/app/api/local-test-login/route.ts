import { NextResponse, type NextRequest } from "next/server";

type TestRole = "admin" | "employee";

const localTestAccounts: Record<TestRole, string> = {
  admin: "LOCAL_TEST_ADMIN_ACCOUNT",
  employee: "LOCAL_TEST_EMPLOYEE_ACCOUNT",
};

function isLocalSameOriginRequest(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") return false;

  const hostname = request.nextUrl.hostname.toLowerCase();
  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "::1"
  )
    return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!isLocalSameOriginRequest(request))
    return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const body = (await request.json()) as { role?: string };
    if (body.role !== "admin" && body.role !== "employee")
      return NextResponse.json(
        { error: "Tài khoản kiểm thử không hợp lệ." },
        { status: 400 },
      );

    const username = process.env[localTestAccounts[body.role]];
    const password = process.env.LOCAL_TEST_PASSWORD;
    if (!username || !password)
      return NextResponse.json(
        { error: "Thiếu cấu hình tài khoản kiểm thử trong .env.local." },
        { status: 503 },
      );

    const loginUrl = new URL("/api/auth/login", request.url);
    const loginResponse = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "user-agent": request.headers.get("user-agent") ?? "",
      },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    const result = await loginResponse.json().catch(() => ({}));
    return NextResponse.json(result, {
      status: loginResponse.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Không thể đăng nhập tài khoản kiểm thử lúc này." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
