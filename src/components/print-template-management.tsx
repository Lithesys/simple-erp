"use client";

import MarkdownPreview from "@uiw/react-markdown-preview";
import rehypeSanitize from "rehype-sanitize";
import { FileText, Plus, Printer, Star, Trash2, X } from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { toast } from "react-toastify";
import { useQueryClient } from "@tanstack/react-query";
import { AppButton } from "@/components/app-button";
import { AppInput } from "@/components/app-input";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/confirm-dialog";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { ModalLayer } from "@/components/modal-layer";
import { ReceiptPrint } from "@/components/receipt-print";
import { PrintTemplateMarkdownEditor } from "@/components/print-template-markdown-editor";
import { useStoreBrand } from "@/components/store-brand-provider";
import { createClient } from "@/lib/data/client";
import {
  DEFAULT_PRINT_TEMPLATE,
  DEFAULT_PRINT_TEMPLATE_CONTENT,
  getPrintTemplateColumnWidths,
  PRINT_TEMPLATE_PREVIEW_DATA,
  renderPrintTemplate,
  setPrintTemplateColumnWidths,
  type PrintTemplate,
} from "@/lib/print-template";
import { PRINT_TEMPLATE_SANITIZE_SCHEMA } from "@/lib/print-template-sanitize";
import {
  PRINT_TEMPLATES_QUERY_KEY,
  usePrintTemplates,
} from "@/lib/use-print-templates";
import { printPage } from "@/lib/print-page";

type TemplateDraft = PrintTemplate & { id: string };

function newTemplateDraft(): TemplateDraft {
  return {
    ...DEFAULT_PRINT_TEMPLATE,
    id: "",
    name: "Mẫu in mới",
    content: DEFAULT_PRINT_TEMPLATE_CONTENT,
    is_default: false,
  };
}

function paperName(width: number) {
  return width === 210 ? "A4" : `${width} mm`;
}

