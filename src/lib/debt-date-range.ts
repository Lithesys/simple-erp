export type DateRange = { from: string; to: string };

export function currentMonthDateRange(
  referenceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date()),
): DateRange {
  const [year, month] = referenceDate.slice(0, 7).split("-");
  const lastDay = new Date(
    Date.UTC(Number(year), Number(month), 0),
  ).getUTCDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}
