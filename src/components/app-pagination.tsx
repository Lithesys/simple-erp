import { AppButton } from "@/components/app-button";

export function AppPagination({
  page,
  pageSize,
  totalRows,
  onPageChange,
  disabled = false,
}: {
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <nav className="pagination" aria-label="Phân trang">
      <span>
        Trang {page + 1} / {pageCount}
      </span>
      <div className="pagination-actions">
        <AppButton
          variant="secondary"
          type="button"
          disabled={disabled || page === 0}
          onClick={() => onPageChange(Math.max(0, page - 1))}
        >
          Trước
        </AppButton>
        <AppButton
          variant="secondary"
          type="button"
          disabled={disabled || (page + 1) * pageSize >= totalRows}
          onClick={() => onPageChange(page + 1)}
        >
          Sau
        </AppButton>
      </div>
    </nav>
  );
}
