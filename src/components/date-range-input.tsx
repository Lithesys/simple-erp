"use client";

import { AppInput } from "@/components/app-input";
import { selectAvailableDateCell } from "@/lib/date-range-calendar";

import { useEffect, useRef, useState } from "react";
import { todayLocal } from "@/lib/format";
import { getDateRangePresets } from "@/lib/date-range-presets";

type DateRangeInputProps = {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
};

type MomentValue = { format: (template: string) => string };
type MomentFactory = {
  (value: string, format: string): MomentValue;
  locale: (locale: string) => string;
};
type DateRangePickerInstance = {
  startDate: MomentValue;
  endDate: MomentValue;
  container?: { 0: HTMLElement };
  clickDate?: (event: Pick<Event, "target" | "stopPropagation">) => void;
  show?: () => void;
  remove?: () => void;
  setStartDate?: (date: MomentValue) => void;
  setEndDate?: (date: MomentValue) => void;
};

type JQueryPluginInput = {
  daterangepicker: (options: Record<string, unknown>) => void;
  on: (
    events: string,
    callback: (event: unknown, picker: DateRangePickerInstance) => void,
  ) => void;
  off: (events: string, selector?: string) => void;
  data: (key: string) => DateRangePickerInstance | undefined;
};

export function DateRangeInput({
  start,
  end,
  onChange,
  placeholder = "Chọn khoảng thời gian",
  ariaLabel,
  className = "field date-range-field",
}: DateRangeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const jqueryRef = useRef<
    ((element: HTMLElement) => JQueryPluginInput) | null
  >(null);
  const momentRef = useRef<MomentFactory | null>(null);
  const rangeRef = useRef({ start, end });
  const onChangeRef = useRef(onChange);
  const openPickerRequestedRef = useRef(false);
  const [ready, setReady] = useState(false);

  function openDatePicker() {
    const input = inputRef.current;
    if (!input) return;
    const picker = jqueryRef.current?.(input).data("daterangepicker");
    if (picker?.show) {
      picker.show();
    } else {
      openPickerRequestedRef.current = true;
    }
  }

  useEffect(() => {
    rangeRef.current = { start, end };
    onChangeRef.current = onChange;
  }, [start, end, onChange]);

  useEffect(() => {
    let active = true;
    let wrapped: JQueryPluginInput | null = null;
    let alignPickerArrow: (() => void) | null = null;
    let handleResize: (() => void) | null = null;
    let handleCalendarClick: ((event: MouseEvent) => void) | null = null;

    async function attachPicker() {
      const [{ default: jquery }, { default: moment }] = await Promise.all([
        import("jquery"),
        import("moment"),
      ]);
      if (!active || !inputRef.current) return;

      jqueryRef.current = jquery as unknown as (
        element: HTMLElement,
      ) => JQueryPluginInput;
      momentRef.current = moment;
      moment.locale("vi");
      const globals = window as Window & {
        jQuery?: unknown;
        $?: unknown;
        moment?: unknown;
      };
      globals.jQuery = jquery;
      globals.$ = jquery;
      globals.moment = moment;
      await import("daterangepicker");
      const createWrapper = jqueryRef.current;
      if (!active || !inputRef.current || !createWrapper) return;

      wrapped = createWrapper(inputRef.current);
      const ranges = Object.fromEntries(
        getDateRangePresets().map(({ label, start, end }) => [
          label,
          [moment(start, "YYYY-MM-DD"), moment(end, "YYYY-MM-DD")],
        ]),
      );
      const initialStart = rangeRef.current.start || todayLocal();
      const initialEnd = rangeRef.current.end || initialStart;
      wrapped.daterangepicker({
        startDate: moment(initialStart, "YYYY-MM-DD"),
        endDate: moment(initialEnd, "YYYY-MM-DD"),
        autoUpdateInput: false,
        showDropdowns: true,
        alwaysShowCalendars: true,
        linkedCalendars: false,
        ranges,
        showCustomRangeLabel: true,
        opens: "left",
        drops: "down",
        locale: {
          format: "DD/MM/YYYY",
          separator: " – ",
          applyLabel: "Áp dụng",
          cancelLabel: "Xóa",
          customRangeLabel: "Tùy chọn",
          daysOfWeek: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"],
          monthNames: [
            "Tháng 1",
            "Tháng 2",
            "Tháng 3",
            "Tháng 4",
            "Tháng 5",
            "Tháng 6",
            "Tháng 7",
            "Tháng 8",
            "Tháng 9",
            "Tháng 10",
            "Tháng 11",
            "Tháng 12",
          ],
          firstDay: 1,
        },
      });
      const picker = wrapped.data("daterangepicker");
      const calendarElement = picker?.container?.[0];
      if (picker?.clickDate && calendarElement && jqueryRef.current) {
        calendarElement
          .querySelectorAll<HTMLElement>(".drp-calendar")
          .forEach((calendar) => {
            jqueryRef.current?.(calendar).off(
              "mousedown.daterangepicker",
              "td.available",
            );
          });
        handleCalendarClick = (event) => {
          selectAvailableDateCell(
            event.target,
            calendarElement,
            (dateEvent) => picker.clickDate?.(dateEvent),
            () => event.stopPropagation(),
          );
        };
        calendarElement.addEventListener("click", handleCalendarClick);
      }
      alignPickerArrow = () => {
        const input = inputRef.current;
        const pickerElement =
          document.querySelector<HTMLElement>(".daterangepicker");
        if (!input || !pickerElement) return;
        const inputBounds = input.getBoundingClientRect();
        const pickerBounds = pickerElement.getBoundingClientRect();
        const arrowStyle = window.getComputedStyle(pickerElement, "::before");
        const arrowWidth =
          Number.parseFloat(arrowStyle.borderLeftWidth) +
          Number.parseFloat(arrowStyle.borderRightWidth);
        const centeredLeft =
          inputBounds.left +
          inputBounds.width / 2 -
          pickerBounds.left -
          arrowWidth / 2;
        const left = Math.max(
          10,
          Math.min(centeredLeft, pickerBounds.width - arrowWidth - 10),
        );
        pickerElement.style.setProperty("--date-range-arrow-left", `${left}px`);
      };
      wrapped.on("show.daterangepicker", () => {
        window.requestAnimationFrame(() => alignPickerArrow?.());
      });
      handleResize = () => alignPickerArrow?.();
      window.addEventListener("resize", handleResize);
      wrapped.on("apply.daterangepicker", (_event, picker) => {
        const nextStart = picker.startDate.format("YYYY-MM-DD");
        const nextEnd = picker.endDate.format("YYYY-MM-DD");
        if (inputRef.current) {
          inputRef.current.value =
            picker.startDate.format("DD/MM/YYYY") +
            " – " +
            picker.endDate.format("DD/MM/YYYY");
        }
        onChangeRef.current(nextStart, nextEnd);
      });
      wrapped.on("cancel.daterangepicker", () => {
        if (inputRef.current) inputRef.current.value = "";
        onChangeRef.current("", "");
      });
      if (openPickerRequestedRef.current) {
        openPickerRequestedRef.current = false;
        window.requestAnimationFrame(() => {
          if (active) wrapped?.data("daterangepicker")?.show?.();
        });
      }
      setReady(true);
    }

    void attachPicker();
    return () => {
      active = false;
      wrapped?.off("apply.daterangepicker");
      wrapped?.off("cancel.daterangepicker");
      wrapped?.off("show.daterangepicker");
      if (handleResize) window.removeEventListener("resize", handleResize);
      const calendarElement = wrapped?.data("daterangepicker")?.container?.[0];
      if (handleCalendarClick && calendarElement) {
        calendarElement.removeEventListener("click", handleCalendarClick);
      }
      wrapped?.data("daterangepicker")?.remove?.();
      jqueryRef.current = null;
    };
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    const jquery = jqueryRef.current;
    if (!input || !jquery || !ready || !momentRef.current) return;
    const wrapped = jquery(input);
    const picker = wrapped.data("daterangepicker");
    if (start && end) {
      const moment = momentRef.current;
      input.value =
        moment(start, "YYYY-MM-DD").format("DD/MM/YYYY") +
        " – " +
        moment(end, "YYYY-MM-DD").format("DD/MM/YYYY");
      picker?.setStartDate?.(moment(start, "YYYY-MM-DD"));
      picker?.setEndDate?.(moment(end, "YYYY-MM-DD"));
    } else {
      input.value = "";
    }
  }, [start, end, ready]);

  return (
    <AppInput
      ref={inputRef}
      className={className}
      type="text"
      readOnly
      placeholder={placeholder}
      aria-label={ariaLabel}
      onClick={openDatePicker}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        openDatePicker();
      }}
      onTouchStart={openDatePicker}
    />
  );
}
