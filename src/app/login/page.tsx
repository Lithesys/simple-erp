"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes } from "lucide-react";
import { useForm } from "react-hook-form";
import { createClient } from "@/lib/data/client";
import { isSupabaseConfigured } from "@/lib/data/client";
import { getUserPermissions } from "@/lib/auth";
import { getLandingPath } from "@/lib/access-control";
import { useStoreBrand } from "@/components/store-brand-provider";

export default function LoginPage() {
  const router = useRouter();
  const { displayName } = useStoreBrand();
  useEffect(() => {
    document.title = `Đăng nhập · ${displayName}`;
  }, [displayName]);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ username: string; password: string }>({
    defaultValues: { username: "", password: "" },
  });
  const [error, setError] = useState("");
  const localTestLoginStarted = useRef(false);

  const finishLogin = useCallback(
    async (result: {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    }) => {
      if (!result.access_token || !result.refresh_token) {
        setError(result.error || "Không thể tạo phiên đăng nhập. Vui lòng thử lại.");
        return;
      }
      const { error: authError } = await createClient().auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (authError) {
        setError(
          authError.status === 503
            ? "Không thể truy cập cơ sở dữ liệu để tạo phiên đăng nhập. Hãy kiểm tra kết nối rồi thử lại."
            : "Không thể tạo phiên đăng nhập. Vui lòng thử lại.",
        );
        return;
      }
      const access = await getUserPermissions();
      router.replace(getLandingPath(access?.permissions || []));
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (
      process.env.NODE_ENV !== "development" ||
      localTestLoginStarted.current
    )
      return;

    const role = new URLSearchParams(window.location.search).get("local-test");
    if (!role) return;
    if (role !== "admin" && role !== "employee") return;

    localTestLoginStarted.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/local-test-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(result.error || "Không thể đăng nhập tài khoản kiểm thử.");
          return;
        }
        await finishLogin(result);
      } catch {
        setError("Không thể đăng nhập tài khoản kiểm thử lúc này.");
      }
    })();
  }, [finishLogin]);

  async function submit(values: { username: string; password: string }) {
    setError("");
    if (!isSupabaseConfigured()) {
      setError(
        "Ứng dụng chưa được cấu hình Supabase. Hãy điền các biến NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
      return;
    }
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error || "Tên đăng nhập hoặc mật khẩu chưa chính xác.");
      return;
    }
    await finishLogin(result);
  }
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <div
          className="brand"
          style={{ color: "var(--primary)", marginBottom: 28 }}
        >
          <span
            className="brand-mark"
            style={{ color: "var(--surface)", background: "var(--primary)" }}
          >
            <Boxes size={18} />
          </span>
          <span>{displayName}</span>
        </div>
        <h1>Đăng nhập</h1>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Đăng nhập để bắt đầu phiên bán hàng.
        </p>
        <form className="auth-form" onSubmit={handleSubmit(submit)}>
          <label className="form-label">
            Tên đăng nhập
            <AppInput
              className="field"
              autoComplete="username"
              required
              {...register("username", { required: true })}
            />
          </label>
          <label className="form-label">
            Mật khẩu
            <AppInput
              className="field"
              type="password"
              autoComplete="current-password"
              required
              {...register("password", { required: true })}
            />
          </label>
          {error && <div className="alert">{error}</div>}
          <AppButton variant="primary"

            style={{ height: 44, marginTop: 4 }}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Đang đăng nhập…" : "Đăng nhập"}
          </AppButton>
        </form>
        <p className="muted" style={{ fontSize: 11, margin: "20px 0 0" }}>
          Tài khoản được quản lý bởi quản trị viên.
        </p>
        {process.env.NEXT_PUBLIC_DESKTOP_BUILD === "true" && (
          <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>
            <a href="/desktop/setup">Thiết lập hoặc sửa kết nối cơ sở dữ liệu</a>
          </p>
        )}
      </section>
    </main>
  );
}
