"use client";

import {
  useCallback,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { FaSort, FaSortDown, FaSortUp } from "react-icons/fa6";
import { GripVertical } from "lucide-react";
import { useDrag, useDrop } from "react-dnd";
import { AppButton } from "@/components/app-button";
import { mergeClassNames } from "@/lib/class-names";

export type AppTableSort = {
  key: string;
  direction: "asc" | "desc";
};

type ColumnTitle =
  { title: ReactNode; label?: string } | { label: string; title?: ReactNode };

export type AppTableColumn<T> = ColumnTitle & {
  key: string;
  render?: (row: T) => ReactNode;
  value?: (row: T) => string | number | null;
  total?: ReactNode;
  /** @deprecated Use `total` for API-provided column totals. */
  summary?: ReactNode;
  hideable?: boolean;
  sortable?: boolean;
  draggable?: boolean;
  /** @deprecated Set `draggable={false}` instead. */
  dragDisabled?: boolean;
  ariaLabel?: string;
  align?: "left" | "center" | "right";
  headerClassName?: string;
  cellClassName?: string;
};

export type AppTableRootProps = Omit<
  ComponentPropsWithoutRef<"table">,
  "title" | "summary"
> & {
  heading?: ReactNode;
  toolbarSummary?: ReactNode;
  tools?: ReactNode;
  summary?: ReactNode;
  striped?: boolean;
};

function AppTableRoot({
  heading,
  toolbarSummary,
  tools,
  summary,
  striped = true,
  className = "",
  children,
  ...tableProps
}: AppTableRootProps) {
  const hasToolbar =
    heading !== undefined ||
    toolbarSummary !== undefined ||
    tools !== undefined;

  return (
    <div className="app-table-shell">
      {hasToolbar && (
        <div className="app-table-toolbar">
          <div className="app-table-toolbar-start">
            {heading !== undefined && (
              <div className="app-table-title">{heading}</div>
            )}
            {toolbarSummary !== undefined && (
              <div className="table-tools-summary">{toolbarSummary}</div>
            )}
          </div>
          {tools !== undefined && (
            <div className="app-table-toolbar-tools">{tools}</div>
          )}
        </div>
      )}
      <table
        {...tableProps}
        className={mergeClassNames(
          "app-table",
          striped && "app-table--striped",
          className,
        )}
      >
        {children}
      </table>
      {summary !== undefined && (
        <div className="app-table-summary">{summary}</div>
      )}
    </div>
  );
}

export function AppTableHeaderCell<T>({
  column,
  sort,
  onSortChange,
  onColumnMove,
}: {
  column: AppTableColumn<T>;
  sort?: AppTableSort | null;
  onSortChange?: (sort: AppTableSort) => void;
  onColumnMove?: (
    source: string,
    target: string,
    edge: "before" | "after",
  ) => void;
}) {
  const ref = useRef<HTMLTableCellElement>(null);
  const draggable = column.draggable ?? !column.dragDisabled;
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: "table-column",
      item: { key: column.key },
      canDrag: draggable && Boolean(onColumnMove),
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [column.key, draggable, onColumnMove],
  );
  const [{ isOver, edge }, drop] = useDrop(
    () => ({
      accept: "table-column",
      canDrop: () => draggable && Boolean(onColumnMove),
      hover: (_item: { key: string }, monitor) => {
        if (!ref.current || !draggable || !onColumnMove) return;
        const pointer = monitor.getClientOffset();
        if (pointer) {
          ref.current.dataset.dropEdge =
            pointer.x <
            ref.current.getBoundingClientRect().left +
              ref.current.clientWidth / 2
              ? "before"
              : "after";
        }
      },
      drop: (item: { key: string }) => {
        if (item.key !== column.key && onColumnMove) {
          onColumnMove(
            item.key,
            column.key,
            ref.current?.dataset.dropEdge === "after" ? "after" : "before",
          );
        }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        edge: ref.current?.dataset.dropEdge,
      }),
    }),
    [column.key, draggable, onColumnMove],
  );
  const setNode = useCallback(
    (node: HTMLTableCellElement | null) => {
      ref.current = node;
      if (node && draggable && onColumnMove) {
        drop(node);
        drag(node);
      }
    },
    [drag, draggable, drop, onColumnMove],
  );
  const sortable = column.sortable ?? Boolean(column.value);
  const heading = column.title ?? column.label;
  const accessibleHeading =
    column.ariaLabel ??
    (typeof heading === "string" ? heading : (column.label ?? "cột"));

  return (
    <th
      ref={setNode}
      aria-sort={
        sort?.key === column.key
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
      className={mergeClassNames(
        isDragging && "column-dragging",
        isOver && "column-drop-target",
        column.headerClassName,
      )}
      data-drop-edge={isOver ? edge : undefined}
      style={column.align ? { textAlign: column.align } : undefined}
    >
      <span className="table-header-content">
        {draggable && onColumnMove && (
          <GripVertical
            size={12}
            className="column-drag-handle"
            aria-hidden="true"
          />
        )}
        {sortable && onSortChange ? (
          <AppButton
            variant="ghost"
            type="button"
            className="table-sort"
            aria-label={`Sắp xếp theo ${accessibleHeading}`}
            onClick={() =>
              onSortChange({
                key: column.key,
                direction:
                  sort?.key === column.key && sort.direction === "asc"
                    ? "desc"
                    : "asc",
              })
            }
          >
            {heading}
            {sort?.key === column.key ? (
              sort.direction === "asc" ? (
                <FaSortUp className="sort-icon asc" aria-hidden="true" />
              ) : (
                <FaSortDown className="sort-icon desc" aria-hidden="true" />
              )
            ) : (
              <FaSort className="sort-icon" aria-hidden="true" />
            )}
          </AppButton>
        ) : (
          heading
        )}
      </span>
    </th>
  );
}

