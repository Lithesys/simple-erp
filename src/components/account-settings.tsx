"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { createClient } from "@/lib/data/client";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCachedQuery } from "@/lib/query-cache";

export function AccountSettings() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const profileForm = useForm<{ email: string; name: string }>({
    defaultValues: { email: "", name: "" },
  });
  const passwordForm = useForm<{
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>({
    defaultValues: { oldPassword: "", newPassword: "", confirmPassword: "" },
  });
  const busy =
    profileForm.formState.isSubmitting || passwordForm.formState.isSubmitting;
  const {
    register: registerProfile,
    handleSubmit: submitProfile,
    reset: resetProfile,
  } = profileForm;
  const {
    register: registerPassword,
    handleSubmit: submitPassword,
    reset: resetPassword,
    getValues: getPasswordValues,
  } = passwordForm;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetchCachedQuery(
      queryClient,
      supabase,
      ["account-settings"],
      async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Phiên đăng nhập đã hết hạn.");
        const { data, error } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .single();
        if (error) throw error;
        return { email: user.email || "", name: data?.display_name || "" };
      },
    )
      .then((profile) => {
        if (active) resetProfile(profile);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Không tải được thông tin tài khoản.",
          );
      });
    return () => {
      active = false;
    };
  }, [queryClient, supabase, resetProfile]);
  async function save(values: { email: string; name: string }) {
    setError("");
    setMessage("");
    const authUpdate: { email?: string } = {};
    if (values.email) authUpdate.email = values.email;
    if (Object.keys(authUpdate).length) {
      const { error: authError } = await supabase.auth.updateUser(authUpdate);
      if (authError) {
        setError(authError.message);
        return;
      }
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Phiên đăng nhập đã hết hạn.");
      return;
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ display_name: values.name })
      .eq("id", user.id);
    if (profileError) setError(profileError.message);
    else {
      await queryClient.invalidateQueries({ queryKey: ["account-settings"] });
      setMessage(
        "Đã lưu thay đổi. Nếu đổi email, hãy xác nhận email mới theo hướng dẫn từ Supabase.",
      );
    }
  }
  async function changePassword(values: {
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) {
    setError("");
    setMessage("");
    const { error: updateError } = await supabase.auth.updateUser({
      password: values.newPassword,
      current_password: values.oldPassword,
    });
    if (updateError) setError(updateError.message);
    else {
      resetPassword();
      setMessage("Đã đổi mật khẩu.");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Tài khoản của tôi</h1>
          <p>Cập nhật email đăng nhập và tên hiển thị.</p>
        </div>
      </div>
      <section className="card" style={{ maxWidth: 560, padding: 22 }}>
        <form
          className="auth-form"
          style={{ marginTop: 0 }}
          onSubmit={submitProfile(save)}
        >
          <label className="form-label">
            Email đăng nhập
            <AppInput
              className="field"
              type="email"
              required
              {...registerProfile("email", { required: true })}
            />
          </label>
          <label className="form-label">
            Tên hiển thị
            <AppInput className="field" {...registerProfile("name")} />
          </label>
          {error && <div className="alert">{error}</div>}
          {message && (
            <div
              className="badge badge-green"
              style={{ display: "block", borderRadius: 8, padding: 10 }}
            >
              {message}
            </div>
          )}
          <AppButton variant="primary"  disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu thay đổi"}
          </AppButton>
        </form>
      </section>
      <section
        className="card"
        style={{ maxWidth: 560, padding: 22, marginTop: 14 }}
      >
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Đổi mật khẩu</h2>
        <form
          className="auth-form"
          style={{ marginTop: 0 }}
          onSubmit={submitPassword(changePassword)}
        >
          <label className="form-label">
            Mật khẩu hiện tại
            <AppInput
              className="field"
              type="password"
              autoComplete="current-password"
              required
              {...registerPassword("oldPassword", { required: true })}
            />
          </label>
          <label className="form-label">
            Mật khẩu mới
            <AppInput
              className="field"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              {...registerPassword("newPassword", {
                required: true,
                minLength: 8,
              })}
            />
          </label>
          <label className="form-label">
            Xác nhận mật khẩu mới
            <AppInput
              className="field"
              type="password"
              autoComplete="new-password"
              required
              {...registerPassword("confirmPassword", {
                required: true,
                validate: (value) =>
                  value === getPasswordValues("newPassword") ||
                  "Mật khẩu xác nhận không khớp.",
              })}
            />
          </label>
          {error && <div className="alert">{error}</div>}
          {message && (
            <div
              className="badge badge-green"
              style={{ display: "block", borderRadius: 8, padding: 10 }}
            >
              {message}
            </div>
          )}
          <AppButton variant="primary"  disabled={busy}>
            {busy ? "Đang cập nhật…" : "Đổi mật khẩu"}
          </AppButton>
        </form>
      </section>
    </>
  );
}
