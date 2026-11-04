"use client";

import { useEffect, useRef, useState } from "react";
import { AppInput } from "@/components/app-input";
import { mergeClassNames } from "@/lib/class-names";

export function InlineEditField({
  value,
  placeholder = "—",
  ariaLabel,
  disabled = false,
  onSave,
  onError,
}: {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<void> | void;
  onError?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  async function commit() {
    if (!editing) return;
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (caught) {
      onError?.(
        caught instanceof Error ? caught.message : "Không lưu được thay đổi.",
      );
      // Keep the value editable when the parent reports a save failure.
    }
  }

  return (
    <AppInput
      ref={inputRef}
      type="text"
      className={mergeClassNames(
        "field inline-edit-field",
        editing && "is-editing",
      )}
      aria-label={ariaLabel}
      aria-readonly={!editing}
      readOnly={!editing || disabled}
      disabled={disabled}
      placeholder={placeholder}
      value={editing ? draft : value}
      onClick={() => {
        if (!disabled && !editing) {
          setDraft(value);
          setEditing(true);
        }
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}
