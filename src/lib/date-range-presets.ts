import { APP_TIME_ZONE } from "./date";

export type DateRangePreset = {
  label: string;
  start: string;
  end: string;
};

type LunarYearRanges = {
  current: { start: string; end: string };
  previous: { start: string; end: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LUNAR_DATE_FORMATTER = new Intl.DateTimeFormat("en-u-ca-chinese", {
  timeZone: APP_TIME_ZONE,
  month: "numeric",
  day: "numeric",
});
let cachedLunarYearRanges: {
  date: string;
  ranges: LunarYearRanges;
} | null = null;

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function fromIsoDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function getToday(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function getLunarNewYearStarts(today: string) {
  const todayDate = fromIsoDate(today);
  const starts: Date[] = [];

  for (let offset = -740; offset <= 370; offset += 1) {
    const date = addDays(todayDate, offset);
    const parts = LUNAR_DATE_FORMATTER.formatToParts(date);
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (month === "1" && day === "1") starts.push(date);
  }

  return starts;
}

function getLunarYearRanges(today: string): LunarYearRanges {
  if (cachedLunarYearRanges?.date === today) {
    return cachedLunarYearRanges.ranges;
  }

  const starts = getLunarNewYearStarts(today);
  const todayDate = fromIsoDate(today);
  const currentIndex = starts.findLastIndex((date) => date <= todayDate);
  const previousStart = starts[currentIndex - 1];
  const currentStart = starts[currentIndex];
  const nextStart = starts[currentIndex + 1];

  if (!previousStart || !currentStart || !nextStart) {
    throw new Error("Could not determine lunar year boundaries.");
  }

  const ranges = {
    current: {
      start: toIsoDate(currentStart),
      end: toIsoDate(addDays(nextStart, -1)),
    },
    previous: {
      start: toIsoDate(previousStart),
      end: toIsoDate(addDays(currentStart, -1)),
    },
  };
  cachedLunarYearRanges = { date: today, ranges };
  return ranges;
}

export function getDateRangePresets(now = new Date()): DateRangePreset[] {
  const today = getToday(now);
  const todayDate = fromIsoDate(today);
  const weekday = todayDate.getUTCDay();
  const weekStart = addDays(todayDate, -((weekday + 6) % 7));
  const monthStart = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(todayDate.getUTCFullYear(), 0, 1));
  const previousYearEnd = addDays(yearStart, -1);
  const previousYearStart = new Date(Date.UTC(previousYearEnd.getUTCFullYear(), 0, 1));
  const lunarYears = getLunarYearRanges(today);

  return [
    { label: "Hôm nay", start: today, end: today },
    {
      label: "Hôm qua",
      start: toIsoDate(addDays(todayDate, -1)),
      end: toIsoDate(addDays(todayDate, -1)),
    },
    { label: "Tuần này", start: toIsoDate(weekStart), end: today },
    { label: "Tháng này", start: toIsoDate(monthStart), end: today },
    {
      label: "Năm này (dương lịch)",
      start: toIsoDate(yearStart),
      end: today,
    },
    {
      label: "Năm này (âm lịch)",
      ...lunarYears.current,
    },
    {
      label: "Năm trước (dương lịch)",
      start: toIsoDate(previousYearStart),
      end: toIsoDate(previousYearEnd),
    },
    {
      label: "Năm trước (âm lịch)",
      ...lunarYears.previous,
    },
  ];
}