export function AppTableHeader<T>({
  columns,
  sort,
  onSortChange,
  onColumnMove,
  totalRows,
  showTotalsRow,
  trailingHeaderCell,
}: {
  columns: AppTableColumn<T>[];
  sort?: AppTableSort | null;
  onSortChange?: (sort: AppTableSort) => void;
  onColumnMove?: (
    source: string,
    target: string,
    edge: "before" | "after",
  ) => void;
  totalRows?: number;
  showTotalsRow?: boolean;
  trailingHeaderCell?: ReactNode;
}) {
  const hasColumnTotals = columns.some(
    (column) => column.total !== undefined || column.summary !== undefined,
  );
  const renderTotals =
    showTotalsRow ?? (hasColumnTotals || totalRows !== undefined);
  const hasAnyColumnTotal = columns.some(
    (column) => column.total !== undefined || column.summary !== undefined,
  );

  return (
    <thead>
      <tr>
        {columns.map((column) => (
          <AppTableHeaderCell
            key={column.key}
            column={column}
            sort={sort}
            onSortChange={onSortChange}
            onColumnMove={onColumnMove}
          />
        ))}
        {trailingHeaderCell}
      </tr>
      {renderTotals && (
        <tr className="table-summary-row">
          {columns.length === 0 ? (
            <th>{totalRows === undefined ? "" : `Tổng ${totalRows}`}</th>
          ) : (
            <>
              {columns.map((column, index) => (
                <th key={column.key}>
                  {column.total ??
                    column.summary ??
                    (!hasAnyColumnTotal &&
                    index === 0 &&
                    totalRows !== undefined
                      ? `Tổng ${totalRows}`
                      : "")}
                </th>
              ))}
              {trailingHeaderCell !== undefined && <th />}
            </>
          )}
        </tr>
      )}
    </thead>
  );
}

