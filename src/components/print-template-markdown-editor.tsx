"use client";

import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  EditorContent,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Columns3,
  Code2,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Rows3,
  Search,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/core";
import {
  normalizePrintTemplateContent,
  PRINT_TEMPLATE_FONT_SIZES,
  PRINT_TEMPLATE_FIELDS,
  type PrintTemplateField,
} from "@/lib/print-template";
import {
  PrintTemplateMarkdownBold,
  PrintTemplateMarkdownItalic,
  PrintTemplateMarkdownStrike,
  PrintTemplateFontSize,
  PrintTemplateFieldNode,
  PrintTemplateColumns,
  PrintTemplateParagraph,
  PrintTemplateMarkdownUnderline,
  normalizePrintTemplateFontSize,
} from "@/lib/print-template-editor";

const InteractivePrintTemplateField = PrintTemplateFieldNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PrintTemplateFieldView);
  },
});

type TextRange = { from: number; to: number };

function groupedFields(search: string, includeItemFields: boolean) {
  const filtered = PRINT_TEMPLATE_FIELDS.filter((field) => {
    if (!includeItemFields && field.token.startsWith("invoice.item.")) {
      return false;
    }
    return `${field.label} ${field.token} ${field.group}`
      .toLocaleLowerCase("vi")
      .includes(search.trim().toLocaleLowerCase("vi"));
  });
  return filtered.reduce<Record<string, PrintTemplateField[]>>(
    (groups, field) => {
      (groups[field.group] ??= []).push(field);
      return groups;
    },
    {},
  );
}

function readTableColumnWidths(editor: Editor) {
  const widths: number[][] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "table") return;
    const cells = node.firstChild?.content.content ?? [];
    const raw = cells.map((cell) => Number(cell.attrs.colwidth?.[0]) || 0);
    const total = raw.reduce((sum, width) => sum + width, 0);
    widths.push(total > 0 ? raw.map((width) => (width / total) * 100) : []);
  });
  return widths;
}

function getActiveTableColumn(editor: Editor, savedWidths: number[][]) {
  const position = editor.state.selection.from;
  const { node } = editor.view.domAtPos(position);
  const element = node instanceof Element ? node : node.parentElement;
  const cell = element?.closest("th, td") as HTMLTableCellElement | null;
  const table = cell?.closest("table") as HTMLTableElement | null;
  const row = table?.rows[0];
  if (!cell || !table || !row?.cells.length) return null;

  const tables = Array.from(editor.view.dom.querySelectorAll("table"));
  const tableIndex = tables.indexOf(table);
  if (tableIndex < 0) return null;

  const saved = savedWidths[tableIndex];
  const widths =
    saved?.length === row.cells.length && saved.every((width) => width > 0)
      ? saved
      : Array.from(
          row.cells,
          (tableCell) => tableCell.getBoundingClientRect().width,
        );
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!total) return null;

  return {
    tableIndex,
    columnIndex: cell.cellIndex,
    columnCount: row.cells.length,
    widths: widths.map((width) => (width / total) * 100),
  };
}

