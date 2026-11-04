import { MAX_DECIMAL_PLACES } from "@/lib/constants";

export function formatVnd(value = 0) {
  return (
    new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(
      Math.round(value),
    ) + " ₫"
  );
}

export function formatQuantity(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: MAX_DECIMAL_PLACES,
  }).format(value);
}

export function todayLocal() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(now);
}

