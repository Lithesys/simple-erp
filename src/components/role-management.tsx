"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { ModalLayer } from "@/components/modal-layer";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Pencil, Plus, Shield, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/data/client";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCachedQuery } from "@/lib/query-cache";
import { useInitialTableLoading } from "@/lib/use-initial-table-loading";
import { useForm } from "react-hook-form";
import { changedFieldPatch } from "@/lib/partial-update";

type Role = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  is_system: boolean;
};
type PermissionOption = {
  permission: string;
  permissions?: string[];
  label: string;
  description?: string;
};

const permissionCategories: {
  category: string;
  permissions: PermissionOption[];
}[] = [
  {
    category: "Hàng hóa",
    permissions: [
      { permission: "products.read", label: "Xem hàng hóa" },
      { permission: "products.create", label: "Tạo hàng hóa" },
      {
        permission: "products.update",
        permissions: ["products.update", "products.archive"],
        label: "Chỉnh sửa hàng hoá",
      },
      { permission: "products.cost.read", label: "Xem giá vốn" },
    ],
  },
  {
    category: "Đơn hàng",
    permissions: [
      {
        permission: "orders.read_own",
        permissions: ["orders.read_own", "orders.read_all"],
        label: "Xem đơn hàng",
      },
      { permission: "orders.edit", label: "Chỉnh sửa đơn hàng" },
      {
        permission: "orders.delete",
        label: "Huỷ đơn hàng",
      },
    ],
  },
  {
    category: "Bán hàng",
    permissions: [
      { permission: "sales.create", label: "Tạo và thanh toán đơn hàng" },
      {
        permission: "sales.price.override",
        label: "Chỉnh sửa đơn giá tại POS",
      },
    ],
  },
  {
    category: "Khách hàng",
    permissions: [
      { permission: "customers.create", label: "Thêm khách hàng" },
      { permission: "customers.read", label: "Xem khách hàng" },
      { permission: "customers.update", label: "Sửa khách hàng" },
      { permission: "customers.delete", label: "Xóa khách hàng" },
    ],
  },
  {
    category: "Công nợ",
    permissions: [
      { permission: "debts.read", label: "Xem danh sách nợ" },
      { permission: "debts.create", label: "Thêm khoản nợ" },
      { permission: "debts.update", label: "Sửa khoản nợ" },
      { permission: "debts.delete", label: "Xóa khoản nợ" },
      { permission: "debts.report", label: "Xem báo cáo nợ" },
    ],
  },
  {
    category: "Nhập hàng",
    permissions: [
      {
        permission: "purchases.read",
        label: "Xem đơn nhập hàng",
      },
      { permission: "purchases.create", label: "Tạo đơn nhập hàng" },
      { permission: "purchases.update", label: "Sửa đơn nhập hàng" },
      { permission: "purchases.delete", label: "Xóa hoặc hủy đơn nhập hàng" },
      { permission: "purchases.approve", label: "Hoàn thành đơn nhập hàng" },
    ],
  },
  {
    category: "Kiểm kho",
    permissions: [
      { permission: "stock_checks.read", label: "Xem phiếu kiểm kho" },
      {
        permission: "stock_checks.create",
        label: "Tạo phiếu kiểm kho",
      },
      { permission: "stock_checks.update", label: "Sửa phiếu kiểm kho" },
      {
        permission: "stock_checks.delete",
        label: "Xoá phiếu kiểm kho",
      },
      {
        permission: "stock_checks.complete",
        label: "Hoàn thành phiếu kiểm kho",
      },
    ],
  },
  {
    category: "Bảng giá",
    permissions: [
      { permission: "price_lists.manage", label: "Quản lý bảng giá" },
    ],
  },
  {
    category: "Mẫu in",
    permissions: [
      { permission: "print_templates.read", label: "Xem mẫu in" },
      { permission: "print_templates.create", label: "Tạo mẫu in" },
      { permission: "print_templates.update", label: "Chỉnh sửa mẫu in" },
      { permission: "print_templates.delete", label: "Xóa mẫu in" },
    ],
  },
  {
    category: "Tài khoản và phân quyền",
    permissions: [
      { permission: "accounts.manage", label: "Quản lý tài khoản" },
      { permission: "roles.manage", label: "Quản lý vai trò" },
      {
        permission: "activity_history.read",
        label: "Xem lịch sử thao tác",
        description:
          "Người dùng có thể xem toàn bộ lịch sử thao tác, bao gồm giá vốn và giá bán trong các giao dịch.",
      },
    ],
  },
];
const permissionGroups = permissionCategories.flatMap(
  (group) => group.permissions,
);
const hiddenPermissionLabels: Record<string, string> = {
  "stock_checks.export": "Xuất dữ liệu kiểm kho",
};

