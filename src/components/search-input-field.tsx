"use client";

import { forwardRef } from "react";
import { Search, X } from "lucide-react";
import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import { mergeClassNames } from "@/lib/class-names";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  showSearchIcon?: boolean;
};

export const SearchInputField = forwardRef<HTMLInputElement, Props>(
  function SearchInputField(
    {
      value,
      onChange,
      onClear,
      showSearchIcon = true,
      className = "",
      ...props
    },
    ref,
  ) {
    const classes = mergeClassNames(
      showSearchIcon ? "search-input-field" : "plain-input-field",
      className,
    );

    return (
      <label className={classes || undefined}>
        <AppInput
          {...props}
          ref={ref}
          className="field"
          iconLeft={showSearchIcon ? <Search size={15} /> : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {onClear && (
          <AppButton
            variant="ghost"
            type="button"
            className="search-clear-button"
            aria-label="Xóa nội dung tìm kiếm"
            aria-hidden={!value}
            tabIndex={value ? undefined : -1}
            disabled={!value}
            onClick={onClear}
          >
            <X size={15} />
          </AppButton>
        )}
      </label>
    );
  },
);
