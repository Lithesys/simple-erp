import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import "dayjs/locale/vi";

export const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

dayjs.extend(utc);
dayjs.extend(timezone);

function parseAppDate(value: string | Date) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? dayjs.tz(value, "YYYY-MM-DD", APP_TIME_ZONE)
    : dayjs(value).tz(APP_TIME_ZONE);
}

export function formatDate(value: string | Date | null | undefined) {
  return value ? parseAppDate(value).format("DD/MM/YYYY") : "—";
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";

  return parseAppDate(value).format("DD/MM/YYYY HH:mm");
}

export function formatDateTimeLocal(value: string | Date) {
  return dayjs(value).tz(APP_TIME_ZONE).format("YYYY-MM-DDTHH:mm");
}

export function dateTimeLocalToIso(value: string) {
  return dayjs.tz(value, "YYYY-MM-DDTHH:mm", APP_TIME_ZONE).toISOString();
}