function PrintTemplateFieldView({ node, editor, deleteNode }: NodeViewProps) {
  const token = String(node.attrs.token ?? "");
  const field = PRINT_TEMPLATE_FIELDS.find((entry) => entry.token === token);
  const label = field?.label ?? token;

  return (
    <NodeViewWrapper
      as="span"
      className="print-template-token"
      data-print-template-token={token}
      title={label}
      contentEditable={false}
    >
      <span className="print-template-token__label">{label}</span>
      {editor.isEditable && (
        <button
          className="print-template-token__remove"
          type="button"
          aria-label={`Xóa trường ${label}`}
          title={`Xóa trường ${label}`}
          contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={deleteNode}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </NodeViewWrapper>
  );
}

function FormatButton({
  label,
  active = false,
  disabled,
  children,
  wide = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled: boolean;
  children: ReactNode;
  wide?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`print-template-format-button${active ? " is-active" : ""}${wide ? " is-labeled" : ""}`}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function PrintTemplateMarkdownEditor({
  value,
  editable,
  onChange,
  onColumnWidthsChange,
  columnWidths = [],
}: {
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
  onColumnWidthsChange?: (widths: number[][]) => void;
  columnWidths?: number[][];
}) {
  const normalizedValue = useMemo(
    () => normalizePrintTemplateContent(value),
    [value],
  );
  const [sourceMode, setSourceMode] = useState(false);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");
  const [, setSelectionVersion] = useState(0);
  const fieldRangeRef = useRef<TextRange | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const fieldSearchRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const onColumnWidthsChangeRef = useRef(onColumnWidthsChange);
  const editableRef = useRef(editable);
  const fieldMenuOpenRef = useRef(fieldMenuOpen);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bold: false,
        italic: false,
        paragraph: false,
        strike: false,
        underline: false,
      }),
      PrintTemplateParagraph,
      PrintTemplateColumns,
      TextAlign.configure({ types: ["paragraph"] }),
      TableKit.configure({
        table: {
          resizable: true,
          handleWidth: 8,
          cellMinWidth: 8,
          renderWrapper: true,
          HTMLAttributes: { class: "print-template-edit-table" },
        },
      }),
      PrintTemplateMarkdownBold,
      PrintTemplateMarkdownItalic,
      PrintTemplateMarkdownStrike,
      PrintTemplateMarkdownUnderline,
      PrintTemplateFontSize,
      Markdown.configure({ markedOptions: { gfm: true } }),
      InteractivePrintTemplateField,
    ],
    [],
  );

  const editor = useEditor(
    {
      extensions,
      content: normalizedValue,
      contentType: "markdown",
      editable,
      immediatelyRender: false,
      onUpdate: ({ editor: currentEditor }) => {
        onChangeRef.current(currentEditor.getMarkdown());
        onColumnWidthsChangeRef.current?.(readTableColumnWidths(currentEditor));
      },
      onSelectionUpdate: () => setSelectionVersion((version) => version + 1),
      editorProps: {
        attributes: {
          class: "tiptap print-template-tiptap",
          "aria-label": "Nội dung mẫu in",
        },
        handleKeyDown: (_view, event) => {
          if (event.key === "Escape" && fieldMenuOpenRef.current) {
            setFieldMenuOpen(false);
            fieldRangeRef.current = null;
            return true;
          }
          if (event.key !== "/" || !editableRef.current) return false;
          window.requestAnimationFrame(() => {
            const cursor = editorRef.current?.state.selection.from ?? 0;
            fieldRangeRef.current = {
              from: Math.max(1, cursor - 1),
              to: cursor,
            };
            setFieldSearch("");
            setFieldMenuOpen(true);
          });
          return false;
        },
      },
    },
    [extensions],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
    onColumnWidthsChangeRef.current = onColumnWidthsChange;
    editableRef.current = editable;
    fieldMenuOpenRef.current = fieldMenuOpen;
    editorRef.current = editor;
  }, [editable, editor, fieldMenuOpen, onChange, onColumnWidthsChange]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
    if (normalizedValue !== value) {
      onChangeRef.current(normalizedValue);
      return;
    }
    if (!sourceMode && editor.getMarkdown() !== normalizedValue) {
      editor.commands.setContent(normalizedValue, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
  }, [editable, editor, normalizedValue, sourceMode, value]);

  useEffect(() => {
    if (fieldMenuOpen) fieldSearchRef.current?.focus();
  }, [fieldMenuOpen]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dom.querySelectorAll("table").forEach((table, index) => {
      table.setAttribute("data-print-table-index", String(index));
    });
  }, [columnWidths, editor, normalizedValue]);

  const isInTable = Boolean(editor?.isActive("table"));
  const explicitFontSize = editor?.getAttributes(
    PrintTemplateFontSize.name,
  ).fontSize;
  const defaultFontSize = editor?.isActive("heading", { level: 1 })
    ? 15
    : editor?.isActive("tableHeader")
      ? 12
      : 11;
  const activeFontSize = normalizePrintTemplateFontSize(
    explicitFontSize ?? defaultFontSize,
  );
  const fieldsByGroup = groupedFields(fieldSearch, sourceMode || isInTable);
  const disabled = !editable || !editor;
  const activeTableColumn = editor
    ? getActiveTableColumn(editor, columnWidths)
    : null;
  const activeColumnWidth = activeTableColumn
    ? activeTableColumn.widths[activeTableColumn.columnIndex]
    : 0;
  const editorColumnWidthRules = columnWidths
    .flatMap((widths, tableIndex) =>
      widths.map((width, columnIndex) => {
        if (!width) return "";
        const safeWidth = Math.max(1, Math.min(99, width)).toFixed(2);
        return `.print-template-low-code-canvas .tiptap table[data-print-table-index="${tableIndex}"] :is(th, td):nth-child(${columnIndex + 1}) { width: ${safeWidth}% !important; }`;
      }),
    )
    .filter(Boolean)
    .join("\n");

  function setAlignment(alignment: "left" | "center" | "right") {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (editor.isActive("table")) {
      chain.setCellAttribute("align", alignment).run();
      return;
    }
    chain.setTextAlign(alignment).run();
  }

  function resizeActiveColumn(value: number) {
    if (!editor || !activeTableColumn || !onColumnWidthsChange) return;
    const minimumWidth = 4;
    const maximumWidth =
      100 - minimumWidth * (activeTableColumn.columnCount - 1);
    const targetWidth = Math.max(minimumWidth, Math.min(maximumWidth, value));
    const otherTotal = activeTableColumn.widths.reduce(
      (sum, width, index) =>
        index === activeTableColumn.columnIndex ? sum : sum + width,
      0,
    );
    if (!otherTotal) return;

    const updatedWidths = activeTableColumn.widths.map((width, index) =>
      index === activeTableColumn.columnIndex
        ? targetWidth
        : (width / otherTotal) * (100 - targetWidth),
    );
    const next = columnWidths.map((widths) => [...widths]);
    next[activeTableColumn.tableIndex] = updatedWidths;
    onColumnWidthsChange(next);
  }

  function splitParagraphIntoColumns() {
    if (!editor || !editor.isActive("paragraph")) return;
    const { state, view } = editor;
    const { $from } = state.selection;
    const paragraph = $from.parent;
    if (paragraph.type.name !== "paragraph" || $from.depth < 1) return;
    const schema = state.schema;
    let splitOffset = $from.parentOffset;
    if (splitOffset >= paragraph.content.size) {
      paragraph.content.forEach((node, offset) => {
        if (
          splitOffset === paragraph.content.size &&
          node.type.name === "printTemplateField"
        ) {
          splitOffset = offset;
        }
      });
    }
    const left = paragraph.content.cut(0, splitOffset);
    const right = paragraph.content.cut(splitOffset);
    const leftParagraph = schema.nodes.paragraph.create(null, left);
    const rightParagraph = schema.nodes.paragraph.create(null, right);
    const columns = schema.nodes.printTemplateColumns.create(null, [
      leftParagraph,
      rightParagraph,
    ]);
    const blockStart = $from.before($from.depth);
    const transaction = state.tr.replaceWith(
      blockStart,
      $from.after($from.depth),
      columns,
    );
    transaction.setSelection(
      TextSelection.near(
        transaction.doc.resolve(blockStart + 1 + leftParagraph.nodeSize + 2),
      ),
    );
    view.dispatch(transaction);
    view.focus();
  }

  function isAlignmentActive(alignment: "left" | "center" | "right") {
    if (!editor) return false;
    const cellAlignment =
      editor.getAttributes("tableCell").align ??
      editor.getAttributes("tableHeader").align;
    return (
      cellAlignment === alignment || editor.isActive({ textAlign: alignment })
    );
  }

  function openFieldMenu(event?: MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    if (!editable) return;
    setFieldSearch("");
    if (sourceMode) {
      const cursor =
        sourceRef.current?.selectionStart ?? normalizedValue.length;
      fieldRangeRef.current = { from: cursor, to: cursor };
    } else if (editor) {
      const cursor = editor.state.selection.from;
      fieldRangeRef.current = { from: cursor, to: cursor };
    }
    setFieldMenuOpen(true);
  }

  function insertField(field: PrintTemplateField) {
    const range = fieldRangeRef.current;
    const token = `{{${field.token}}}`;
    if (sourceMode) {
      const textarea = sourceRef.current;
      const from =
        range?.from ?? textarea?.selectionStart ?? normalizedValue.length;
      const to = range?.to ?? textarea?.selectionEnd ?? from;
      onChange(
        normalizedValue.slice(0, from) + token + normalizedValue.slice(to),
      );
      window.requestAnimationFrame(() => {
        const nextTextarea = sourceRef.current;
        const cursor = from + token.length;
        nextTextarea?.focus();
        nextTextarea?.setSelectionRange(cursor, cursor);
      });
    } else if (editor) {
      const command = editor.chain().focus();
      if (range) command.deleteRange(range);
      command
        .insertContent({
          type: PrintTemplateFieldNode.name,
          attrs: { token: field.token },
        })
        .run();
    }
    fieldRangeRef.current = null;
    setFieldMenuOpen(false);
    setFieldSearch("");
  }

  function trackSourceCursor(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "/") {
      const cursor = event.currentTarget.selectionStart;
      fieldRangeRef.current = { from: Math.max(0, cursor - 1), to: cursor };
      setFieldSearch("");
      setFieldMenuOpen(true);
    }
    if (event.key === "Escape") {
      setFieldMenuOpen(false);
      fieldRangeRef.current = null;
    }
  }

  return (
    <div className="print-template-low-code-editor">
      <div
        className="print-template-wysiwyg-toolbar"
        role="toolbar"
        aria-label="Định dạng mẫu in"
      >
        <button
          className={`print-template-source-toggle${sourceMode ? " is-active" : ""}`}
          type="button"
          aria-pressed={sourceMode}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setFieldMenuOpen(false);
            setSourceMode((current) => !current);
          }}
        >
          <Code2 size={15} aria-hidden="true" />
          {sourceMode ? "Soạn thảo" : "Nguồn"}
        </button>
        <span className="print-template-toolbar-divider" aria-hidden="true" />
        <label className="print-template-font-size-control">
          <span>Cỡ chữ</span>
          <select
            className="field"
            aria-label="Cỡ chữ"
            disabled={disabled || sourceMode}
            value={String(activeFontSize)}
            onChange={(event) =>
              editor
                ?.chain()
                .focus()
                .setMark(PrintTemplateFontSize.name, {
                  fontSize: normalizePrintTemplateFontSize(
                    event.currentTarget.value,
                  ),
                })
                .run()
            }
          >
            {PRINT_TEMPLATE_FONT_SIZES.map((fontSize) => (
              <option key={fontSize} value={fontSize}>
                {fontSize}
              </option>
            ))}
          </select>
        </label>
        <span className="print-template-toolbar-divider" aria-hidden="true" />
        <div
          className="print-template-alignment-controls"
          role="group"
          aria-label="Căn lề dòng"
        >
          <span className="print-template-toolbar-label">Căn lề</span>
          <FormatButton
            label="Căn trái"
            active={isAlignmentActive("left")}
            disabled={disabled || sourceMode}
            wide
            onClick={() => setAlignment("left")}
          >
            <AlignLeft size={15} aria-hidden="true" />
            Trái
          </FormatButton>
          <FormatButton
            label="Căn giữa"
            active={isAlignmentActive("center")}
            disabled={disabled || sourceMode}
            wide
            onClick={() => setAlignment("center")}
          >
            <AlignCenter size={15} aria-hidden="true" />
            Giữa
          </FormatButton>
          <FormatButton
            label="Căn phải"
            active={isAlignmentActive("right")}
            disabled={disabled || sourceMode}
            wide
            onClick={() => setAlignment("right")}
          >
            <AlignRight size={15} aria-hidden="true" />
            Phải
          </FormatButton>
        </div>
        <span className="print-template-toolbar-divider" aria-hidden="true" />
        <FormatButton
          label="In đậm"
          active={Boolean(editor?.isActive("bold"))}
          disabled={disabled || sourceMode}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold size={16} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          label="In nghiêng"
          active={Boolean(editor?.isActive("italic"))}
          disabled={disabled || sourceMode}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          label="Gạch chân"
          active={Boolean(editor?.isActive("underline"))}
          disabled={disabled || sourceMode}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <Underline size={16} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          label="Gạch ngang"
          active={Boolean(editor?.isActive("strike"))}
          disabled={disabled || sourceMode}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={16} aria-hidden="true" />
        </FormatButton>
        <span className="print-template-toolbar-divider" aria-hidden="true" />
        <FormatButton
          label="Tiêu đề cấp 2"
          active={Boolean(editor?.isActive("heading", { level: 2 }))}
          disabled={disabled || sourceMode}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 size={17} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          label="Danh sách dấu đầu dòng"
          active={Boolean(editor?.isActive("bulletList"))}
          disabled={disabled || sourceMode}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List size={16} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          label="Danh sách đánh số"
          active={Boolean(editor?.isActive("orderedList"))}
          disabled={disabled || sourceMode}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={16} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          label="Trích dẫn"
          active={Boolean(editor?.isActive("blockquote"))}
          disabled={disabled || sourceMode}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={16} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          label="Đường kẻ ngang"
          disabled={disabled || sourceMode}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        >
          <Minus size={16} aria-hidden="true" />
        </FormatButton>
        <span className="print-template-toolbar-spacer" />
        <FormatButton
          label="Hoàn tác"
          disabled={disabled || sourceMode || !editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 size={16} aria-hidden="true" />
        </FormatButton>
        <FormatButton
          label="Làm lại"
          disabled={disabled || sourceMode || !editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 size={16} aria-hidden="true" />
        </FormatButton>
        <button
          className="print-template-insert-field"
          type="button"
          disabled={!editable}
          onMouseDown={(event) => event.preventDefault()}
          onClick={openFieldMenu}
        >
          <span>/</span> Chèn trường
        </button>
        {!isInTable && editor?.isActive("paragraph") && (
          <button
            className="print-template-insert-field print-template-table-action"
            type="button"
            disabled={!editable}
            title="Chia dòng hiện tại thành hai cột"
            onMouseDown={(event) => event.preventDefault()}
            onClick={splitParagraphIntoColumns}
          >
            <Columns3 size={15} aria-hidden="true" />
            Chia dòng 2 cột
          </button>
        )}
        {isInTable && (
          <>
            {activeTableColumn && (
              <label className="print-template-column-width-control">
                <span>Cột {activeTableColumn.columnIndex + 1}</span>
                <input
                  type="range"
                  min={4}
                  max={100 - 4 * (activeTableColumn.columnCount - 1)}
                  step={1}
                  value={Math.round(activeColumnWidth)}
                  disabled={!editable || !onColumnWidthsChange}
                  aria-label={`Độ rộng cột ${activeTableColumn.columnIndex + 1}`}
                  title="Điều chỉnh độ rộng cột đang chọn"
                  onChange={(event) =>
                    resizeActiveColumn(Number(event.currentTarget.value))
                  }
                />
                <output>{Math.round(activeColumnWidth)}%</output>
              </label>
            )}
            <button
              className="print-template-insert-field print-template-table-action"
              type="button"
              disabled={!editable || !editor?.can().addRowAfter()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor?.chain().focus().addRowAfter().run()}
            >
              <Rows3 size={15} aria-hidden="true" />
              Thêm hàng
            </button>
            <button
              className="print-template-insert-field print-template-table-action"
              type="button"
              disabled={
                !editable ||
                (!editor?.can().addColumnAfter() && !editor?.can().splitCell())
              }
              title="Tách ô hoặc chèn cột sau ô hiện tại"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (!editor) return;
                const chain = editor.chain().focus();
                if (editor.can().splitCell()) chain.splitCell().run();
                else chain.addColumnAfter().run();
              }}
            >
              <Columns3 size={15} aria-hidden="true" />
              Tách ô / cột
            </button>
            <button
              className="print-template-insert-field print-template-table-action"
              type="button"
              disabled={!editable || !editor?.can().deleteColumn()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor?.chain().focus().deleteColumn().run()}
            >
              <Trash2 size={15} aria-hidden="true" />
              Xóa cột
            </button>
          </>
        )}
      </div>

      <div className="print-template-low-code-canvas">
        {editorColumnWidthRules && <style>{editorColumnWidthRules}</style>}
        {sourceMode ? (
          <textarea
            ref={sourceRef}
            className="print-template-source-textarea"
            aria-label="Nội dung mẫu in dạng Markdown"
            spellCheck
            readOnly={!editable}
            value={normalizedValue}
            onChange={(event) => onChange(event.currentTarget.value)}
            onKeyUp={(event) => {
              if (event.key === "/") trackSourceCursor(event);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") trackSourceCursor(event);
            }}
          />
        ) : (
          <EditorContent editor={editor} />
        )}
        {fieldMenuOpen && editable && (
          <div
            className="print-template-field-menu"
            role="dialog"
            aria-label="Chèn thông tin hóa đơn"
          >
            <label className="print-template-field-search">
              <Search size={16} aria-hidden="true" />
              <input
                ref={fieldSearchRef}
                value={fieldSearch}
                onChange={(event) => setFieldSearch(event.target.value)}
                placeholder="Tìm kiếm thông tin…"
                aria-label="Tìm thông tin để chèn"
              />
            </label>
            <div className="print-template-field-options">
              {Object.entries(fieldsByGroup).map(([group, fields]) => (
                <section key={group}>
                  <h3>{group}</h3>
                  {fields.map((field) => (
                    <button
                      key={field.token}
                      type="button"
                      title={field.description}
                      onClick={() => insertField(field)}
                    >
                      <code>{field.label}</code>
                      <span>{field.token}</span>
                    </button>
                  ))}
                </section>
              ))}
              {!Object.keys(fieldsByGroup).length && (
                <p className="muted">Không tìm thấy thông tin.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
