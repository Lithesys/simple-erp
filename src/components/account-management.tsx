"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { mergeClassNames } from "@/lib/class-names";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { AppSelect } from "@/components/app-select";
import { DataTable, type DataTableSort } from "@/components/data-table";
import { ModalLayer } from "@/components/modal-layer";
import { MobileTableToolbarMetrics } from "@/components/mobile-table-toolbar-metrics";
import { SearchInputField } from "@/components/search-input-field";
import { formatDateTime } from "@/lib/date";
import { usePreference } from "@/lib/preferences";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import { useDebounce } from "@/lib/debounce";
import { createClient } from "@/lib/data/client";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCachedQuery } from "@/lib/query-cache";
import { useInitialTableLoading } from "@/lib/use-initial-table-loading";
import { Controller, useForm } from "react-hook-form";

type Role = { id: string; name: string };
type Account = {
  id: string;
  email: string;
  profile: {
    username: string;
    display_name: string;
    is_active: boolean;
    role_id: string;
    roles: { id: string; name: string };
  } | null;
  last_sign_in_at: string | null;
};
type Draft = {
  id?: string;
  username: string;
  email: string;
  display_name: string;
  password: string;
  role_id: string;
  is_active: boolean;
};
const defaultAccountSort: DataTableSort = {
  key: "account",
  direction: "asc",
};

