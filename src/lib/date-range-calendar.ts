type ClickDate = (event: Pick<Event, "target" | "stopPropagation">) => void;

export function selectAvailableDateCell(
  target: EventTarget | null,
  calendarElement: Pick<HTMLElement, "contains">,
  clickDate: ClickDate,
  stopPropagation: () => void,
): boolean {
  if (!target || typeof (target as Element).closest !== "function") {
    return false;
  }

  const dateCell = (target as Element).closest("td.available");
  if (!dateCell || !calendarElement.contains(dateCell)) return false;

  clickDate({ target: dateCell, stopPropagation });
  return true;
}