export function PrintTemplateManagement({
  canCreate,
  canUpdate,
  canDelete,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { displayName } = useStoreBrand();
  const { templates, userId, loading, error: loadError } = usePrintTemplates();
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[][]>([]);
  const columnWidthsRef = useRef<number[][]>([]);
  const [sourceWasDefault, setSourceWasDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const [templateToDelete, setTemplateToDelete] =
    useState<PrintTemplate | null>(null);

  const openTemplate = useCallback((template: PrintTemplate) => {
    setDraft({ ...template });
    const widths = getPrintTemplateColumnWidths(template.content);
    columnWidthsRef.current = widths;
    setColumnWidths(widths);
    setSourceWasDefault(template.is_default);
    setFormError("");
  }, []);

  function openCreate() {
    setDraft(newTemplateDraft());
    columnWidthsRef.current = [];
    setColumnWidths([]);
    setSourceWasDefault(false);
    setFormError("");
  }

  function closeEditor() {
    if (busy) return;
    setDraft(null);
    setFormError("");
  }

  function updateDraft<K extends keyof TemplateDraft>(
    field: K,
    value: TemplateDraft[K],
  ) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateContent(value: string) {
    updateDraft(
      "content",
      setPrintTemplateColumnWidths(value, columnWidthsRef.current),
    );
  }

  function updateColumnWidths(widths: number[][]) {
    columnWidthsRef.current = widths;
    setColumnWidths(widths);
    setDraft((current) =>
      current
        ? {
            ...current,
            content: setPrintTemplateColumnWidths(current.content, widths),
          }
        : current,
    );
  }

  const isNewDraft = draft?.id === "";
  const canEditContent = canUpdate || (isNewDraft && canCreate);

  async function invalidateTemplates() {
    await queryClient.invalidateQueries({
      queryKey: PRINT_TEMPLATES_QUERY_KEY,
    });
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    if (!userId) {
      setFormError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      return;
    }
    const name = draft.name.trim();
    if (!name) {
      setFormError("Vui lòng nhập tên mẫu in.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const now = new Date().toISOString();
      const values = {
        name,
        content: draft.content,
        paper_width_mm: draft.paper_width_mm,
        paper_orientation: draft.paper_orientation,
        updated_at: now,
        updated_by: userId,
      };
      let savedId = draft.id;
      if (savedId) {
        const { error } = await supabase
          .from("print_templates")
          .update(values)
          .eq("id", savedId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("print_templates")
          .insert({ ...values, created_by: userId })
          .select("id")
          .single();
        if (error) throw error;
        savedId = data.id;
      }

      if (draft.is_default && !sourceWasDefault) {
        const { error } = await supabase.rpc("set_default_print_template", {
          p_template_id: savedId,
        });
        if (error) throw error;
      }

      await invalidateTemplates();
      const savedTemplate = {
        ...draft,
        ...values,
        id: savedId,
        name,
        is_default: draft.is_default || sourceWasDefault,
      } as PrintTemplate;
      setDraft(savedTemplate);
      setSourceWasDefault(savedTemplate.is_default);
      toast.success("Đã lưu mẫu in.");
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Không lưu được mẫu in.",
      );
    } finally {
      setBusy(false);
    }
  }

  function requestDelete(template: PrintTemplate) {
    if (template.is_default) return;
    setTemplateToDelete(template);
    setConfirmRequest({
      title: "Xóa mẫu in",
      message: `Bạn có chắc muốn xóa mẫu “${template.name}”?`,
      confirmLabel: "Xóa mẫu",
    });
  }

  async function deleteTemplate() {
    if (!templateToDelete) return;
    const { error } = await supabase
      .from("print_templates")
      .delete()
      .eq("id", templateToDelete.id);
    setConfirmRequest(null);
    setTemplateToDelete(null);
    if (error) {
      toast.error(error.message || "Không xóa được mẫu in.");
      return;
    }
    await invalidateTemplates();
    if (draft?.id === templateToDelete.id) setDraft(null);
    toast.success("Đã xóa mẫu in.");
  }

  const previewSource = useMemo(() => {
    if (!draft) return "";
    return renderPrintTemplate(draft.content, {
      ...PRINT_TEMPLATE_PREVIEW_DATA,
      storeName: displayName,
    });
  }, [displayName, draft]);
  const paperWidthMm = draft
    ? draft.paper_width_mm === 210 && draft.paper_orientation === "landscape"
      ? 297
      : draft.paper_width_mm
    : 80;
  const paperHeightMm = draft
    ? draft.paper_width_mm === 210
      ? draft.paper_orientation === "landscape"
        ? 210
        : 297
      : null
    : null;
  const canSave = isNewDraft ? canCreate : canUpdate;
  const columnWidthRules = columnWidths
    .flatMap((widths, tableIndex) =>
      widths.map((width, columnIndex) => {
        if (!width) return "";
        const safeWidth = Math.max(1, Math.min(99, width)).toFixed(2);
        const selector = `table:nth-of-type(${tableIndex + 1}) :is(th, td):nth-child(${columnIndex + 1})`;
        return `.print-template-preview-paper .wmde-markdown ${selector} { width: ${safeWidth}% !important; }`;
      }),
    )
    .filter(Boolean)
    .join("\n");

  return (
    <>
      <section className="print-template-page">
        <header className="print-template-page__header">
          <div>
            <h1>Mẫu in</h1>
            <p className="muted">
              Tạo và chỉnh sửa mẫu hóa đơn dùng chung cho cửa hàng.
            </p>
          </div>
          {canCreate && (
            <AppButton type="button" variant="primary" onClick={openCreate}>
              <Plus size={17} aria-hidden="true" />
              Thêm mẫu in
            </AppButton>
          )}
        </header>

        {loadError && (
          <div className="alert" role="alert">
            {loadError instanceof Error
              ? loadError.message
              : "Không tải được danh sách mẫu in."}
          </div>
        )}
        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : templates.length ? (
          <div className="print-template-grid">
            {templates.map((template) => (
              <article
                className={`print-template-card${template.is_default ? " is-default" : ""}`}
                key={template.id}
              >
                <button
                  className="print-template-card__open"
                  type="button"
                  onClick={() => openTemplate(template)}
                >
                  <span className="print-template-card__icon">
                    <FileText size={21} aria-hidden="true" />
                  </span>
                  <span className="print-template-card__copy">
                    <span className="print-template-card__title">
                      {template.name}
                    </span>
                    <span className="print-template-card__meta">
                      Khổ {paperName(template.paper_width_mm)} ·{" "}
                      {template.paper_orientation === "portrait"
                        ? "Dọc"
                        : "Ngang"}
                    </span>
                    <span className="print-template-card__excerpt">
                      {template.content.replace(/\s+/g, " ").trim()}
                    </span>
                  </span>
                  {template.is_default && (
                    <span className="print-template-default-badge">
                      <Star size={13} aria-hidden="true" />
                      Đang dùng
                    </span>
                  )}
                </button>
                {canDelete && (
                  <div className="print-template-card__actions">
                    <AppButton
                      type="button"
                      variant="ghost"
                      disabled={template.is_default}
                      title={
                        template.is_default
                          ? "Hãy đặt mẫu khác làm mặc định trước khi xóa."
                          : "Xóa mẫu in"
                      }
                      aria-label={`Xóa mẫu ${template.name}`}
                      onClick={() => requestDelete(template)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </AppButton>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="print-template-empty card">
            <FileText size={30} aria-hidden="true" />
            <h2>Chưa có mẫu in</h2>
            <p className="muted">
              Tạo mẫu mới để định dạng hóa đơn theo khổ giấy của cửa hàng.
            </p>
          </div>
        )}

        <ModalLayer
          open={draft !== null}
          className="modal-backdrop no-print print-template-modal-backdrop"
          onEscape={closeEditor}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          {draft && (
            <form
              className="print-template-editor-modal"
              onSubmit={saveTemplate}
              aria-label={isNewDraft ? "Tạo mẫu in" : "Chỉnh sửa mẫu in"}
            >
              <header className="print-template-modal__header">
                <strong>
                  {isNewDraft ? "Tạo mẫu in" : "Chỉnh sửa mẫu in"}
                </strong>
                <AppInput
                  className="field print-template-name"
                  aria-label="Tên mẫu in"
                  value={draft.name}
                  maxLength={80}
                  disabled={!canSave || busy}
                  onChange={(event) => updateDraft("name", event.target.value)}
                />
                <div className="print-template-modal__actions">
                  <AppButton
                    type="button"
                    variant="secondary"
                    disabled={!canUpdate || busy}
                    onClick={() => {
                      columnWidthsRef.current = [];
                      setColumnWidths([]);
                      updateDraft("content", DEFAULT_PRINT_TEMPLATE_CONTENT);
                    }}
                  >
                    Đặt lại
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="secondary"
                    className="print-template-modal__print-button"
                    iconLeft={<Printer size={16} />}
                    onClick={printPage}
                  >
                    In thử
                  </AppButton>
                  {canSave && (
                    <AppButton type="submit" variant="primary" disabled={busy}>
                      {busy ? "Đang lưu…" : "Lưu mẫu"}
                    </AppButton>
                  )}
                  <AppButton
                    type="button"
                    variant="ghost"
                    iconOnly
                    aria-label="Đóng"
                    title="Đóng"
                    onClick={closeEditor}
                  >
                    <X size={19} aria-hidden="true" />
                  </AppButton>
                </div>
              </header>

              <div className="print-template-modal__body">
                <section className="print-template-editor-pane">
                  <div className="print-template-editor-toolbar">
                    <label>
                      Khổ giấy
                      <select
                        className="field"
                        value={draft.paper_width_mm}
                        disabled={!canEditContent || busy}
                        onChange={(event) =>
                          updateDraft(
                            "paper_width_mm",
                            Number(
                              event.target.value,
                            ) as TemplateDraft["paper_width_mm"],
                          )
                        }
                      >
                        <option value={58}>58 mm</option>
                        <option value={80}>80 mm</option>
                        <option value={210}>A4</option>
                      </select>
                    </label>
                    <label>
                      Hướng giấy
                      <select
                        className="field"
                        value={draft.paper_orientation}
                        disabled={!canEditContent || busy}
                        onChange={(event) =>
                          updateDraft(
                            "paper_orientation",
                            event.target
                              .value as TemplateDraft["paper_orientation"],
                          )
                        }
                      >
                        <option value="portrait">Khổ dọc</option>
                        <option value="landscape">Khổ ngang</option>
                      </select>
                    </label>
                    <span className="print-template-slash-help">
                      Gõ / để chèn thông tin
                    </span>
                    {!isNewDraft && canUpdate && (
                      <label className="print-template-default-toggle">
                        <AppInput
                          type="checkbox"
                          checked={draft.is_default}
                          disabled={sourceWasDefault || busy}
                          onChange={(event) =>
                            updateDraft("is_default", event.target.checked)
                          }
                        />
                        Dùng làm mẫu mặc định
                      </label>
                    )}
                    {isNewDraft && canUpdate && (
                      <label className="print-template-default-toggle">
                        <AppInput
                          type="checkbox"
                          checked={draft.is_default}
                          disabled={busy}
                          onChange={(event) =>
                            updateDraft("is_default", event.target.checked)
                          }
                        />
                        Dùng làm mẫu mặc định
                      </label>
                    )}
                  </div>
                  {formError && (
                    <div className="alert" role="alert">
                      {formError}
                    </div>
                  )}
                  <div
                    className="print-template-markdown-editor"
                    data-color-mode="light"
                    style={
                      {
                        "--print-paper-width": `${paperWidthMm}mm`,
                        "--print-paper-height": paperHeightMm
                          ? `${paperHeightMm}mm`
                          : "600px",
                      } as CSSProperties
                    }
                  >
                    <PrintTemplateMarkdownEditor
                      value={draft.content}
                      editable={canEditContent && !busy}
                      onChange={updateContent}
                      columnWidths={columnWidths}
                      onColumnWidthsChange={updateColumnWidths}
                    />
                  </div>
                </section>

                <aside className="print-template-preview-pane">
                  <div className="print-template-preview-toolbar">
                    <strong>Xem trước mẫu in</strong>
                    {draft.is_default && (
                      <span className="print-template-default-badge">
                        <Star size={13} aria-hidden="true" />
                        Mặc định
                      </span>
                    )}
                  </div>
                  <div className="print-template-preview-scroll">
                    <div
                      className={`print-template-preview-paper paper-${draft.paper_width_mm}-${draft.paper_orientation}`}
                      style={
                        {
                          "--print-paper-width": `${paperWidthMm}mm`,
                          "--print-paper-height": paperHeightMm
                            ? `${paperHeightMm}mm`
                            : "600px",
                        } as CSSProperties
                      }
                      data-color-mode="light"
                    >
                      {columnWidthRules && <style>{columnWidthRules}</style>}
                      <MarkdownPreview
                        source={previewSource}
                        rehypePlugins={[
                          [rehypeSanitize, PRINT_TEMPLATE_SANITIZE_SCHEMA],
                        ]}
                      />
                    </div>
                  </div>
                </aside>
              </div>
            </form>
          )}
        </ModalLayer>

        <ConfirmDialog
          request={confirmRequest}
          onCancel={() => {
            setConfirmRequest(null);
            setTemplateToDelete(null);
          }}
          onConfirm={() => void deleteTemplate()}
        />
      </section>
      {draft && (
        <ReceiptPrint
          receipt={PRINT_TEMPLATE_PREVIEW_DATA.receipt}
          items={PRINT_TEMPLATE_PREVIEW_DATA.items}
          templateOverride={draft}
        />
      )}
    </>
  );
}
