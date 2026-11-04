"use client";

import { useEffect, useId, useState } from "react";
import Select, { type GroupBase, type StylesConfig } from "react-select";
import { components, type DropdownIndicatorProps } from "react-select";
import { ChevronDown, Search } from "lucide-react";
import { matchesSearchQuery } from "@/lib/search";

export type AppSelectOption = {
  value: string;
  label: string;
  appearance?: "primary";
};

type AppSelectProps = {
  id?: string;
  ariaLabel: string;
  options: AppSelectOption[];
  value: string | number;
  onChange: (value: string) => void;
  isMulti?: false;
  placeholder?: string;
  isDisabled?: boolean;
  isClearable?: boolean;
  isSearchable?: boolean;
  showSearchIcon?: boolean;
};

const styles: StylesConfig<
  AppSelectOption,
  boolean,
  GroupBase<AppSelectOption>
> = {
  control: (base, state) => ({
    ...base,
    minHeight: 32,
    fontSize: 12,
    borderColor: state.isFocused ? "var(--primary)" : "var(--border)",
    borderRadius: "var(--radius-input)",
    backgroundColor: state.isDisabled
      ? "var(--surface-subtle)"
      : "var(--surface)",
    boxShadow: state.isFocused ? "var(--shadow-focus)" : "none",
    "&:hover": { borderColor: "var(--primary)" },
    "&:active": {
      borderColor: "var(--primary)",
      boxShadow: "var(--shadow-focus)",
    },
  }),
  valueContainer: (base) => ({
    ...base,
    minHeight: 30,
    height: "auto",
    padding: "2px 9px",
    fontSize: 12,
  }),
  input: (base) => ({ ...base, margin: 0, padding: 0, fontSize: 12 }),
  singleValue: (base) => ({
    ...base,
    color: "var(--text-primary)",
    fontSize: 12,
  }),
  placeholder: (base) => ({
    ...base,
    color: "var(--text-secondary)",
    fontSize: 12,
  }),
  indicatorsContainer: (base) => ({ ...base, minHeight: 30 }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base) => ({
    ...base,
    padding: 5,
    color: "var(--text-secondary)",
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: 5,
    color: "var(--text-secondary)",
  }),
  menu: (base) => ({
    ...base,
    zIndex: "var(--z-modal-popover)",
    marginTop: 4,
    overflow: "hidden",
    border: "1px solid var(--border)",
    borderRadius: 8,
    backgroundColor: "var(--surface)",
    boxShadow: "var(--shadow-card)",
  }),
  menuList: (base) => ({ ...base, padding: 4, maxHeight: 260 }),
  menuPortal: (base) => ({ ...base, zIndex: "var(--z-modal-popover)" }),
  option: (base, state) => {
    const primaryAction = state.data.appearance === "primary";
    return {
      ...base,
      minHeight: 32,
      padding: "7px 9px",
      borderRadius: 5,
      fontSize: 12,
      fontWeight: primaryAction ? "var(--weight-semibold)" : base.fontWeight,
      color: primaryAction
        ? "var(--surface)"
        : state.isSelected
          ? "var(--surface)"
          : "var(--text-primary)",
      backgroundColor: primaryAction
        ? state.isFocused
          ? "var(--primary-hover)"
          : "var(--primary)"
        : state.isSelected
          ? "var(--primary)"
          : state.isFocused
            ? "var(--primary-subtle)"
            : "transparent",
      cursor: "pointer",
    };
  },
};

type AppMultiSelectProps = Omit<
  AppSelectProps,
  "value" | "onChange" | "isMulti"
> & {
  isMulti: true;
  value: string[];
  onChange: (value: string[]) => void;
};

function SearchDropdownIndicator(
  props: DropdownIndicatorProps<
    AppSelectOption,
    boolean,
    GroupBase<AppSelectOption>
  >,
) {
  return (
    <components.DropdownIndicator {...props}>
      <span className="app-select-search-indicator">
        <Search size={15} aria-hidden="true" />
        <ChevronDown size={16} aria-hidden="true" />
      </span>
    </components.DropdownIndicator>
  );
}

export function AppSelect(props: AppSelectProps | AppMultiSelectProps) {
  const {
    id,
    ariaLabel,
    options,
    value,
    onChange,
    placeholder = "Chọn…",
    isDisabled = false,
    isClearable = false,
    isSearchable = false,
    showSearchIcon = true,
    isMulti = false,
  } = props;
  const generatedId = useId();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      setPortalTarget(document.body),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const selected = isMulti
    ? options.filter((option) => (value as string[]).includes(option.value))
    : (options.find((option) => option.value === String(value)) ?? null);
  return (
    <Select<AppSelectOption, boolean>
      inputId={id ?? generatedId}
      instanceId={id ?? generatedId}
      aria-label={ariaLabel}
      className="app-select"
      classNamePrefix="app-select"
      options={options}
      value={selected}
      isMulti={isMulti}
      closeMenuOnSelect={!isMulti}
      onChange={(option) =>
        isMulti
          ? (onChange as AppMultiSelectProps["onChange"])(
              (option as readonly AppSelectOption[] | null)?.map(
                (item) => item.value,
              ) ?? [],
            )
          : (onChange as AppSelectProps["onChange"])(
              (option as AppSelectOption | null)?.value ?? "",
            )
      }
      placeholder={placeholder}
      isDisabled={isDisabled}
      isClearable={isClearable}
      isSearchable={isSearchable}
      filterOption={(option, inputValue) =>
        matchesSearchQuery(option.label, inputValue)
      }
      components={
        isSearchable && showSearchIcon
          ? { DropdownIndicator: SearchDropdownIndicator }
          : undefined
      }
      menuPortalTarget={portalTarget ?? undefined}
      menuPosition={portalTarget ? "fixed" : "absolute"}
      styles={styles}
      classNames={{
        control: () => "app-select-control",
        menu: () => "app-select-menu",
        option: () => "app-select-option",
        multiValue: () => "app-select-multi-value",
      }}
    />
  );
}
