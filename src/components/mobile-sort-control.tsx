"use client";

import { useId, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { AppButton } from "@/components/app-button";
import { MobileOverlaySheet } from "@/components/mobile-overlay-sheet";
import type { DataTableSort } from "@/components/data-table";

export type MobileSortOption = {
  key: string;
  label: string;
  sortable?: boolean;
};

export function MobileSortControl({
  columns,
  sort,
  onChange,
}: {
  columns: MobileSortOption[];
  sort: DataTableSort | null;
  onChange: (sort: DataTableSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DataTableSort | null>(sort);
  const groupId = useId();
  const sortableColumns = columns.filter(
    (column) => column.sortable !== false && column.key !== "actions",
  );

  if (!sortableColumns.length) return null;

  function show() {
    setDraft(sort);
    setOpen(true);
  }

  return (
    <>
      <AppButton
        variant="default"
        type="button"
        className="mobile-sort-trigger"
        iconLeft={<ArrowUpDown size={16} />}
        aria-expanded={open}
        onClick={show}
      >
        <span className="mobile-sort-trigger-label">Sắp xếp</span>
      </AppButton>
      <MobileOverlaySheet
        open={open}
        title="Sắp xếp"
        onClose={() => setOpen(false)}
        className="mobile-sort-sheet"
      >
        <div className="mobile-sort-options">
          <fieldset>
            <legend>Cột</legend>
            {sortableColumns.map((column) => (
              <label key={column.key}>
                <input
                  type="radio"
                  name={`${groupId}-column`}
                  value={column.key}
                  checked={draft?.key === column.key}
                  onChange={() =>
                    setDraft((current) => ({
                      key: column.key,
                      direction: current?.direction ?? "asc",
                    }))
                  }
                />
                {column.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Hướng</legend>
            {(
              [
                ["asc", "A-Z"],
                ["desc", "Z-A"],
              ] as const
            ).map(([direction, label]) => (
              <label key={direction}>
                <input
                  type="radio"
                  name={`${groupId}-direction`}
                  value={direction}
                  checked={draft?.direction === direction}
                  onChange={() =>
                    setDraft((current) => ({
                      key: current?.key ?? sortableColumns[0].key,
                      direction,
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
        <footer className="mobile-overlay-actions">
          <AppButton
            variant="secondary"
            type="button"
            onClick={() => setOpen(false)}
          >
            Hủy
          </AppButton>
          <AppButton
            variant="primary"
            type="button"
            disabled={!draft}
            onClick={() => {
              if (draft) onChange(draft);
              setOpen(false);
            }}
          >
            Áp dụng
          </AppButton>
        </footer>
      </MobileOverlaySheet>
    </>
  );
}