export function AppTableRow({
  index,
  "data-row-index": rowIndex,
  "data-row-tone": rowTone,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"tr"> & {
  index?: number;
  "data-row-index"?: number | string;
  "data-row-tone"?: string;
}) {
  const tone =
    index === undefined ? undefined : index % 2 === 0 ? "odd" : "even";
  return (
    <tr
      {...props}
      data-row-index={index ?? rowIndex}
      data-row-tone={tone ?? rowTone}
      className={mergeClassNames("app-table-row", className)}
    />
  );
}

export function AppTableCell({
  align,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"td"> & {
  align?: "left" | "center" | "right";
}) {
  return (
    <td
      {...props}
      className={mergeClassNames("app-table-cell", className)}
      style={{ ...props.style, ...(align ? { textAlign: align } : {}) }}
    />
  );
}

export function AppTableBody<T>({
  rows,
  columns,
  rowKey,
  empty,
  leadingRows,
  rowClassName,
  onRowClick,
  isRowClickable,
  renderCell,
  renderRow,
}: {
  rows: T[];
  columns: AppTableColumn<T>[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  leadingRows?: ReactNode;
  rowClassName?: (row: T, index: number) => string | undefined;
  onRowClick?: (row: T) => void;
  isRowClickable?: (row: T) => boolean;
  renderCell?: (column: AppTableColumn<T>, row: T) => ReactNode;
  renderRow?: (
    row: T,
    index: number,
    columns: AppTableColumn<T>[],
  ) => ReactNode;
}) {
  const isInteractiveRowTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(
      target.closest(
        "button, a, input, select, textarea, [contenteditable='true'], [role='button'], [role='menuitem'], [role='combobox'], [data-row-click-ignore]",
      ),
    );
  return (
    <tbody>
      {leadingRows}
      {rows.map((row, index) => {
        if (renderRow)
          return (
            <FragmentRow key={rowKey(row)}>
              {renderRow(row, index, columns)}
            </FragmentRow>
          );

        const clickable = Boolean(
          onRowClick && (isRowClickable?.(row) ?? true),
        );
        return (
          <AppTableRow
            key={rowKey(row)}
            className={mergeClassNames(
              rowClassName?.(row, index),
              clickable && "app-table-row--clickable",
            )}
            index={index}
            onClick={
              clickable && onRowClick
                ? (event) => {
                    if (isInteractiveRowTarget(event.target)) return;
                    onRowClick(row);
                  }
                : undefined
            }
            onKeyDown={
              clickable && onRowClick
                ? (event) => {
                    if (
                      event.target !== event.currentTarget ||
                      isInteractiveRowTarget(event.target) ||
                      (event.key !== "Enter" && event.key !== " ")
                    )
                      return;
                    event.preventDefault();
                    onRowClick(row);
                  }
                : undefined
            }
            tabIndex={clickable ? 0 : undefined}
            style={clickable ? { cursor: "pointer" } : undefined}
          >
            {columns.map((column) => (
              <AppTableCell
                key={column.key}
                className={column.cellClassName}
                align={column.align}
              >
                {renderCell ? renderCell(column, row) : column.render?.(row)}
              </AppTableCell>
            ))}
          </AppTableRow>
        );
      })}
      {rows.length === 0 && empty !== undefined && (
        <AppTableRow className="app-table-empty-row">
          <AppTableCell
            className="muted"
            align="center"
            colSpan={columns.length || 1}
          >
            {empty}
          </AppTableCell>
        </AppTableRow>
      )}
    </tbody>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

type AppTableComponent = typeof AppTableRoot & {
  Header: typeof AppTableHeader;
  HeaderCell: typeof AppTableHeaderCell;
  Body: typeof AppTableBody;
  Row: typeof AppTableRow;
  Cell: typeof AppTableCell;
};

export const AppTable = Object.assign(AppTableRoot, {
  Header: AppTableHeader,
  HeaderCell: AppTableHeaderCell,
  Body: AppTableBody,
  Row: AppTableRow,
  Cell: AppTableCell,
}) as AppTableComponent;