function permissionLabel(permission: string) {
  return (
    permissionGroups.find(
      (item) =>
        item.permission === permission || item.permissions?.includes(permission),
    )?.label ||
    hiddenPermissionLabels[permission] ||
    permission
  );
}

export function RoleManagement() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<Role[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);
  const { register, handleSubmit, reset, watch, setValue } = useForm<Role>({
    defaultValues: {
      id: "",
      name: "",
      description: "",
      permissions: [],
      is_system: false,
    },
  });
  const selectedPermissions = watch("permissions");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { loading, finishInitialLoad } = useInitialTableLoading();
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const confirmAction = useRef<(() => Promise<void>) | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await fetchCachedQuery(
        queryClient,
        supabase,
        ["roles"],
        async () => {
          const result = await supabase
            .from("roles")
            .select("id,name,description,permissions,is_system")
            .order("is_system", { ascending: false })
            .order("name");
          if (result.error) throw result.error;
          return result.data;
        },
      );
      setRoles((data || []) as Role[]);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không tải được vai trò.",
      );
    } finally {
      finishInitialLoad();
    }
  }, [finishInitialLoad, queryClient, supabase]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function save(formValues: Role) {
    if (!editing) return;
    setBusy(true);
    setError("");
    const values = {
      name: formValues.name.trim(),
      description: formValues.description.trim(),
      permissions: formValues.permissions,
    };
    const patch = changedFieldPatch(
      editing,
      values,
      ["name", "description", "permissions"],
      (left, right) =>
        Array.isArray(left) && Array.isArray(right)
          ? left.length === right.length &&
            left.every((permission) => right.includes(permission))
          : Object.is(left, right),
    );
    const result = editing.id
      ? Object.keys(patch).length
        ? await supabase.from("roles").update(patch).eq("id", editing.id)
        : { error: null }
      : await supabase.from("roles").insert(values);
    setBusy(false);
    if (result.error) setError(result.error.message);
    else {
      setEditing(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["roles"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      ]);
      await load();
    }
  }
  async function remove(role: Role) {
    if (role.is_system) return;
    confirmAction.current = async () => {
      const { error: deleteError } = await supabase
        .from("roles")
        .delete()
        .eq("id", role.id);
      if (deleteError) setError(deleteError.message);
      else {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["roles"] }),
          queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        ]);
        await load();
      }
    };
    setConfirmRequest({
      title: "Xóa vai trò?",
      message: `Xóa "${role.name}"? Hãy chuyển tài khoản sang vai trò khác trước.`,
      confirmLabel: "Xóa vai trò",
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Vai trò & quyền</h1>
          <p>Gán quyền theo nhóm chức năng cho tài khoản.</p>
        </div>
        <AppButton
          variant="primary"
          aria-label="Tạo vai trò"
          onClick={() => {
            const blank = {
              id: "",
              name: "",
              description: "",
              permissions: [],
              is_system: false,
            };
            reset(blank);
            setEditing(blank);
          }}
        >
          <Plus size={16} />
          <span className="mobile-button-label">Tạo vai trò</span>
        </AppButton>
      </div>
      {error && (
        <div className="alert" style={{ marginBottom: 13 }}>
          {error}
        </div>
      )}
      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {roles.map((role) => (
            <section
              className="card"
              key={role.id}
              style={{ padding: 18, display: "flex", gap: 13 }}
            >
              <div
                className="brand-mark"
                style={{
                  color: "var(--primary)",
                  background: "var(--primary-subtle)",
                  flexShrink: 0,
                }}
              >
                <Shield size={17} />
              </div>
              <div
                style={{ flex: 1, minWidth: 0 }}
              >
                <div style={{ fontWeight: 650 }}>
                  {role.name}
                  {role.is_system && <span className="badge">Hệ thống</span>}
                </div>
                <p
                  className="muted"
                  style={{ fontSize: 12, margin: "5px 0 9px" }}
                >
                  {role.description || "Chưa có mô tả"}
                </p>
                <div className="muted" style={{ fontSize: 11 }}>
                  {role.is_system && role.name === "Admin"
                    ? "Toàn quyền quản trị"
                    : role.permissions
                        .map(permissionLabel)
                        .filter((label, index, labels) =>
                          labels.indexOf(label) === index,
                        )
                        .join(" · ") || "Chưa được cấp quyền"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {!role.is_system && (
                  <AppButton
                    variant="ghost"
                    className="aspect-square my-auto"
                    title="Chỉnh sửa vai trò"
                    aria-label={`Chỉnh sửa vai trò ${role.name}`}
                    onClick={() => {
                      reset(role);
                      setEditing(role);
                    }}
                  >
                    <Pencil size={16} />
                  </AppButton>
                )}
                <AppButton
                  variant="ghost"
                  className="aspect-square my-auto"
                  title="Xóa vai trò"
                  disabled={role.is_system}
                  onClick={() => remove(role)}
                >
                  <Trash2 size={16} />
                </AppButton>
              </div>
            </section>
          ))}
        </div>
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
      {editing && (
        <ModalLayer
          className="modal-backdrop"
          onEscape={() => setEditing(null)}
        >
          <form className="modal card" onSubmit={handleSubmit(save)}>
            <div className="modal-title">
              <h2>{editing.id ? "Sửa vai trò" : "Tạo vai trò"}</h2>
              <AppButton
                variant="ghost"
                type="button"

                onClick={() => setEditing(null)}
              >
                <X size={18} />
              </AppButton>
            </div>
            <div className="modal-form">
              <label className="form-label">
                Tên vai trò
                <AppInput
                  className="field"
                  required
                  {...register("name", { required: true })}
                />
              </label>
              <label className="form-label">
                Mô tả
                <AppInput className="field" {...register("description")} />
              </label>
              <div className="span-2">
                <div className="form-label">
                  Quyền theo nhóm chức năng
                </div>
                <div className="permission-categories">
                  {permissionCategories.map((group) => (
                    <fieldset
                      className="permission-category"
                      key={group.category}
                    >
                      <legend>{group.category}</legend>
                      {group.permissions.map((item) => (
                        <label className="permission-option" key={item.permission}>
                          <AppInput
                            type="checkbox"
                            checked={(item.permissions ?? [item.permission]).every(
                              (permission) =>
                                selectedPermissions?.includes(permission) ?? false,
                            )}
                            aria-checked={
                              (item.permissions ?? [item.permission]).some(
                                (permission) =>
                                  selectedPermissions?.includes(permission) ??
                                  false,
                              ) &&
                              !(item.permissions ?? [item.permission]).every(
                                (permission) =>
                                  selectedPermissions?.includes(permission) ??
                                  false,
                              )
                                ? "mixed"
                                : undefined
                            }
                            ref={(input) => {
                              if (!input) return;
                              const permissions =
                                item.permissions ?? [item.permission];
                              const selectedCount = permissions.filter(
                                (permission) =>
                                  selectedPermissions?.includes(permission) ??
                                  false,
                              ).length;
                              input.indeterminate =
                                selectedCount > 0 &&
                                selectedCount < permissions.length;
                            }}
                            onChange={(e) => {
                              const next = new Set(selectedPermissions || []);
                              for (const permission of
                                item.permissions ?? [item.permission]) {
                                if (e.target.checked) next.add(permission);
                                else next.delete(permission);
                              }
                              setValue("permissions", [...next], {
                                shouldDirty: true,
                              });
                            }}
                          />
                          <span className="permission-option-label">
                            {item.label}
                            {item.description && (
                              <span
                                className="permission-info"
                                title={item.description}
                                aria-label={item.description}
                                role="img"
                                tabIndex={0}
                              >
                                <CircleAlert size={14} aria-hidden="true" />
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>
              </div>
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

                onClick={() => setEditing(null)}
              >
                Hủy
              </AppButton>
              <AppButton variant="primary" disabled={busy}>
                {busy ? "Đang lưu…" : "Lưu vai trò"}
              </AppButton>
            </div>
          </form>
        </ModalLayer>
      )}
    </>
  );
}
