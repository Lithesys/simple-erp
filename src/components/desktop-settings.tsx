"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type {
  DesktopConnectionTest,
  DesktopDatabaseConfig,
  DesktopDatabaseMode,
  DesktopState,
  DesktopUpdateState,
} from "@/types/desktop";
import { useStoreBrand } from "@/components/store-brand-provider";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const EMPTY_TEST: DesktopConnectionTest | null = null;
const EMPTY_UPDATE: DesktopUpdateState = { status: "idle" };
const DATABASE_STATE_PREFIXES = [
  "lan-duy-linh:pos-orders:v1:",
  "product-analysis-cache:v2:",
];

async function clearDatabaseScopedBrowserState() {
  for (const key of Object.keys(localStorage)) {
    if (
      /auth-token/i.test(key) ||
      DATABASE_STATE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
      key === "debts.last-item"
    ) {
      localStorage.removeItem(key);
    }
  }
  const { clearAllPosSearchCache } = await import("@/lib/pos-search-cache");
  await clearAllPosSearchCache();
}

export function DesktopDatabaseSettings({
  canManage = false,
  recovery = false,
}: {
  canManage?: boolean;
  recovery?: boolean;
}) {
  const router = useRouter();
  const { displayName } = useStoreBrand();
  const desktop = useSyncExternalStore(
    useCallback(() => () => {}, []),
    useCallback(() => typeof window !== "undefined" && Boolean(window.erpDesktop), []),
    () => false,
  );
  const [state, setState] = useState<DesktopState | null>(null);
  const [mode, setMode] = useState<DesktopDatabaseMode>("local");
  const [connectionString, setConnectionString] = useState("");
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [serviceRoleKey, setServiceRoleKey] = useState("");
  const [test, setTest] = useState<DesktopConnectionTest | null>(EMPTY_TEST);
  const [update, setUpdate] = useState<DesktopUpdateState>(EMPTY_UPDATE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const recoveryCanEdit =
    recovery && (state?.status === "error" || state?.status === "empty");
  const canEditConnection = recovery ? recoveryCanEdit : canManage;

  useEffect(() => {
    if (recovery) document.title = `Cơ sở dữ liệu · ${displayName}`;
  }, [displayName, recovery]);

  function returnToPreviousScreen() {
    if (window.history.length > 1) router.back();
    else router.replace("/login");
  }

  useEffect(() => {
    if (!window.erpDesktop) return;
    void window.erpDesktop.getState().then((next) => {
      setState(next);
      setMode(next.mode);
      setUpdate(next.update);
      if (next.message) setMessage(next.message);
    });
    return window.erpDesktop.onUpdateState(setUpdate);
  }, []);

  const buildConfig = useCallback((): DesktopDatabaseConfig => {
    const config: DesktopDatabaseConfig = { mode };
    if (mode !== "local" && connectionString.trim())
      config.connectionString = connectionString.trim();
    if (mode === "supabase") {
      if (supabaseUrl.trim()) config.supabaseUrl = supabaseUrl.trim();
      if (anonKey.trim()) config.anonKey = anonKey.trim();
      if (serviceRoleKey.trim()) config.serviceRoleKey = serviceRoleKey.trim();
    }
    return config;
  }, [mode, connectionString, supabaseUrl, anonKey, serviceRoleKey]);

  async function testConnection() {
    setBusy(true);
    setMessage("");
    setTest(null);
    try {
      const result = await window.erpDesktop?.testDatabase(buildConfig());
      if (!result) throw new Error("Desktop database controls are unavailable.");
      setTest(result);
    } catch (error) {
      setTest({
        ok: false,
        status: "incompatible",
        message: error instanceof Error ? error.message : "Connection failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveConnection() {
    setMessage("");
    if (!test?.ok) {
      setMessage("Test the database connection before switching.");
      return;
    }
    const initialize = test.status === "empty" || Boolean(test.migrations?.length);
    if (test.status === "empty") {
      if (
        !window.confirm(
          "This database is empty. Initialize it with the ERP schema and create the default admin/admin account? Existing tables are not changed.",
        )
      ) return;
    } else if (test.migrations?.length) {
      const preview = test.migrations.slice(0, 20).join("\n");
      const more = test.migrations.length > 20 ? `\n… and ${test.migrations.length - 20} more` : "";
      if (
        !window.confirm(
          `Apply these ${test.migrations.length} pending migrations to the remote database?\n\n${preview}${more}\n\nBack up the remote database before continuing.`,
        )
      ) return;
    }
    if (
      !window.confirm(
        "Switch the app to this database? Unsaved edits and open POS carts will be discarded. The app will sign out and return to login; records are not copied between databases.",
      )
    )
      return;

    setBusy(true);
    try {
      const { createClient } = await import("@/lib/data/client");
      const auth = createClient().auth;
      const { data: { session } } = await auth.getSession();
      if (!recovery && !session?.access_token)
        throw new Error("The administrator session expired. Sign in again before switching databases.");
      const result = await window.erpDesktop?.saveDatabase(
        buildConfig(),
        initialize,
        session?.access_token,
        recovery,
      );
      if (!result?.ok) throw new Error("Unable to switch databases.");
      await auth.signOut({ scope: "local" }).catch(() => undefined);
      await clearDatabaseScopedBrowserState();
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.split("=", 1)[0]?.trim();
        if (name?.startsWith("sb-") && name.includes("auth-token")) {
          document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
        }
      }
      sessionStorage.clear();
      window.location.replace("/login");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to switch databases.");
      setBusy(false);
    }
  }

  async function checkUpdates() {
    setBusy(true);
    try {
      await window.erpDesktop?.checkForUpdates();
    } catch (error) {
      setUpdate({
        status: "error",
        message: error instanceof Error ? error.message : "Update check failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!desktop) {
    return recovery ? (
      <section className="desktop-settings-card card">
        <AppButton
          variant="ghost"
          type="button"
          iconLeft={<ArrowLeft size={16} />}
          className="desktop-recovery-back"
          onClick={returnToPreviousScreen}
        >
          Quay lại
        </AppButton>
        <h1>Thiết lập chỉ có trên ứng dụng Desktop</h1>
        <p>Trang kết nối cơ sở dữ liệu này chỉ dùng trong bản Windows.</p>
      </section>
    ) : null;
  }

  return (
    <div className="desktop-settings-stack">
      {recovery && (
        <AppButton
          variant="ghost"
          type="button"
          iconLeft={<ArrowLeft size={16} />}
          className="desktop-recovery-back"
          onClick={returnToPreviousScreen}
        >
          Quay lại
        </AppButton>
      )}
      <section className="desktop-settings-card card">
        <header className="desktop-settings-heading">
          <div>
            <h2>Cơ sở dữ liệu</h2>
            <p>
              Kết nối hiện tại: <strong>{state?.connectionLabel || "Đang tải…"}</strong>
              {state?.status === "ready" ? " · Đã kết nối" : " · Cần kiểm tra"}
            </p>
          </div>
        </header>

        {!canEditConnection ? (
          <p className="system-settings-note" role="status">
            {recovery
              ? state?.status === "ready"
                ? "Cơ sở dữ liệu đang hoạt động. Đăng nhập bằng tài khoản quản trị để thay đổi kết nối."
                : state?.message || "Đang kiểm tra trạng thái kết nối…"
              : "Chỉ quản trị viên mới có thể đổi cơ sở dữ liệu."}
          </p>
        ) : (
          <>
            <label className="desktop-field">
              <span>Loại cơ sở dữ liệu</span>
              <select
                className="field"
                value={mode}
                disabled={busy}
                onChange={(event) => {
                  setMode(event.target.value as DesktopDatabaseMode);
                  setTest(null);
                  setMessage("");
                }}
              >
                <option value="local">Cơ sở dữ liệu trên máy này</option>
                <option value="postgres">PostgreSQL</option>
                <option value="supabase">Supabase</option>
              </select>
            </label>

            {mode !== "local" && (
              <label className="desktop-field">
                <span>PostgreSQL connection string</span>
                <AppInput
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    state?.configured && mode === state.mode
                      ? "Đã lưu an toàn; để trống để dùng kết nối hiện tại"
                      : "postgresql://user:password@host:5432/database"
                  }
                  value={connectionString}
                  disabled={busy}
                  onChange={(event) => {
                    setConnectionString(event.target.value);
                    setTest(null);
                  }}
                />
                <small>
                  Mật khẩu được mã hóa bằng kho bảo mật của Windows.
                </small>
              </label>
            )}

            {mode === "supabase" && (
              <div className="desktop-secret-grid">
                <label className="desktop-field desktop-field-wide">
                  <span>Supabase project URL</span>
                  <AppInput
                    className="field"
                    type="password"
                    autoComplete="new-password"
                    placeholder="https://project-ref.supabase.co"
                    value={supabaseUrl}
                    disabled={busy}
                    onChange={(event) => {
                      setSupabaseUrl(event.target.value);
                      setTest(null);
                    }}
                  />
                </label>
                <label className="desktop-field">
                  <span>Anon key</span>
                  <AppInput
                    className="field"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Đã lưu an toàn nếu đang dùng kết nối này"
                    value={anonKey}
                    disabled={busy}
                    onChange={(event) => {
                      setAnonKey(event.target.value);
                      setTest(null);
                    }}
                  />
                </label>
                <label className="desktop-field">
                  <span>Service role key</span>
                  <AppInput
                    className="field"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Đã lưu an toàn nếu đang dùng kết nối này"
                    value={serviceRoleKey}
                    disabled={busy}
                    onChange={(event) => {
                      setServiceRoleKey(event.target.value);
                      setTest(null);
                    }}
                  />
                  <small>Chỉ máy chủ desktop sử dụng khóa này.</small>
                </label>
              </div>
            )}

            <div className="desktop-settings-actions">
              <AppButton
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void testConnection()}
              >
                {busy ? "Đang kiểm tra…" : "Kiểm tra kết nối"}
              </AppButton>
              <AppButton
                type="button"
                variant="primary"
                disabled={busy || !test?.ok}
                onClick={() => void saveConnection()}
              >
                Lưu và chuyển cơ sở dữ liệu
              </AppButton>
            </div>
            {test && (
              <p
                className={
                  test.ok ? "desktop-feedback desktop-feedback-ok" : "desktop-feedback desktop-feedback-error"
                }
                role="status"
              >
                {test.message}
                {test.ok && test.status === "empty" &&
                  " Saving will initialize the schema and create the admin/admin login."}
              </p>
            )}
            {test?.migrationNote && (
              <p className="desktop-feedback desktop-feedback-error" role="status">{test.migrationNote}</p>
            )}
            {test?.migrations?.length ? (
              <div className="desktop-migration-preview" aria-label="Pending database migrations">
                <strong>{test.migrations.length} migration{test.migrations.length === 1 ? "" : "s"} will run after confirmation</strong>
                <ul>{test.migrations.map((name) => <li key={name}>{name}</li>)}</ul>
              </div>
            ) : null}
            {message && <p className="desktop-feedback desktop-feedback-error" role="alert">{message}</p>}
            {state?.message && state.status !== "ready" && (
              <p className="desktop-feedback desktop-feedback-error" role="status">{state.message}</p>
            )}
          </>
        )}
      </section>

      {!recovery && (
        <section className="desktop-settings-card card">
          <header className="desktop-settings-heading">
            <div>
              <h2>Cập nhật ứng dụng</h2>
              <p>Phiên bản hiện tại: {update.currentVersion || state?.appVersion || "—"}</p>
              <p>Tự kiểm tra khi quay lại ứng dụng; bản mới sẽ tự tải, cài đặt và khởi động lại.</p>
            </div>
          </header>
          <div className="desktop-settings-actions">
            <AppButton variant="secondary" type="button" disabled={busy || update.status === "checking" || update.status === "downloading" || update.status === "installing"} onClick={() => void checkUpdates()}>
              Kiểm tra cập nhật
            </AppButton>
          </div>
          {update.status === "checking" && <p className="desktop-feedback">Đang kiểm tra phiên bản mới…</p>}
          {update.status === "current" && <p className="desktop-feedback desktop-feedback-ok">Bạn đang dùng phiên bản mới nhất.</p>}
          {update.status === "available" && <p className="desktop-feedback">Có phiên bản {update.availableVersion}, đang chuẩn bị tải…</p>}
          {update.status === "downloading" && (
            <p className="desktop-feedback">Đang tải cập nhật: {Math.round(update.percent || 0)}%</p>
          )}
          {update.status === "installing" && <p className="desktop-feedback">Đang cài cập nhật. Ứng dụng sẽ tự khởi động lại.</p>}
          {update.status === "error" && <p className="desktop-feedback desktop-feedback-error" role="alert">{update.message}</p>}
          {update.status === "development" && <p className="desktop-feedback">Cập nhật kiểm tra được trong bản cài đặt.</p>}
        </section>
      )}
    </div>
  );
}
