"use client";

import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  EditorContent,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Search,
  Strikethrough,
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
  PRINT_TEMPLATE_FIELDS,
  type PrintTemplateField,
} from "@/lib/print-template";
import {
  PrintTemplateMarkdownBold,
  PrintTemplateMarkdownItalic,
  PrintTemplateMarkdownStrike,
  PrintTemplateFieldNode,
  PrintTemplateMarkdownUnderline,
} from "@/lib/print-template-editor";

const InteractivePrintTemplateField = PrintTemplateFieldNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PrintTemplateFieldView);
  },
});

type TextRange = { from: number; to: number };

function groupedFields(search: string) {
  const filtered = PRINT_TEMPLATE_FIELDS.filter((field) =>
    `${field.label} ${field.token} ${field.group}`
      .toLocaleLowerCase("vi")
      .includes(search.trim().toLocaleLowerCase("vi")),
  );
  return filtered.reduce<Record<string, PrintTemplateField[]>>(
    (groups, field) => {
      (groups[field.group] ??= []).push(field);
      return groups;
    },
    {},
  );
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
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`print-template-format-button${active ? " is-active" : ""}`}
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
}: {
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  const [sourceMode, setSourceMode] = useState(false);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");
  const [, setSelectionVersion] = useState(0);
  const fieldRangeRef = useRef<TextRange | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const fieldSearchRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const editableRef = useRef(editable);
  const fieldMenuOpenRef = useRef(fieldMenuOpen);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bold: false,
        italic: false,
        strike: false,
        underline: false,
      }),
      PrintTemplateMarkdownBold,
      PrintTemplateMarkdownItalic,
      PrintTemplateMarkdownStrike,
      PrintTemplateMarkdownUnderline,
      Markdown.configure({ markedOptions: { gfm: true } }),
      InteractivePrintTemplateField,
    ],
    [],
  );

  const editor = useEditor(
    {
      extensions,
      content: value,
      contentType: "markdown",
      editable,
      immediatelyRender: false,
      onUpdate: ({ editor: currentEditor }) =>
        onChangeRef.current(currentEditor.getMarkdown()),
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
    editableRef.current = editable;
    fieldMenuOpenRef.current = fieldMenuOpen;
    editorRef.current = editor;
  }, [editable, editor, fieldMenuOpen, onChange]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
    if (!sourceMode && editor.getMarkdown() !== value) {
      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
  }, [editable, editor, sourceMode, value]);

  useEffect(() => {
    if (fieldMenuOpen) fieldSearchRef.current?.focus();
  }, [fieldMenuOpen]);

  const fieldsByGroup = groupedFields(fieldSearch);
  const disabled = !editable || !editor;

  function openFieldMenu(event?: MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    if (!editable) return;
    setFieldSearch("");
    if (sourceMode) {
      const cursor = sourceRef.current?.selectionStart ?? value.length;
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
      const from = range?.from ?? textarea?.selectionStart ?? value.length;
      const to = range?.to ?? textarea?.selectionEnd ?? from;
      onChange(value.slice(0, from) + token + value.slice(to));
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
      </div>

      <div className="print-template-low-code-canvas">
        {sourceMode ? (
          <textarea
            ref={sourceRef}
            className="print-template-source-textarea"
            aria-label="Nội dung mẫu in dạng Markdown"
            spellCheck
            readOnly={!editable}
            value={value}
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
