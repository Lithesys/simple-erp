"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/data/client";
import type { CartLine } from "@/lib/types";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

export type PosOrderValues = {
  listId: string;
  customerId: string;
  customer: string;
  customerPhone: string;
  customerAddress: string;
  note: string;
  discount: number;
  cart: CartLine[];
};

export type PosOrderDraft = PosOrderValues & {
  id: string;
  name: string;
};

type SavedOrders = {
  version: 1;
  activeOrderId: string;
  nextOrderNumber: number;
  orders: PosOrderDraft[];
};

type OrderState = Omit<SavedOrders, "version">;

type PosOrderTabsContextValue = {
  orders: PosOrderDraft[];
  activeOrder: PosOrderDraft;
  activeOrderId: string;
  nextOrderNumber: number;
  transitionDirection: "left" | "right";
  isReady: boolean;
  isBusy: boolean;
  setTabActivityBusy: (busy: boolean) => void;
  activateOrder: (id: string) => void;
  createOrder: () => void;
  closeOrder: (id: string) => void;
  updateOrder: (id: string, values: PosOrderValues) => void;
};

const STORAGE_PREFIX = "lan-duy-linh:pos-orders:v1:";

const PosOrderTabsContext = createContext<PosOrderTabsContextValue | null>(null);

function createInitialOrderState(): OrderState {
  const firstOrder: PosOrderDraft = {
    id: "draft-1",
    name: "Hóa đơn 1",
    listId: "",
    customerId: "",
    customer: "",
    customerPhone: "",
    customerAddress: "",
    note: "",
    discount: 0,
    cart: [],
  };

  return {
    activeOrderId: firstOrder.id,
    nextOrderNumber: 2,
    orders: [firstOrder],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCartLine(value: unknown): value is CartLine {
  if (!isRecord(value) || !isRecord(value.product)) return false;
  return (
    typeof value.product.id === "string" &&
    typeof value.product.name === "string" &&
    typeof value.product.sku === "string" &&
    typeof value.product.unit === "string" &&
    typeof value.product.stock === "number" &&
    Array.isArray(value.product.product_prices) &&
    value.product.product_prices.every(
      (item) =>
        isRecord(item) &&
        typeof item.price_list_id === "string" &&
        typeof item.price === "number",
    ) &&
    typeof value.quantity === "number" &&
    Number.isFinite(value.quantity) &&
    value.quantity > 0 &&
    typeof value.price === "number" &&
    Number.isFinite(value.price) &&
    value.price >= 0
  );
}

function parseOrder(value: unknown): PosOrderDraft | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string")
    return null;

  return {
    id: value.id,
    name: value.name,
    listId: typeof value.listId === "string" ? value.listId : "",
    customerId: typeof value.customerId === "string" ? value.customerId : "",
    customer: typeof value.customer === "string" ? value.customer : "",
    customerPhone:
      typeof value.customerPhone === "string" ? value.customerPhone : "",
    customerAddress:
      typeof value.customerAddress === "string" ? value.customerAddress : "",
    note: typeof value.note === "string" ? value.note : "",
    discount:
      typeof value.discount === "number" && Number.isFinite(value.discount)
        ? Math.max(0, value.discount)
        : 0,
    cart: Array.isArray(value.cart) ? value.cart.filter(isCartLine) : [],
  };
}

function readSavedOrders(userId: string): OrderState {
  try {
    const saved = window.localStorage.getItem(STORAGE_PREFIX + userId);
    if (!saved) return createInitialOrderState();

    const parsed: unknown = JSON.parse(saved);
    if (!isRecord(parsed) || parsed.version !== 1) {
      return createInitialOrderState();
    }

    const orders = Array.isArray(parsed.orders)
      ? parsed.orders.map(parseOrder).filter((order) => order !== null)
      : [];
    if (!orders.length) return createInitialOrderState();

    const maxOrderNumber = orders.reduce((max, order) => {
      const number = Number(order.name.match(/\d+$/)?.[0] || 0);
      return Math.max(max, number);
    }, 0);
    const requestedNextNumber =
      typeof parsed.nextOrderNumber === "number" &&
      Number.isFinite(parsed.nextOrderNumber)
        ? parsed.nextOrderNumber
        : 1;

    return {
      orders,
      activeOrderId: orders.some((order) => order.id === parsed.activeOrderId)
        ? (parsed.activeOrderId as string)
        : orders[0].id,
      nextOrderNumber: Math.max(1, Math.ceil(requestedNextNumber), maxOrderNumber + 1),
    };
  } catch {
    return createInitialOrderState();
  }
}

export function PosOrderTabsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrderState>(createInitialOrderState);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<
    "left" | "right"
  >("right");
  const initializedUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const hydrateUser = (userId: string | null) => {
      if (!mounted || initializedUserIdRef.current === userId) return;
      initializedUserIdRef.current = userId;
      setIsReady(false);
      setOwnerId(userId);
      setState(userId ? readSavedOrders(userId) : createInitialOrderState());
      setBusy(false);
      setIsReady(true);
    };

    const { data } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        hydrateUser(session?.user.id ?? null);
      },
    );
    void supabase.auth
      .getSession()
      .then((result: { data: { session: Session | null } }) => {
        hydrateUser(result.data.session?.user.id ?? null);
      });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isReady || !ownerId) return;

    const timer = window.setTimeout(() => {
      const saved: SavedOrders = { version: 1, ...state };
      try {
        window.localStorage.setItem(
          STORAGE_PREFIX + ownerId,
          JSON.stringify(saved),
        );
      } catch {
        // Drafts remain usable in memory if browser storage is unavailable.
      }
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [isReady, ownerId, state]);

  const activeOrder =
    state.orders.find((order) => order.id === state.activeOrderId) ||
    state.orders[0];

  const activateOrder = useCallback(
    (id: string) => {
      if (isBusy || id === state.activeOrderId) return;
      const oldIndex = state.orders.findIndex(
        (order) => order.id === state.activeOrderId,
      );
      const nextIndex = state.orders.findIndex((order) => order.id === id);
      if (nextIndex < 0) return;

      setTransitionDirection(nextIndex > oldIndex ? "right" : "left");
      setState((current) => ({ ...current, activeOrderId: id }));
    },
    [isBusy, state.activeOrderId, state.orders],
  );

  const createOrder = useCallback(() => {
    if (isBusy) return;
    const orderNumber = state.nextOrderNumber;
    const order: PosOrderDraft = {
      ...createInitialOrderState().orders[0],
      id: crypto.randomUUID(),
      name: `Hóa đơn ${orderNumber}`,
    };
    setTransitionDirection("right");
    setState((current) => ({
      orders: [...current.orders, order],
      activeOrderId: order.id,
      nextOrderNumber: Math.max(current.nextOrderNumber, orderNumber + 1),
    }));
  }, [isBusy, state.nextOrderNumber]);

  const closeOrder = useCallback(
    (id: string) => {
      if (isBusy || state.orders.length <= 1) return;
      const closingIndex = state.orders.findIndex((order) => order.id === id);
      if (closingIndex < 0) return;
      if (state.activeOrderId === id) {
        setTransitionDirection(
          closingIndex < state.orders.length - 1 ? "right" : "left",
        );
      }

      setState((current) => {
        const orders = current.orders.filter((order) => order.id !== id);
        if (current.activeOrderId !== id) return { ...current, orders };

        const nextActiveIndex = Math.min(closingIndex, orders.length - 1);
        return {
          ...current,
          orders,
          activeOrderId: orders[nextActiveIndex].id,
        };
      });
    },
    [isBusy, state.orders, state.activeOrderId],
  );

  const updateOrder = useCallback(
    (id: string, values: PosOrderValues) => {
      setState((current) => {
        const index = current.orders.findIndex((order) => order.id === id);
        if (index < 0) return current;
        const orders = [...current.orders];
        orders[index] = { ...orders[index], ...values };
        return { ...current, orders };
      });
    },
    [],
  );

  const value = useMemo<PosOrderTabsContextValue>(
    () => ({
      orders: state.orders,
      activeOrder,
      activeOrderId: state.activeOrderId,
      nextOrderNumber: state.nextOrderNumber,
      transitionDirection,
      isReady,
      isBusy,
      setTabActivityBusy: setBusy,
      activateOrder,
      createOrder,
      closeOrder,
      updateOrder,
    }),
    [
      state.orders,
      activeOrder,
      state.activeOrderId,
      state.nextOrderNumber,
      transitionDirection,
      isReady,
      isBusy,
      activateOrder,
      createOrder,
      closeOrder,
      updateOrder,
    ],
  );

  return (
    <PosOrderTabsContext.Provider value={value}>
      {children}
    </PosOrderTabsContext.Provider>
  );
}

export function usePosOrderTabs() {
  const context = useContext(PosOrderTabsContext);
  if (!context) {
    throw new Error("usePosOrderTabs must be used within PosOrderTabsProvider");
  }
  return context;
}
