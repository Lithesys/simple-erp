"use client";

import { AppButton } from "@/components/app-button";
import { ModalLayer } from "@/components/modal-layer";
import { AppTextarea } from "@/components/app-textarea";
import { mergeClassNames } from "@/lib/class-names";
import { ReceiptPrint } from "@/components/receipt-print";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { createClient } from "@/lib/data/client";
import { formatQuantity, formatVnd } from "@/lib/format";
import { DECIMAL_SCALE } from "@/lib/constants";
import { calculateTotals } from "@/lib/pricing";
import { CustomerPicker } from "@/components/customer-picker";
import { SearchInputField } from "@/components/search-input-field";
import { NumberInputField } from "@/components/number-input-field";
import { PosCartLine } from "@/components/pos-cart-line";
import { formatDateTime } from "@/lib/date";
import { printPage } from "@/lib/print-page";
import { AppSelect } from "@/components/app-select";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCachedQuery, QUERY_STALE_TIME } from "@/lib/query-cache";
import type { CartLine, PriceList, Product } from "@/lib/types";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { Controller, useForm } from "react-hook-form";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { usePosOrderTabs } from "@/components/pos-order-tabs-context";
import {
  attachProductBundleItems,
  hasSellableBundleItems,
} from "@/lib/product-bundles";
import {
  clearPosSearchCache,
  readPosSearchCache,
  searchProductsLocally,
  syncPosSearchData,
} from "@/lib/pos-search-cache";

type Receipt = {
  order_no: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  note: string;
  price_list_name: string;
  subtotal: number;
  discount: number;
  total: number;
  created_at: string;
  items: CartLine[];
};
type SaleFormValues = {
  listId: string;
  customer: string;
  customerPhone: string;
  customerAddress: string;
  note: string;
  discount: number;
  cart: CartLine[];
};

