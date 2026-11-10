"use client";

import { useState } from "react";
import { AppInput } from "@/components/app-input";
import { MAX_DECIMAL_PLACES } from "@/lib/constants";

type Props = {
  value: number | string;
  onChange: (value: string) => void;
  min?: number;
  step?: number;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  id?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  selectOnClick?: boolean;
  disabled?: boolean;
  allowNegative?: boolean;
};

const formatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: MAX_DECIMAL_PLACES,
  useGrouping: true,
});

function formatValue(value: number | string) {
  const rawValue = String(value);
  if (rawValue === "" || rawValue === "-" || rawValue.endsWith(".")) {
    return rawValue;
  }
  return Number.isFinite(Number(value))
    ? formatter.format(Number(value))
    : rawValue;
}

function sanitizeInput(value: string) {
  const sanitized = value.replace(/,/g, "").replace(/[^\d.-]/g, "");
  const sign = sanitized.startsWith("-") ? "-" : "";
  const unsigned = sanitized.replace(/-/g, "");
  const decimalIndex = unsigned.indexOf(".");
  const hasDecimal = decimalIndex >= 0;
  const integer = hasDecimal ? unsigned.slice(0, decimalIndex) : unsigned;
  const fraction = hasDecimal
    ? unsigned
        .slice(decimalIndex + 1)
        .replace(/\./g, "")
        .slice(0, MAX_DECIMAL_PLACES)
    : "";

  return sign + integer + (hasDecimal ? `.${fraction}` : "");
}

export function NumberInputField({
  value,
  onChange,
  min = 0,
  step = 1,
  className = "field",
  style,
  ariaLabel,
  id,
  inputRef,
  onKeyDown,
  selectOnClick = true,
  disabled = false,
  allowNegative = false,
}: Props) {
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(() => String(value));

  return (
    <AppInput
      id={id}
      ref={inputRef}
      className={className}
      style={style}
      disabled={disabled}
      inputMode="decimal"
      aria-label={ariaLabel}
      value={isFocused ? draft : formatValue(value)}
      onFocus={(event) => {
        setIsFocused(true);
        setDraft(String(value));
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const raw = sanitizeInput(event.target.value);
        setDraft(raw);
        if (raw === "" || raw === "-" || raw.endsWith(".")) {
          onChange(raw);
          return;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return;
        const next = allowNegative ? parsed : Math.max(min, parsed);
        if (next !== parsed) setDraft(String(next));
        onChange(String(next));
      }}
      onClick={(event) => {
        if (selectOnClick) event.currentTarget.select();
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        const parsed = Number(draft);
        const next =
          draft === "" || draft === "-" || !Number.isFinite(parsed)
            ? min
            : allowNegative
              ? parsed
              : Math.max(min, parsed);
        const normalized = String(next);
        setIsFocused(false);
        setDraft(normalized);
        onChange(normalized);
      }}
      step={step}
    />
  );
}