export function AccountManagement() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [currentUserId, setCurrentUserId] = useState("");
  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(
        (result: { data: { session: { user: { id: string } } | null } }) => {
          if (active) setCurrentUserId(result.data.session?.user.id || "");
        },
      );
    return () => {
      active = false;
    };
  }, [supabase]);
  const [users, setUsers] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [activeTotal, setActiveTotal] = useState(0);
  const [roles, setRoles] = useState<Role[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { register, handleSubmit, reset, control } = useForm<Draft>({
    defaultValues: {
      username: "",
      email: "",
      display_name: "",
      password: "",
      role_id: "",
      is_active: true,
    },
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [savedSort, setSort] = usePreference<DataTableSort | null>(
    "table.accounts.sort",
    defaultAccountSort,
  );
  const sort = savedSort ?? defaultAccountSort;
  const [hasMore, setHasMore] = useState(false);
  const { loading, finishInitialLoad } = useInitialTableLoading();
  const [query, setQuery] = usePreference("accounts.search", "");
  const debouncedQuery = useDebounce(query);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const confirmAction = useRef<(() => Promise<void>) | null>(null);
  const load = useCallback(
    async (nextPage = page, nextSize = size, nextSort = sort) => {
      try {
        const params = new URLSearchParams();
        params.set("page", String(nextPage));
        params.set("size", String(nextSize));
        if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
        params.set("sort", nextSort.key);
        params.set("dir", nextSort.direction);
        const body = await fetchCachedQuery(
          queryClient,
          supabase,
          [
            "accounts",
            debouncedQuery,
            nextPage,
            nextSize,
            nextSort.key,
            nextSort.direction,
          ],
          async () => {
            const response = await fetch("/api/accounts?" + params.toString());
            const result = await response.json().catch(() => ({}));
            if (!response.ok)
              throw new Error(result.error || "Không tải được tài khoản.");
            return result;
          },
        );
        setUsers(body.users || []);
        setRoles(body.roles || []);
        setTotal(body.total || 0);
        setActiveTotal(body.activeTotal || 0);
        setPage(nextPage);
        setSize(nextSize);
        setHasMore(body.hasMore);
        setError("");
        const url = new URL(window.location.href);
        url.searchParams.set("page", String(nextPage));
        url.searchParams.set("size", String(nextSize));
        window.history.replaceState(null, "", url.toString());
      } catch {
        setError("Không thể kết nối để tải tài khoản.");
      } finally {
        finishInitialLoad();
      }
    },
    [
      page,
      size,
      sort,
      debouncedQuery,
      finishInitialLoad,
      queryClient,
      supabase,
    ],
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timer = window.setTimeout(() => {
      void load(
        Math.max(1, Number(params.get("page")) || 1),
        [20, 50, 100].includes(Number(params.get("size")))
          ? Number(params.get("size"))
          : 20,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const visible = users;
  function start(user?: Account) {
    setError("");
    const nextDraft = user
      ? {
          id: user.id,
          username: user.profile?.username || "",
          email: user.email,
          display_name: user.profile?.display_name || "",
          password: "",
          role_id: user.profile?.role_id || roles[0]?.id || "",
          is_active: user.profile?.is_active ?? true,
        }
      : {
          username: "",
          email: "",
          display_name: "",
          password: "",
          role_id: roles[0]?.id || "",
          is_active: true,
        };
    reset(nextDraft);
    setDraft(nextDraft);
  }
  async function save(values: Draft) {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/accounts", {
        method: values.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "Không lưu được tài khoản.");
        return;
      }
      if (values.id) {
        const role = roles.find((item) => item.id === values.role_id);
        setUsers((current) =>
          current.map((user) =>
            user.id !== values.id
              ? user
              : {
                  ...user,
                  email: values.email.trim(),
                  profile: {
                    username: values.username.trim(),
                    display_name: values.display_name.trim(),
                    is_active: values.is_active,
                    role_id: values.role_id,
                    roles: {
                      id: values.role_id,
                      name: role?.name || user.profile?.roles?.name || "",
                    },
                  },
                },
          ),
        );
      }
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await load();
    } catch {
      setError("Không thể kết nối để lưu tài khoản.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(user: Account) {
    confirmAction.current = async () => {
      try {
        const response = await fetch(
          "/api/accounts?id=" + encodeURIComponent(user.id),
          { method: "DELETE" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) setError(body.error || "Không xóa được tài khoản.");
        else {
          await queryClient.invalidateQueries({ queryKey: ["accounts"] });
          await load();
        }
      } catch {
        setError("Không thể kết nối để xóa tài khoản.");
      }
    };
    setConfirmRequest({
      title: "Xóa tài khoản?",
      message: `Xóa ${user.email}? Lịch sử đơn hàng vẫn được giữ lại.`,
      confirmLabel: "Xóa tài khoản",
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Tài khoản</h1>
          <p>Tạo người dùng và gán vai trò truy cập.</p>
        </div>
        <AppButton
          variant="primary"
          aria-label="Tạo tài khoản"
          onClick={() => start()}
        >
          <Plus size={16} />
          <span className="mobile-button-label">Tạo tài khoản</span>
        </AppButton>
      </div>
      {error && !draft && (
        <div className="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div className="customer-table-workspace">
        <aside className="product-filters card">
          <label className="filter-label" htmlFor="account-search">
            Tìm tài khoản
          </label>
          <SearchInputField
            id="account-search"
            showSearchIcon={false}
            aria-label="Tìm tài khoản"
            placeholder="Email hoặc tên hiển thị"
            value={query}
            onChange={setQuery}
          />
        </aside>
        <div>
          {loading ? (
            <LoadingSkeleton rows={7} />
          ) : (
            <section className="card table-wrap">
              <MobileTableToolbarMetrics
                metrics={[
                  { label: "Tổng tài khoản", value: total },
                  { label: "Đang hoạt động", value: activeTotal },
                ]}
              />
              <DataTable
                storageKey="accounts"
                serverSort={{
                  value: sort,
                  onChange: (nextSort) => {
                    const url = new URL(window.location.href);
                    url.searchParams.set("page", "1");
                    window.history.replaceState(null, "", url.toString());
                    setSort(nextSort);
                    setPage(1);
                    void load(1, size, nextSort);
                  },
                }}
                rows={visible}
                rowKey={(user) => user.id}
                totalRows={total}
                empty="Không có tài khoản phù hợp trong trang này."
                toolbarSummary={
                  <>
                    <span>
                      Tổng tài khoản: <b>{total}</b>
                    </span>
                    <span> · </span>
                    <span>
                      Đang hoạt động: <b>{activeTotal}</b>
                    </span>
                  </>
                }
                columns={[
                  {
                    key: "account",
                    label: "Tài khoản",
                    value: (user) => user.profile?.username || user.email,
                    summary: `Tổng ${total} tài khoản`,
                    render: (user) => (
                      <>
                        <div style={{ fontWeight: 600 }}>
                          {user.profile?.username || "Chưa có tên đăng nhập"}
                        </div>
                        <div
                          className="muted"
                          style={{ fontSize: 11, marginTop: 4 }}
                        >
                          {user.profile?.display_name || "Chưa đặt tên"} ·{" "}
                          {user.email}
                        </div>
                      </>
                    ),
                  },
                  {
                    key: "role",
                    label: "Vai trò",
                    value: (user) => user.profile?.roles?.name || "",
                    render: (user) =>
                      user.profile?.roles?.name || "Chưa gán vai trò",
                  },
                  {
                    key: "status",
                    label: "Trạng thái",
                    value: (user) => (user.profile?.is_active ? 1 : 0),
                    summary: `${activeTotal} hoạt động · ${total - activeTotal} đã khóa`,
                    render: (user) => (
                      <span
                        className={mergeClassNames(
                          "badge",
                          user.profile?.is_active
                            ? "badge-green"
                            : "badge-amber",
                        )}
                      >
                        {user.profile?.is_active ? "Đang hoạt động" : "Đã khóa"}
                      </span>
                    ),
                  },
                  {
                    key: "last_sign_in",
                    label: "Đăng nhập gần nhất",
                    value: (user) => user.last_sign_in_at || "",
                    render: (user) =>
                      user.last_sign_in_at
                        ? formatDateTime(user.last_sign_in_at)
                        : "Chưa đăng nhập",
                  },
                  {
                    key: "actions",
                    label: "",
                    hideable: false,
                    render: (user: Account) => (
                      <div style={{ display: "flex", gap: 4 }}>
                        <AppButton
                          variant="ghost"
                          title="Chỉnh sửa tài khoản"
                          aria-label={`Chỉnh sửa tài khoản ${user.email}`}
                          onClick={() => start(user)}
                        >
                          <Pencil size={15} />
                        </AppButton>
                        <AppButton
                          variant="ghost"
                          title="Xóa"
                          aria-label={`Xóa tài khoản ${user.email}`}
                          onClick={() => void remove(user)}
                        >
                          <Trash2 size={15} />
                        </AppButton>
                      </div>
                    ),
                  },
                ]}
              />
              <div className="pagination">
                <span>
                  Trang {page} · {size} tài khoản/trang
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ width: 120 }}>
                    <AppSelect
                      ariaLabel="Số tài khoản trên trang"
                      value={size}
                      options={[20, 50, 100].map((value) => ({
                        value: String(value),
                        label: value + " / trang",
                      }))}
                      onChange={(value) => void load(1, Number(value))}
                    />
                  </div>
                  <AppButton
                    variant="secondary"

                    style={{ minHeight: 32, padding: "0 8px" }}
                    disabled={page <= 1}
                    onClick={() => void load(page - 1)}
                  >
                    <ChevronLeft size={15} />
                  </AppButton>
                  <AppButton
                    variant="secondary"

                    style={{ minHeight: 32, padding: "0 8px" }}
                    disabled={!hasMore}
                    onClick={() => void load(page + 1)}
                  >
                    <ChevronRight size={15} />
                  </AppButton>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
      {draft && (
        <ModalLayer
          className="modal-backdrop"
          onEscape={() => setDraft(null)}
        >
          <section className="modal card">
            <div className="modal-title">
              <h2>{draft.id ? "Cập nhật tài khoản" : "Tạo tài khoản"}</h2>
              <AppButton
                variant="ghost"
                type="button"

                onClick={() => setDraft(null)}
              >
                <X size={18} />
              </AppButton>
            </div>
            <form onSubmit={handleSubmit(save)}>
              <div className="modal-form">
                <label className="form-label">
                  Tên đăng nhập
                  <AppInput
                    className="field"
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[A-Za-z0-9._-]+"
                    {...register("username", {
                      required: true,
                      minLength: 3,
                      maxLength: 32,
                      pattern: /^[A-Za-z0-9._-]+$/,
                    })}
                  />
                </label>
                <label className="form-label">
                  Email đăng nhập
                  <AppInput
                    className="field"
                    type="email"
                    required
                    {...register("email", { required: true })}
                  />
                </label>
                <label className="form-label">
                  Tên hiển thị
                  <AppInput className="field" {...register("display_name")} />
                </label>
                <div className="form-label">
                  <label htmlFor="account-role">Vai trò</label>
                  <Controller
                    control={control}
                    name="role_id"
                    render={({ field }) => (
                      <AppSelect
                        id="account-role"
                        ariaLabel="Vai trò"
                        isDisabled={!roles.length || draft.id === currentUserId}
                        value={field.value}
                        options={roles.map((role) => ({
                          value: role.id,
                          label: role.name,
                        }))}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </div>
                <label className="form-label span-2">
                  {draft.id
                    ? "Mật khẩu mới (để trống để giữ nguyên)"
                    : "Mật khẩu (ít nhất 8 ký tự)"}
                  <AppInput
                    className="field"
                    type="password"
                    minLength={draft.id ? undefined : 8}
                    required={!draft.id}
                    {...register("password", {
                      required: !draft.id,
                      minLength: draft.id ? undefined : 8,
                    })}
                  />
                </label>
                {draft.id && (
                  <label className="permission-option span-2">
                    <AppInput type="checkbox" {...register("is_active")} />
                    Tài khoản đang hoạt động
                  </label>
                )}
              </div>
              {error && (
                <div className="alert" style={{ marginTop: 12 }}>
                  {error}
                </div>
              )}
              <div className="form-actions">
                <AppButton
                  variant="secondary"
                  type="button"

                  onClick={() => setDraft(null)}
                >
                  Hủy
                </AppButton>
                <AppButton variant="primary" disabled={busy}>
                  {busy ? "Đang lưu…" : "Lưu tài khoản"}
                </AppButton>
              </div>
            </form>
          </section>
        </ModalLayer>
      )}
      <ConfirmDialog
        request={confirmRequest}
        onCancel={() => {
          confirmAction.current = null;
          setConfirmRequest(null);
        }}
        onConfirm={() => {
          const action = confirmAction.current;
          confirmAction.current = null;
          setConfirmRequest(null);
          if (action) void action();
        }}
      />
    </>
  );
}