export function PointOfSale({ canEditPrice }: { canEditPrice: boolean }) {
  const pathname = usePathname();
  const isMobileRoute = pathname.startsWith("/mobile/");
  const {
    activeOrder,
    activeOrderId,
    transitionDirection,
    isReady: orderTabsReady,
    setTabActivityBusy,
    createOrder,
    updateOrder,
  } = usePosOrderTabs();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [query, setQuery] = useState("");
  const saleForm = useForm<SaleFormValues>({
    defaultValues: {
      listId: activeOrder.listId,
      customer: activeOrder.customer,
      customerPhone: activeOrder.customerPhone,
      customerAddress: activeOrder.customerAddress,
      note: activeOrder.note,
      discount: activeOrder.discount,
      cart: activeOrder.cart,
    },
  });
  const {
    getValues: getSaleValue,
    setValue: setSaleValue,
    handleSubmit: handleSaleSubmit,
    control: saleFormControl,
    reset: resetSaleForm,
  } = saleForm;
  const listId = saleForm.watch("listId");
  const cart = saleForm.watch("cart");
  const customer = saleForm.watch("customer");
  const customerPhone = saleForm.watch("customerPhone");
  const customerAddress = saleForm.watch("customerAddress");
  const note = saleForm.watch("note");
  const discount = saleForm.watch("discount");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [draftPrint, setDraftPrint] = useState(false);
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [discountInputVersion, setDiscountInputVersion] = useState(0);
  const productSearchRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const lastFormOrderIdRef = useRef<string | null>(null);
  const lastAnimatedOrderIdRef = useRef<string | null>(null);
  const posScreenRef = useRef<HTMLDivElement>(null);
  const panelTouchStartRef = useRef<{ y: number; onHeader: boolean } | null>(
    null,
  );
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const activeOrderRef = useRef(activeOrder);
  const lastPosSyncRef = useRef(0);
  const posSyncInFlightRef = useRef(false);

  useEffect(() => {
    activeOrderRef.current = activeOrder;
  }, [activeOrder]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("screen and (max-width: 720px)");
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!orderTabsReady || !activeOrderId) return;
    if (lastFormOrderIdRef.current !== activeOrderId) {
      lastFormOrderIdRef.current = activeOrderId;
      const order = activeOrderRef.current;
      resetSaleForm({
        listId: order.listId,
        customer: order.customer,
        customerPhone: order.customerPhone,
        customerAddress: order.customerAddress,
        note: order.note,
        discount: order.discount,
        cart: order.cart,
      });
      setQuery("");
      setNotice("");
      setRetryKey(null);
      setReceipt(null);
      return;
    }

    updateOrder(activeOrderId, {
      listId,
      customer,
      customerPhone,
      customerAddress,
      note,
      discount: Number(discount) || 0,
      cart,
    });
  }, [
    orderTabsReady,
    activeOrderId,
    listId,
    customer,
    customerPhone,
    customerAddress,
    note,
    discount,
    cart,
    resetSaleForm,
    updateOrder,
  ]);

  useEffect(() => {
    if (!orderTabsReady || !activeOrderId) return;
    if (lastAnimatedOrderIdRef.current === null) {
      lastAnimatedOrderIdRef.current = activeOrderId;
      return;
    }
    if (lastAnimatedOrderIdRef.current === activeOrderId) return;
    lastAnimatedOrderIdRef.current = activeOrderId;

    const screen = posScreenRef.current;
    if (
      !screen ||
      typeof screen.animate !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    screen.getAnimations().forEach((animation) => animation.cancel());
    const offset = transitionDirection === "right" ? "18px" : "-18px";
    screen.animate(
      [
        { transform: `translateX(${offset})`, opacity: 0.9 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 200, easing: "ease-out" },
    );
  }, [orderTabsReady, activeOrderId, transitionDirection]);

  const load = useCallback(
    async (refreshCustomers = true) => {
      if (posSyncInFlightRef.current) return null;
      posSyncInFlightRef.current = true;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user.id;
        if (!userId) return null;
        let cached: Awaited<ReturnType<typeof readPosSearchCache>> = null;
        try {
          cached = await readPosSearchCache(userId);
        } catch {
          // IndexedDB is an optional offline/instant-search layer.
        }
        const cachedProducts = queryClient.getQueryData<Product[]>([
          "pos-products",
          userId,
        ]);
        const cachedLists = queryClient.getQueryData<PriceList[]>([
          "active-price-lists",
          userId,
        ]);
        if (cachedProducts) setProducts(cachedProducts);
        else if (cached) setProducts(cached.products);
        if (cachedLists) setPriceLists(cachedLists);
        else if (cached) setPriceLists(cached.priceLists);

        const customersSavedAt =
          cached?.customersSavedAt ?? cached?.savedAt ?? 0;
        const shouldRefreshCustomers =
          refreshCustomers &&
          (!cached ||
            !customersSavedAt ||
            Date.now() - customersSavedAt >= QUERY_STALE_TIME);
        const loadAllProducts = async () => {
          const all: Product[] = [];
          for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabase
              .from("products")
              .select(
                "id,sku,name,unit,stock,kind,is_active,product_prices(price,price_list_id)",
              )
              .eq("is_active", true)
              .order("name")
              .range(offset, offset + 499);
            if (error) throw error;
            const batch = (data ?? []) as unknown as Product[];
            all.push(...batch);
            if (batch.length < 500)
              return attachProductBundleItems(supabase, all);
          }
        };
        const [nextProducts, nextLists] = await Promise.all([
          fetchCachedQuery(
            queryClient,
            supabase,
            ["pos-products"],
            loadAllProducts,
          ),
          fetchCachedQuery(
            queryClient,
            supabase,
            ["active-price-lists"],
            async () => {
              const result = await supabase
                .from("price_lists")
                .select("id,name,is_default,is_active")
                .eq("is_active", true)
                .order("name");
              if (result.error) throw result.error;
              return result.data;
            },
          ),
        ]);
        const nextListsTyped = (nextLists ?? []) as PriceList[];
        setProducts(nextProducts);
        setPriceLists(nextListsTyped);
        let customersSynced = true;
        try {
          await syncPosSearchData(
            supabase,
            userId,
            nextProducts,
            nextListsTyped,
            shouldRefreshCustomers,
          );
        } catch {
          customersSynced = false;
          setNotice("Hàng hóa đã cập nhật; danh bạ khách chưa đồng bộ được.");
        }
        lastPosSyncRef.current = Date.now();
        if (customersSynced) setNotice("");
        return nextProducts;
      } catch {
        lastPosSyncRef.current = Date.now();
        setNotice(
          "Không thể đồng bộ dữ liệu POS. Dữ liệu đã lưu tiếp tục khả dụng.",
        );
        return null;
      } finally {
        posSyncInFlightRef.current = false;
      }
    },
    [queryClient, supabase],
  );

  useEffect(() => {
    let currentUserId: string | null = null;
    void supabase.auth
      .getSession()
      .then((result: { data: { session: Session | null } }) => {
        currentUserId = result.data.session?.user.id ?? null;
      });
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent) => {
        if (event !== "SIGNED_OUT" || !currentUserId) return;
        void clearPosSearchCache(currentUserId).catch(() => undefined);
        currentUserId = null;
      },
    );
    let refreshTimer = 0;
    const refresh = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      if (Date.now() - lastPosSyncRef.current < 60_000) return;
      void load();
    };
    const scheduleRefresh = (refreshCustomers = true) => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        lastPosSyncRef.current = 0;
        if (document.visibilityState !== "hidden" && navigator.onLine)
          void load(refreshCustomers);
      }, 800);
    };
    void load();
    const interval = window.setInterval(refresh, 120_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const channel =
      process.env.NEXT_PUBLIC_DESKTOP_BUILD === "true"
        ? null
        : supabase
            .channel("pos-search-sync")
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "products" },
              () => scheduleRefresh(false),
            )
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "product_prices" },
              () => scheduleRefresh(false),
            )
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "product_bundle_items" },
              () => scheduleRefresh(false),
            )
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "price_lists" },
              () => scheduleRefresh(false),
            )
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "customers" },
              scheduleRefresh,
            )
            .subscribe();
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(refreshTimer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      if (channel) void supabase.removeChannel(channel);
      authListener.subscription.unsubscribe();
    };
  }, [load, supabase]);

  useEffect(() => {
    if (!orderTabsReady || listId || !priceLists.length) return;
    const defaultListId =
      priceLists.find((item) => item.is_default)?.id || priceLists[0].id;
    setSaleValue("listId", defaultListId);
  }, [orderTabsReady, listId, priceLists, setSaleValue]);
  const filtered = useMemo(() => {
    return searchProductsLocally(products, query);
  }, [products, query]);
  const rawSubtotal = cart.reduce(
    (sum, item) => sum + Math.round(item.price * item.quantity),
    0,
  );
  const validDiscount = Math.max(
    0,
    Math.min(rawSubtotal, Math.round(Number(discount) || 0)),
  );
  const { subtotal, total } = calculateTotals(cart, validDiscount);
  const totalQuantity = cart.reduce((sum, line) => sum + line.quantity, 0);

  const updateCart = useCallback(
    (updater: (current: CartLine[]) => CartLine[]) => {
      setSaleValue("cart", updater(getSaleValue("cart")), {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [getSaleValue, setSaleValue],
  );

  function addProduct(product: Product) {
    if (!hasSellableBundleItems(product)) {
      setNotice(
        `Combo "${product.name}" chưa có hàng hóa thành phần khả dụng.`,
      );
      return;
    }
    const price = product.product_prices?.find(
      (item) => item.price_list_id === listId,
    )?.price;
    if (price === undefined) {
      setNotice(
        '"' +
          product.name +
          '" chưa được thiết lập giá trong bảng giá đã chọn.',
      );
      return;
    }
    updateCart((current) => {
      const present = current.find((line) => line.product.id === product.id);
      return present
        ? current.map((line) =>
            line.product.id === product.id
              ? {
                  ...line,
                  quantity:
                    Math.round((line.quantity + 1) * DECIMAL_SCALE) /
                    DECIMAL_SCALE,
                }
              : line,
          )
        : [{ product, quantity: 1, price }, ...current];
    });
    setQuery("");
    setNotice("");
    setRetryKey(null);
  }
  function setQuantity(id: string, quantity: number) {
    const next = Number.isFinite(quantity)
      ? Math.max(0, Math.round(quantity * DECIMAL_SCALE) / DECIMAL_SCALE)
      : 0;
    updateCart((current) =>
      current.map((line) =>
        line.product.id === id ? { ...line, quantity: next } : line,
      ),
    );
    setRetryKey(null);
  }
  function setPrice(id: string, price: number) {
    const next = Number.isFinite(price)
      ? Math.round(Math.max(0, price) * 100) / 100
      : 0;
    updateCart((current) =>
      current.map((line) =>
        line.product.id === id ? { ...line, price: next } : line,
      ),
    );
    setRetryKey(null);
  }
  function removeProduct(id: string) {
    updateCart((current) => current.filter((line) => line.product.id !== id));
    setRetryKey(null);
  }
  const moveCartItem = useCallback(
    (sourceId: string, targetId: string, edge: "before" | "after") => {
      updateCart((current) => {
        const next = [...current];
        const from = next.findIndex((line) => line.product.id === sourceId);
        if (from < 0) return current;
        const [moved] = next.splice(from, 1);
        const target = next.findIndex((line) => line.product.id === targetId);
        if (target < 0) return current;
        next.splice(target + (edge === "after" ? 1 : 0), 0, moved);
        return next;
      });
    },
    [updateCart],
  );
  function changeList(id: string) {
    setSaleValue("listId", id, { shouldDirty: true });
    updateCart((current) =>
      current.map((line) => ({
        ...line,
        price:
          line.product.product_prices?.find((item) => item.price_list_id === id)
            ?.price ?? 0,
      })),
    );
    setRetryKey(null);
  }
  const draft: Receipt = {
    order_no: "TẠM TÍNH",
    customer_name: customer.trim() || "Khách lẻ",
    customer_phone: customerPhone.trim(),
    customer_address: customerAddress.trim(),
    note: note.trim(),
    price_list_name: priceLists.find((item) => item.id === listId)?.name || "",
    subtotal,
    discount: validDiscount,
    total,
    created_at: formatDateTime(new Date()),
    items: cart,
  };
  const printableReceipt = receipt || draft;

  async function pay(values: SaleFormValues) {
    if (values.cart.length === 0 || busy) return;
    if (
      values.cart.some(
        (line) =>
          !Number.isFinite(line.quantity) ||
          line.quantity < 0 ||
          line.quantity > 100000000 ||
          !Number.isFinite(line.price) ||
          line.price < 0,
      )
    ) {
      setNotice("Số lượng hoặc đơn giá không hợp lệ.");
      return;
    }
    const checkoutCart = values.cart.filter((line) => line.quantity > 0);
    if (checkoutCart.length === 0) {
      setNotice("Vui lòng nhập số lượng lớn hơn 0 cho ít nhất một sản phẩm.");
      return;
    }
    const valuesSubtotal = values.cart.reduce(
      (sum, item) => sum + Math.round(item.price * item.quantity),
      0,
    );
    const valuesDiscount = Math.max(
      0,
      Math.min(valuesSubtotal, Math.round(Number(values.discount) || 0)),
    );
    const valuesTotals = calculateTotals(values.cart, valuesDiscount);
    if (
      Number(values.discount) < 0 ||
      Number(values.discount) > valuesTotals.subtotal
    ) {
      setNotice("Giảm giá phải từ 0 đến tổng tiền hàng.");
      return;
    }
    setBusy(true);
    setNotice("");
    const attemptKey = retryKey || crypto.randomUUID();
    setRetryKey(attemptKey);
    const expected: Receipt = {
      order_no: "",
      customer_name: values.customer.trim() || "Khách lẻ",
      customer_phone: values.customerPhone.trim(),
      customer_address: values.customerAddress.trim(),
      note: values.note.trim(),
      price_list_name:
        priceLists.find((item) => item.id === values.listId)?.name || "",
      subtotal: valuesTotals.subtotal,
      discount: valuesDiscount,
      total: valuesTotals.total,
      created_at: formatDateTime(new Date()),
      items: checkoutCart,
    };
    setTabActivityBusy(true);
    let data: unknown;
    let error: { message: string } | null = null;
    try {
      const response = await supabase.rpc("checkout_order", {
        p_idempotency_key: attemptKey,
        p_price_list_id: values.listId,
        p_customer_name: values.customer,
        p_discount: valuesDiscount,
        p_customer_phone: values.customerPhone,
        p_customer_address: values.customerAddress,
        p_note: values.note.trim(),
        p_lines: checkoutCart.map((line) => ({
          product_id: line.product.id,
          quantity: line.quantity,
          expected_price:
            line.product.product_prices?.find(
              (item) => item.price_list_id === values.listId,
            )?.price ?? line.price,
          unit_price: line.price,
        })),
      });
      data = response.data;
      error = response.error;
    } catch (caught) {
      error = {
        message:
          caught instanceof Error
            ? caught.message
            : "Không thể kết nối để thanh toán.",
      };
    }
    setBusy(false);
    setTabActivityBusy(false);
    if (error) {
      const stale = /giá.*thay đổi/i.test(error.message);
      setNotice(
        stale
          ? error.message +
              ". Giá đã được tải mới; vui lòng kiểm tra lại rồi thanh toán."
          : error.message.replace(/^Error: /, ""),
      );
      if (stale) {
        setRetryKey(null);
        await queryClient.invalidateQueries({ queryKey: ["pos-products"] });
        const fresh = await load();
        if (fresh)
          updateCart((current) =>
            current.map((line) => {
              const product = fresh.find((item) => item.id === line.product.id);
              return product
                ? {
                    ...line,
                    product,
                    price:
                      product.product_prices?.find(
                        (item) => item.price_list_id === values.listId,
                      )?.price ?? 0,
                  }
                : line;
            }),
          );
      }
      return;
    }
    const result = data as { order_no: string; total: number };
    setDraftPrint(false);
    setReceipt({
      ...expected,
      order_no: result.order_no,
      total: Number(result.total),
    });
    const clearedOrder = {
      listId: values.listId,
      customer: "",
      customerPhone: "",
      customerAddress: "",
      note: "",
      discount: 0,
      cart: [],
    };
    resetSaleForm(clearedOrder);
    updateOrder(activeOrderId, clearedOrder);
    setQuery("");
    setDiscountInputVersion((version) => version + 1);
    setRetryKey(null);
    toast.success("Thanh toán thành công · " + result.order_no);
    window.setTimeout(printPage, 300);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pos-products"] }),
      queryClient.invalidateQueries({ queryKey: ["purchase-products"] }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["orders"] }),
      queryClient.invalidateQueries({ queryKey: ["orders-summary"] }),
      queryClient.invalidateQueries({
        queryKey: ["product-inventory-history"],
      }),
      queryClient.invalidateQueries({ queryKey: ["product-sales-summary"] }),
    ]);
    await load();
  }

  function printDraft() {
    const values = getSaleValue();
    const draftCart = values.cart.filter((line) => line.quantity > 0);
    if (!draftCart.length) {
      setNotice("Vui lòng nhập số lượng lớn hơn 0 cho ít nhất một sản phẩm.");
      return;
    }

    const subtotal = draftCart.reduce(
      (sum, line) => sum + Math.round(line.price * line.quantity),
      0,
    );
    const discount = Math.max(
      0,
      Math.min(subtotal, Math.round(Number(values.discount) || 0)),
    );
    setReceipt({
      order_no: "NHÁP",
      customer_name: values.customer.trim() || "Khách lẻ",
      customer_phone: values.customerPhone.trim(),
      customer_address: values.customerAddress.trim(),
      note: values.note.trim(),
      price_list_name:
        priceLists.find((item) => item.id === values.listId)?.name || "",
      subtotal,
      discount,
      total: calculateTotals(draftCart, discount).total,
      created_at: formatDateTime(new Date()),
      items: draftCart,
    });
    setDraftPrint(true);
    window.setTimeout(printPage, 300);
  }

  const submitPayment = handleSaleSubmit(pay);
  const payRef = useRef(submitPayment);
  useEffect(() => {
    payRef.current = submitPayment;
  }, [submitPayment]);
  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.key === "F1") {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
          return;
        event.preventDefault();
        if (event.repeat || !orderTabsReady) return;
        createOrder();
      } else if (event.key === "F3") {
        event.preventDefault();
        productSearchRef.current?.focus();
        productSearchRef.current?.select();
      } else if (event.key === "F4") {
        event.preventDefault();
        customerInputRef.current?.focus();
        customerInputRef.current?.select();
      } else if (event.key === "F9") {
        event.preventDefault();
        void payRef.current();
      }
    }
    window.addEventListener("keydown", onShortcut, true);
    return () => window.removeEventListener("keydown", onShortcut, true);
  }, [createOrder, orderTabsReady]);

  if (!orderTabsReady) {
    return (
      <div className="pos-screen no-print" aria-busy="true">
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  return (
    <>
      <div
        id="pos-order-panel"
        ref={posScreenRef}
        role="tabpanel"
        aria-labelledby={`pos-order-tab-${activeOrderId}`}
        className="pos-screen no-print"
      >
        <section className="pos-left">
          <SearchInputField
            className="pos-search-field"
            ref={productSearchRef}
            autoFocus
            aria-keyshortcuts="F3"
            placeholder="Nhập tên hoặc mã hàng hóa · F3"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setActiveProductIndex(0);
            }}
            onClear={() => {
              setQuery("");
              setActiveProductIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && filtered.length) {
                e.preventDefault();
                setActiveProductIndex((index) => (index + 1) % filtered.length);
              }
              if (e.key === "ArrowUp" && filtered.length) {
                e.preventDefault();
                setActiveProductIndex(
                  (index) => (index - 1 + filtered.length) % filtered.length,
                );
              }
              if (e.key === "Enter" && filtered[activeProductIndex]) {
                e.preventDefault();
                addProduct(filtered[activeProductIndex]);
              }
              if (e.key === "Escape") setQuery("");
            }}
          />
          {query && (
            <div
              className="pos-search-results"
              role="listbox"
              aria-label="Hàng hóa phù hợp"
            >
              {filtered.length === 0 ? (
                <div className="muted" style={{ padding: 12, fontSize: 13 }}>
                  Không tìm thấy hàng phù hợp.
                </div>
              ) : (
                filtered.map((product, index) => {
                  const price = product.product_prices?.find(
                    (item) => item.price_list_id === listId,
                  )?.price;
                  return (
                    <AppButton
                      key={product.id}
                      variant="ghost"
                      type="button"
                      role="option"
                      className={
                        index === activeProductIndex
                          ? " search-option-active"
                          : ""
                      }
                      aria-selected={index === activeProductIndex}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        minHeight: 58,
                        textAlign: "left",
                      }}
                      onMouseEnter={() => setActiveProductIndex(index)}
                      onClick={() => addProduct(product)}
                    >
                      <span style={{ minWidth: 0 }}>
                        <b>{product.name}</b>
                        <span className="muted" style={{ marginLeft: 9 }}>
                          {product.sku}
                        </span>
                        <small
                          className="muted"
                          style={{ display: "block", marginTop: 4 }}
                        >
                          Tồn: {formatQuantity(product.stock)} {product.unit}
                        </small>
                      </span>
                      <span>
                        {price === undefined ? "Chưa có giá" : formatVnd(price)}
                      </span>
                    </AppButton>
                  );
                })
              )}
            </div>
          )}
          <div className="pos-lines">
            {cart.length === 0 ? (
              <div
                className="muted"
                style={{ textAlign: "center", paddingTop: 72 }}
              >
                Tìm hàng hóa để bắt đầu đơn hàng
              </div>
            ) : (
              cart.map((line, index) => (
                <PosCartLine
                  key={line.product.id}
                  line={line}
                  index={index}
                  onMove={moveCartItem}
                  onQuantity={setQuantity}
                  canEditPrice={canEditPrice}
                  onPrice={setPrice}
                  onRemove={removeProduct}
                />
              ))
            )}
          </div>
          <div className="card pos-bottom">
            <AppTextarea
              noBorder
              className="pos-order-note"
              aria-label="Ghi chú đơn hàng"
              placeholder="Ghi chú đơn hàng"
              rows={1}
              maxLength={2000}
              disabled={busy}
              value={note}
              onChange={(event) => {
                setSaleValue("note", event.target.value);
                setRetryKey(null);
              }}
            />
            <span style={{ marginLeft: "auto" }}>
              {cart.length} dòng · {formatQuantity(totalQuantity)} sản phẩm
            </span>
          </div>
        </section>
        <form
          className={mergeClassNames(
            "pos-panel",
            mobilePanelOpen && "mobile-pos-panel-open",
          )}
          aria-label={activeOrder.name}
          onSubmit={submitPayment}
          onTouchStart={(event) => {
            const target = event.target as HTMLElement;
            panelTouchStartRef.current = {
              y: event.touches[0]?.clientY ?? 0,
              onHeader: Boolean(target.closest(".pos-panel-top")),
            };
          }}
          onTouchEnd={(event) => {
            const start = panelTouchStartRef.current;
            panelTouchStartRef.current = null;
            if (!start) return;
            const deltaY =
              (event.changedTouches[0]?.clientY ?? start.y) - start.y;
            if (
              deltaY > 70 &&
              isMobileRoute &&
              isMobileViewport &&
              mobilePanelOpen &&
              (start.onHeader || event.currentTarget.scrollTop === 0)
            ) {
              event.preventDefault();
              setMobilePanelOpen(false);
            }
          }}
        >
          <AppButton
            variant="ghost"
            className="pos-panel-top"
            type="button"
            disabled={!isMobileRoute || !isMobileViewport}
            aria-expanded={
              isMobileRoute && isMobileViewport ? mobilePanelOpen : undefined
            }
            aria-label={mobilePanelOpen ? "Thu gọn đơn hàng" : "Mở đơn hàng"}
            onClick={() => setMobilePanelOpen((current) => !current)}
          >
            <span className="muted" style={{ fontSize: 12 }}>
              {activeOrder.name.toLocaleUpperCase("vi-VN")}
            </span>
            <span className="badge">{cart.length} dòng</span>
          </AppButton>
          <Controller
            control={saleFormControl}
            name="customer"
            render={({ field }) => (
              <CustomerPicker
                compact
                inputRef={customerInputRef}
                placeholder="Tìm theo tên, sđt, địa chỉ"
                value={{
                  name: field.value,
                  phone: customerPhone,
                  address: customerAddress,
                }}
                disabled={busy}
                onChange={(value) => {
                  field.onChange(value.name);
                  setSaleValue("customerPhone", value.phone);
                  setSaleValue("customerAddress", value.address);
                  setRetryKey(null);
                }}
              />
            )}
          />
          <div className="form-label">
            <label htmlFor="pos-price-list">Bảng giá</label>
            <Controller
              control={saleFormControl}
              name="listId"
              rules={{ required: true }}
              render={({ field }) => (
                <AppSelect
                  id="pos-price-list"
                  ariaLabel="Bảng giá"
                  value={field.value}
                  isDisabled={!priceLists.length}
                  options={priceLists.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  onChange={changeList}
                />
              )}
            />
          </div>
          {!listId && (
            <div className="alert" style={{ marginTop: 10 }}>
              Chưa có bảng giá đang hoạt động. Hãy tạo bảng giá trong phần quản
              lý.
            </div>
          )}
          <div className="pos-summary">
            <div className="summary-row">
              <span>Tổng tiền hàng</span>
              <b>{formatVnd(subtotal)}</b>
            </div>
            <div className="summary-row">
              <label htmlFor="discount">Giảm giá</label>
              <Controller
                control={saleFormControl}
                name="discount"
                rules={{ required: true, min: 0 }}
                render={({ field }) => (
                  <NumberInputField
                    key={discountInputVersion}
                    id="discount"
                    className="field pos-discount-input"
                    min={0}
                    step={1000}
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(Number(value));
                      setRetryKey(null);
                    }}
                  />
                )}
              />
            </div>
            <div className="summary-row summary-payable">
              <span>Khách cần trả</span>
              <strong className="summary-total">{formatVnd(total)}</strong>
            </div>
          </div>
          {cart.some((line) => line.quantity > line.product.stock) && (
            <div className="notice" style={{ marginTop: 13 }}>
              Có sản phẩm vượt tồn kho. Đơn vẫn có thể thanh toán và tồn sẽ âm.
            </div>
          )}
          {notice && (
            <div className="alert" style={{ marginTop: 13 }}>
              {notice}
            </div>
          )}
          <div className="pos-actions">
            <AppButton
              variant="secondary"
              type="button"
              className="btn-draft-print"
              onClick={printDraft}
              disabled={!cart.length || busy || !listId}
            >
              IN
            </AppButton>
            <AppButton
              variant="primary"
              type="submit"
              className="btn-pay"
              aria-keyshortcuts="F9"
              title="Thanh toán và tự in hóa đơn · F9"
              disabled={!cart.length || busy || !listId}
            >
              {busy ? "ĐANG LƯU…" : "THANH TOÁN"}
            </AppButton>
          </div>
        </form>
      </div>

      <ReceiptPrint
        receipt={printableReceipt}
        isDraft={draftPrint}
        items={printableReceipt.items.map((line) => ({
          key: line.product.id,
          name: line.product.name,
          unit: line.product.unit,
          quantity: line.quantity,
          unitPrice: line.price,
          lineTotal: line.price * line.quantity,
        }))}
      />
      {receipt && (
        <ModalLayer
          className="modal-backdrop no-print"
          onEscape={() => setReceipt(null)}
          onClick={() => setReceipt(null)}
        >
          <div
            className="modal card"
            style={{ width: 390, textAlign: "center" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="badge badge-green"
              style={{ margin: "2px auto 14px" }}
            >
              Đã thanh toán
            </div>
            <h2 style={{ margin: "0 0 5px" }}>Đơn hàng {receipt.order_no}</h2>
            <p className="muted" style={{ margin: "0 0 18px", fontSize: 13 }}>
              Tổng tiền {formatVnd(receipt.total)}
            </p>
            <div className="form-actions" style={{ justifyContent: "center" }}>
              <AppButton
                variant="secondary"

                onClick={() => setReceipt(null)}
              >
                Đóng
              </AppButton>
              <AppButton
                variant="primary"
                className="btn-print"
                aria-label="In hóa đơn"
                onClick={printPage}
              >
                In hóa đơn
              </AppButton>
            </div>
          </div>
        </ModalLayer>
      )}
    </>
  );
}
