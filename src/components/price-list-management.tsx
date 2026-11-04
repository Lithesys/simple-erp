"use client";

import { AppButton } from "@/components/app-button";
import { ModalLayer } from "@/components/modal-layer";
import { AppInput } from "@/components/app-input";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleDollarSign,
  Plus,
  Power,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "react-toastify";
import { createClient } from "@/lib/data/client";
import type { PriceList } from "@/lib/types";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCachedQuery } from "@/lib/query-cache";
import { useInitialTableLoading } from "@/lib/use-initial-table-loading";
import { useForm } from "react-hook-form";

export function PriceListManagement() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [lists, setLists] = useState<PriceList[]>([]);
  const [renaming, setRenaming] = useState<PriceList | null>(null);
  const createForm = useForm<{ name: string }>({ defaultValues: { name: "" } });
  const renameForm = useForm<{ name: string }>({ defaultValues: { name: "" } });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { loading, finishInitialLoad } = useInitialTableLoading();
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const confirmAction = useRef<(() => Promise<void>) | null>(null);
  const invalidateListMetadata = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["price-lists"] }),
      queryClient.invalidateQueries({ queryKey: ["active-price-lists"] }),
    ]);
  const invalidateListProducts = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["price-lists"] }),
      queryClient.invalidateQueries({ queryKey: ["active-price-lists"] }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["pos-products"] }),
    ]);
  const load = useCallback(async () => {
    try {
      const data = await fetchCachedQuery(
        queryClient,
        supabase,
        ["price-lists"],
        async () => {
          const result = await supabase
            .from("price_lists")
            .select("id,name,is_default,is_active")
            .order("created_at");
          if (result.error) throw result.error;
          return result.data;
        },
      );
      setLists((data || []) as PriceList[]);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không tải được bảng giá.",
      );
    }
    finishInitialLoad();
  }, [finishInitialLoad, queryClient, supabase]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function createList(values: { name: string }) {
    if (!values.name.trim()) return;
    setBusy(true);
    setError("");
    const { data: created, error: createError } = await supabase
      .from("price_lists")
      .insert({ name: values.name.trim() })
      .select("id")
      .single();
    if (createError) {
      setError(createError.message);
      setBusy(false);
      return;
    }
    const defaultList = lists.find((list) => list.is_default);
    if (defaultList) {
      const oldPrices = await fetchCachedQuery(
        queryClient,
        supabase,
        ["product-prices", defaultList.id],
        async () => {
          const result = await supabase
            .from("product_prices")
            .select("product_id,price")
            .eq("price_list_id", defaultList.id);
          if (result.error) throw result.error;
          return result.data;
        },
      ).catch(() => null);
      if (oldPrices?.length) {
        const sourcePrices = oldPrices as unknown as {
          product_id: string;
          price: number;
        }[];
        const { error: copyError } = await supabase
          .from("product_prices")
          .insert(
            sourcePrices.map((item) => ({
              product_id: item.product_id,
              price_list_id: created.id,
              price: item.price,
            })),
          );
        if (copyError)
          setError(
            "Bảng giá đã tạo nhưng chưa sao chép giá: " + copyError.message,
          );
      }
    }
    createForm.reset();
    setBusy(false);
    await invalidateListProducts();
    await load();
  }
  async function saveName(values: { name: string }) {
    if (!renaming) return;
    setBusy(true);
    const { error: updateError } = await supabase
      .from("price_lists")
      .update({ name: values.name.trim() })
      .eq("id", renaming.id);
    setError(updateError?.message || "");
    setBusy(false);
    if (!updateError) {
      setRenaming(null);
      await invalidateListMetadata();
      await load();
    }
  }
  async function setDefault(list: PriceList) {
    const { error: updateError } = await supabase.rpc(
      "set_default_price_list",
      { p_price_list_id: list.id },
    );
    setError(updateError?.message || "");
    if (!updateError) {
      await invalidateListMetadata();
      await load();
    }
  }
  async function toggle(list: PriceList) {
    if (list.is_default && list.is_active) {
      setError("Hãy chọn bảng giá mặc định khác trước khi ngừng bảng này.");
      return;
    }
    const { error: updateError } = await supabase
      .from("price_lists")
      .update({ is_active: !list.is_active })
      .eq("id", list.id);
    setError(updateError?.message || "");
    if (!updateError) {
      await invalidateListProducts();
      await load();
    }
  }
  async function remove(list: PriceList) {
    if (busy || list.is_default) return;
    confirmAction.current = async () => {
      setBusy(true);
      setError("");
      const { error: deleteError } = await supabase.rpc("delete_price_list", {
        p_price_list_id: list.id,
      });
      setBusy(false);
      if (deleteError) setError(deleteError.message);
      else {
        toast.success("Đã xóa bảng giá " + list.name + ".");
        await invalidateListProducts();
        await load();
      }
    };
    setConfirmRequest({
      title: "Xóa bảng giá?",
      message: `Xóa "${list.name}"? Giá liên quan sẽ bị xóa; tên trên hóa đơn cũ vẫn được giữ.`,
      confirmLabel: "Xóa bảng giá",
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Bảng giá</h1>
          <p>Tạo bảng giá riêng cho từng nhóm khách hàng.</p>
        </div>
      </div>
      {error && (
        <div className="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}
      <form
        className="card"
        onSubmit={createForm.handleSubmit(createList)}
        style={{
          padding: 17,
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 15,
        }}
      >
        <CircleDollarSign size={19} className="muted" />
        <AppInput
          className="field"
          style={{ flex: 1 }}
          required
          placeholder="Tên bảng giá mới"
          {...createForm.register("name", { required: true })}
        />
        <AppButton variant="primary" aria-label="Tạo bảng giá" disabled={busy}>
          <Plus size={15} />
          <span className="mobile-button-label">Tạo bảng giá</span>
        </AppButton>
      </form>
      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {lists.map((list) => (
            <section
              key={list.id}
              className="card"
              style={{
                padding: 17,
                display: "flex",
                alignItems: "center",
                gap: 13,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  display: "grid",
                  placeItems: "center",
                  background: list.is_default
                    ? "var(--primary-subtle)"
                    : "var(--surface-subtle)",
                  color: "var(--primary)",
                }}
              >
                <CircleDollarSign size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 650 }}>{list.name} </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {list.is_active ? "Đang sử dụng" : "Đã ngừng sử dụng"}
                </div>
              </div>
              {!list.is_default && list.is_active ? (
                <AppButton variant="secondary" onClick={() => setDefault(list)}>
                  Chọn mặc định
                </AppButton>
              ) : (
                list.is_default && (
                  <span className="badge" style={{ marginLeft: 6 }}>
                    <Star size={12} fill="currentColor" /> Mặc định
                  </span>
                )
              )}
              <AppButton
                variant="secondary"
                onClick={() => {
                  renameForm.reset({ name: list.name });
                  setRenaming(list);
                }}
              >
                Đổi tên
              </AppButton>
              <AppButton
                variant="ghost"
                title={list.is_active ? "Ngừng sử dụng" : "Kích hoạt"}
                onClick={() => toggle(list)}
              >
                {list.is_active ? <Power size={16} /> : <Check size={16} />}
              </AppButton>
              <AppButton
                variant="ghost"

                title={
                  list.is_default
                    ? "Không thể xóa bảng giá mặc định"
                    : "Xóa bảng giá"
                }
                aria-label={"Xóa bảng giá " + list.name}
                disabled={busy || list.is_default}
                onClick={() => void remove(list)}
              >
                <Trash2 size={16} />
              </AppButton>
            </section>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        Bảng giá mới được khởi tạo với giá sao chép từ bảng mặc định. Hãy cập
        nhật giá riêng trong trang Hàng hóa.
      </p>
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
      {renaming && (
        <ModalLayer
          className="modal-backdrop"
          onEscape={() => setRenaming(null)}
        >
          <form
            className="modal card"
            onSubmit={renameForm.handleSubmit(saveName)}
          >
            <div className="modal-title">
              <h2>Đổi tên bảng giá</h2>
            </div>
            <label className="form-label">
              Tên bảng giá
              <AppInput
                className="field"
                required
                autoFocus
                {...renameForm.register("name", { required: true })}
              />
            </label>
            <div className="form-actions">
              <AppButton
                variant="secondary"
                type="button"

                onClick={() => setRenaming(null)}
              >
                Hủy
              </AppButton>
              <AppButton variant="primary" disabled={busy}>
                Lưu
              </AppButton>
            </div>
          </form>
        </ModalLayer>
      )}
    </>
  );
}

