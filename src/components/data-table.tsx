"use client";

import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import {
  AppTable,
  type AppTableColumn,
  type AppTableSort,
} from "@/components/app-table";

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FaTable } from "react-icons/fa6";
import { MoreHorizontal } from "lucide-react";
import { MobileSortControl } from "@/components/mobile-sort-control";

export type DataColumn<T> = AppTableColumn<T> & {
  label: string;
  render: (row: T) => React.ReactNode;
};

export type DataTableSort = AppTableSort;

export type DataTableServerSort = {
  value: DataTableSort | null;
  onChange: (sort: DataTableSort) => void;
};

function actionNodes(node: React.ReactNode): React.ReactNode[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: React.ReactNode }>(child) &&
    child.type === Fragment
      ? actionNodes(child.props.children)
      : child == null || typeof child === "boolean"
        ? []
        : [child],
  );
}
function ActionCell({ children }: { children: React.ReactNode }) {
  const items = actionNodes(children);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (
        triggerRef.current?.contains(event.target as Node) ||
        menuRef.current?.contains(event.target as Node)
      )
        return;
      setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  if (items.length <= 2) return <div className="action-list">{items}</div>;
  return (
    <div className="action-menu">
      <AppButton
        variant="ghost"
        ref={triggerRef}
        type="button"
        className="action-menu-trigger"
        aria-label="Thêm thao tác"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const bounds = triggerRef.current?.getBoundingClientRect();
          if (bounds)
            setMenuPosition({
              top: Math.min(bounds.bottom + 4, window.innerHeight - 180),
              left: Math.max(
                8,
                Math.min(bounds.right - 168, window.innerWidth - 176),
              ),
            });
          setOpen(true);
        }}
      >
        <MoreHorizontal aria-hidden="true" />
      </AppButton>
      {open &&
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className="action-menu-items"
            role="menu"
            style={{
              position: "fixed",
              top: menuPosition.top,
              left: menuPosition.left,
              right: "auto",
              width: 168,
            }}
            onClick={() => setOpen(false)}
          >
            {items.map((item, index) => (
              <div role="menuitem" key={index}>
                {item}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  storageKey,
  initialVisible = columns.map((column) => column.key),
  persistVisibleColumns = true,
  title,
  toolbarSummary,
  tools,
  summary,
  showSummaryRow = true,
  leadingRows,
  serverSort,
  totalRows,
  onRowClick,
  isRowClickable,
  activeRowId,
  onVisibleColumnsChange,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  empty: React.ReactNode;
  storageKey: string;
  initialVisible?: string[];
  persistVisibleColumns?: boolean;
  title?: React.ReactNode;
  toolbarSummary: React.ReactNode;
  tools?: React.ReactNode;
  summary?: React.ReactNode;
  showSummaryRow?: boolean;
  leadingRows?: (columns: DataColumn<T>[]) => React.ReactNode;
  serverSort: DataTableServerSort;
  totalRows: number;
  onRowClick?: (row: T) => void;
  isRowClickable?: (row: T) => boolean;
  activeRowId?: string | null;
  onVisibleColumnsChange?: (columnKeys: string[]) => void;
}) {
  const sort = serverSort.value;
  const [visible, setVisible] = useState(initialVisible);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => [
    ...columns
      .filter((column) => column.key !== "actions")
      .map((column) => column.key),
    ...columns
      .filter((column) => column.key === "actions")
      .map((column) => column.key),
  ]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [columnMenu, setColumnMenu] = useState(false);
  const availableColumns = columns.map((column) => column.key).join("|");
  useEffect(() => {
    try {
      if (persistVisibleColumns) {
        const saved = localStorage.getItem(`erp-table-columns:${storageKey}`);
        if (saved) {
          const keys = JSON.parse(saved) as string[];
          // localStorage is the persisted source of this client-side preference.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setVisible(
            keys.filter((key) => columns.some((column) => column.key === key)),
          );
        }
      }
      const savedOrder = localStorage.getItem(`erp-table-order:${storageKey}`);
      if (savedOrder) {
        const keys = JSON.parse(savedOrder) as string[];
        const order = [
          ...keys.filter((key) => columns.some((column) => column.key === key)),
          ...columns
            .map((column) => column.key)
            .filter((key) => !keys.includes(key)),
        ];
        setColumnOrder([
          ...order.filter((key) => key !== "actions"),
          ...order.filter((key) => key === "actions"),
        ]);
      }
    } catch {
      /* Ignore invalid local preferences. */
    }
    setPreferencesLoaded(true);
    // The table's data key and column definitions identify its preference namespace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableColumns, persistVisibleColumns, storageKey]);
  useEffect(() => {
    if (preferencesLoaded && persistVisibleColumns)
      localStorage.setItem(
        `erp-table-columns:${storageKey}`,
        JSON.stringify(visible),
      );
  }, [persistVisibleColumns, preferencesLoaded, storageKey, visible]);
  useEffect(() => {
    if (preferencesLoaded)
      localStorage.setItem(
        `erp-table-order:${storageKey}`,
        JSON.stringify(columnOrder),
      );
  }, [columnOrder, preferencesLoaded, storageKey]);
  const displayColumns = columnOrder
    .map((key) => columns.find((column) => column.key === key))
    .filter((column): column is DataColumn<T> =>
      Boolean(column && visible.includes(column.key)),
    )
    .map((column) =>
      column.key === "actions" ? { ...column, draggable: false } : column,
    );
  const displayColumnSignature = displayColumns
    .map((column) => column.key)
    .join("|");
  useEffect(() => {
    if (preferencesLoaded)
      onVisibleColumnsChange?.(
        displayColumnSignature ? displayColumnSignature.split("|") : [],
      );
  }, [displayColumnSignature, onVisibleColumnsChange, preferencesLoaded]);
  function moveColumn(
    source: string,
    target: string,
    edge: "before" | "after",
  ) {
    if (
      source === target ||
      columns.find(
        (column) =>
          column.key === source &&
          (column.dragDisabled || column.draggable === false),
      ) ||
      columns.find(
        (column) =>
          column.key === target &&
          (column.dragDisabled || column.draggable === false),
      )
    )
      return;
    setColumnOrder((current) => {
      const order = [...current];
      const from = order.indexOf(source);
      if (from < 0 || !order.includes(target)) return current;
      order.splice(from, 1);
      const to = order.indexOf(target);
      order.splice(to + (edge === "after" ? 1 : 0), 0, source);
      return order;
    });
  }
  const onMoveColumn = moveColumn;
  return (
    <AppTable
      heading={title}
      toolbarSummary={toolbarSummary}
      summary={summary}
      tools={
        <div className="data-table-tools-actions">
          {tools}
          <MobileSortControl
            columns={displayColumns.map((column) => ({
              key: column.key,
              label: column.label,
              sortable: column.sortable ?? Boolean(column.value),
            }))}
            sort={sort}
            onChange={serverSort.onChange}
          />
          <AppButton
            variant="default"
            type="button"
            iconLeft={<FaTable />}
            className="column-menu-trigger"
            aria-label="Hiện cột"
            aria-expanded={columnMenu}
            onClick={() => setColumnMenu((value) => !value)}
          >
            <span className="column-menu-trigger-label">Cột</span>
          </AppButton>
          {columnMenu && (
            <div className="column-menu" role="group" aria-label="Hiện cột">
              <b>Hiện cột</b>
              {columns
                .filter((column) => column.hideable !== false)
                .map((column) => (
                  <label key={column.key}>
                    <AppInput
                      type="checkbox"
                      checked={visible.includes(column.key)}
                      onChange={(event) =>
                        setVisible((current) =>
                          event.target.checked
                            ? [...current, column.key]
                            : current.filter((key) => key !== column.key),
                        )
                      }
                    />
                    {column.label}
                  </label>
                ))}
            </div>
          )}
        </div>
      }
    >
      <AppTable.Header
        columns={displayColumns}
        sort={sort}
        onSortChange={serverSort.onChange}
        onColumnMove={onMoveColumn}
        totalRows={totalRows}
        showTotalsRow={showSummaryRow}
      />
      <AppTable.Body
        rows={rows}
        columns={displayColumns}
        rowKey={rowKey}
        onRowClick={onRowClick}
        isRowClickable={isRowClickable}
        rowClassName={(row) =>
          activeRowId && rowKey(row) === activeRowId
            ? "mobile-unified-card--selected"
            : undefined
        }
        empty={empty}
        leadingRows={leadingRows?.(displayColumns)}
        renderCell={(column, row) =>
          column.key === "actions" ? (
            <ActionCell>{column.render?.(row)}</ActionCell>
          ) : (
            column.render?.(row)
          )
        }
      />
    </AppTable>
  );
}
