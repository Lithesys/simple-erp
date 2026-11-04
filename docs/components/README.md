# UI components

Tài liệu này mô tả các component dùng chung, quy ước CSS và cách ghép chúng thành giao diện. Các component theo từng nghiệp vụ như `ProductManagement` hoặc `OrdersManagement` là màn hình, không phải primitive dùng chung.

## Input và field

- **`AppInput`** ([source](../../src/components/app-input.tsx)) — input dùng chung cho ứng dụng, tự áp dụng kiểu `.field` và nhận `iconLeft` hoặc `iconRight` để đặt icon bên trong ô nhập. Dùng `wrapperClassName` khi cần điều chỉnh shell có icon; giữ `className` cho input.
- **`SearchInputField`** ([source](../../src/components/search-input-field.tsx)) — input có kính lúp bên trong, nhận `value` và `onChange(value)`, tùy chọn `onClear`, props HTML input và `ref`. Dùng cho tìm kiếm có nút xóa nội dung.
- **`NumberInputField`** ([source](../../src/components/number-input-field.tsx)) — xây trên `AppInput`, hiển thị dấu phân nhóm hàng nghìn, hỗ trợ số thập phân tối đa 3 chữ số, `min`, `step`, nhấn focus để chọn toàn bộ giá trị và chuẩn hóa giá trị rỗng khi blur. Kiểm tra nghiệp vụ trước khi lưu vẫn thuộc về form gọi component.
- **React Hook Form** — dùng `useForm` cho dữ liệu và submit của mọi form; `register` cho input native, `Controller` cho `AppSelect`, `NumberInputField` và component có state điều khiển. Kiểm tra nghiệp vụ và quyền lưu vẫn thuộc về màn hình hoặc module nghiệp vụ.
- **`AppSelect`** ([source](../../src/components/app-select.tsx)) — wrapper `react-select` theo design token của ứng dụng. Hỗ trợ đơn lựa chọn, multi-select, tìm kiếm, xóa lựa chọn và disabled. Menu render qua portal để tránh bị cắt bởi modal hoặc vùng cuộn; truyền `ariaLabel` và `options` rõ ràng.
- **`DateRangeInput`** ([source](../../src/components/date-range-input.tsx)) — chọn khoảng ngày theo locale tiếng Việt; trả ngày theo `YYYY-MM-DD` qua `onChange(start, end)`. Danh sách preset dùng chung được tính theo múi giờ ứng dụng tại [date-range-presets.ts](../../src/lib/date-range-presets.ts), gồm các khoảng ngày/tuần/tháng và năm âm lịch, dương lịch. Mũi tên popover căn theo trường chọn; nút **Áp dụng** trả lựa chọn ngay cho màn hình gọi component. Trên mobile, preset cuộn ngang và lịch chỉ hiển thị một tháng. Đơn hàng tải lại danh sách và cập nhật URL ngay, còn Dashboard và Nhập hàng tải lại số liệu theo khoảng ngày mới.
- **`formatDate` / `formatDateTime`** ([source](../../src/lib/date.ts)) — định dạng ngày và thời điểm hiển thị nhất quán theo giờ Việt Nam.

## Filter và tìm kiếm

- **Filter sidebar của bảng** — bắt buộc theo [quy chuẩn bảng](../table-guidelines.md). Các wrapper hiện có còn một số cấu trúc theo trang; khi tạo hoặc thay đổi sidebar, trích xuất/dùng wrapper React chung trong `src/components/` cùng thay đổi. Không mở rộng markup sidebar riêng theo trang.
- **Filter có popover** — dùng khi filter cần mở theo yêu cầu, như trang Đơn hàng và Nhập hàng. Nút trigger hiển thị kính lúp và `SlidersHorizontal`; popover neo dưới khung filter bằng `.orders-filter-panel`. Quản lý `aria-expanded`/`aria-controls`, đóng khi nhấn Escape hoặc bấm ra ngoài, và giữ các field draft hoặc cập nhật tức thời theo hành vi nghiệp vụ của trang. Bộ lọc mã, hàng hóa và trạng thái của Nhập hàng là draft, chỉ tải lại danh sách khi bấm **Áp dụng**; filter ngày chọn bằng `DateRangeInput` áp dụng theo nút riêng của nó. Ngày Nhập hàng lọc theo `created_at`, tách biệt với ngày nhập/duyệt; xem hợp đồng tại [RPC functions](../functions/README.md).
- **`CustomerPicker`** ([source](../../src/components/customer-picker.tsx)) — trường tên khách hàng với gợi ý từ danh bạ, chọn bằng bàn phím, có thể nhập khách lẻ, và tùy chọn hiển thị số điện thoại/địa chỉ. Quyền bật gợi ý và quyền truy cập dữ liệu do màn hình gọi quyết định.
- **`SearchInputField`** cũng là primitive tìm kiếm trong filter, POS và picker; tránh tự dựng icon kính lúp và nút xóa riêng nếu component hiện tại đáp ứng.

## Bảng và dữ liệu

Mọi bảng phải tuân theo [quy chuẩn bắt buộc về bảng](../table-guidelines.md), gồm row detail, pagination, filter sidebar và toolbar.

- **`AppTable`** ([source](../../src/components/app-table.tsx)) — bảng dùng chung có các slot `heading`, `toolbarSummary`, `tools` và `summary`. `AppTable.Header` nhận cột với `title`, `sortable`, `draggable`, `align`, và `total`; truyền `sort`, `onSortChange`, `onColumnMove` để bật sort API và kéo thả cột. `AppTable.Body` nhận `rows`, `columns`, `rowKey`, trạng thái `empty`, và tùy chọn `renderRow`/`renderCell` cho dòng đặc thù. Dùng `AppTable.Row`/`AppTable.Cell` khi tự dựng markup; zebra mặc định dùng dòng lẻ trong suốt và dòng chẵn xanh nhạt trong suốt, có thể tắt bằng `striped={false}`.
- **`DataTable`** ([source](../../src/components/data-table.tsx)) — tiện ích nghiệp vụ xây trên `AppTable`, giữ menu ẩn/hiện cột, thứ tự cột lưu theo từng bảng, menu gom thao tác và sort API. Cấu hình qua `DataColumn<T>`; `value` bật sort mặc định, `sortable: false` tắt sort, `draggable: false` giữ cố định cột. Dùng `total` cho tổng API từng cột (`summary` vẫn được hỗ trợ tương thích), `totalRows` cho số kết quả API, `toolbarSummary` cho số liệu trên thanh công cụ, và `summary` cho nội dung tổng kết phía dưới bảng. `initialVisible` đặt tập cột khởi tạo; đặt `persistVisibleColumns={false}` cho chế độ hiển thị theo URL để không đọc/ghi đè tùy chọn ẩn/hiện đã lưu.
- **`AppPagination`** ([source](../../src/components/app-pagination.tsx)) — phân trang dùng chung, nhận chỉ số trang từ 0 cùng page size và tổng số dòng.
- **`MobileTableToolbarMetrics`** ([source](../../src/components/mobile-table-toolbar-metrics.tsx)) — summary dạng metric cards dùng chung trên mobile.
- Bảng tự dựng bằng `AppTable` có thể truyền `<thead>`/`<tbody>` riêng hoặc dùng `AppTable.Header`/`AppTable.Body`. Tổng của tập dữ liệu có phân trang hoặc giới hạn phải đến từ API; chỉ giữ phép cộng phía trình duyệt cho dữ liệu chi tiết đã tải đầy đủ hoặc giá trị đang thay đổi trong form.

```tsx
import { AppButton } from "@/components/app-button";
import { AppTable, type AppTableColumn } from "@/components/app-table";

type InventoryRow = { id: string; sku: string; stock: number };
const columns: AppTableColumn<InventoryRow>[] = [
  {
    key: "sku",
    title: "Mã hàng",
    sortable: true,
    draggable: true,
    render: (row) => row.sku,
  },
  {
    key: "stock",
    title: "Tồn kho",
    sortable: true,
    align: "right",
    total: stockTotal,
    render: (row) => row.stock.toLocaleString("vi-VN"),
  },
];

<AppTable
  heading="Hàng hóa"
  toolbarSummary={<span>{totalRows} mặt hàng</span>}
  tools={<AppButton variant="default">Cột</AppButton>}
  summary={<strong>Tồn kho: {stockTotal}</strong>}
>
  <AppTable.Header
    columns={columns}
    sort={sort}
    onSortChange={setSort}
    onColumnMove={moveColumn}
    totalRows={totalRows}
  />
  <AppTable.Body
    rows={rows}
    columns={columns}
    rowKey={(row) => row.id}
    empty="Không có dữ liệu"
    renderRow={(row, index, columns) => (
      <AppTable.Row index={index}>
        {columns.map((column) => (
          <AppTable.Cell key={column.key} align={column.align}>
            {column.render?.(row)}
          </AppTable.Cell>
        ))}
      </AppTable.Row>
    )}
  />
</AppTable>
```

- `storageKey` tạo vùng lưu cài đặt cột theo bảng trong `localStorage`. Dùng key ổn định và riêng cho mỗi bảng.
- **`LoadingSkeleton`** ([source](../../src/components/loading-skeleton.tsx)) — trạng thái tải có số dòng tùy chọn; dùng thay cho nội dung bảng khi dữ liệu đang tải.
- **`usePreference`** ([source](../../src/lib/preferences.ts)) — lưu tùy chọn giao diện của trình duyệt, đang được dùng cho filter và trạng thái sắp xếp bảng. Không dùng thay cho dữ liệu nghiệp vụ trên máy chủ.
- **`AppProviders`** ([source](../../src/components/app-providers.tsx)) — khởi tạo React Query và React DnD ở phạm vi ứng dụng; cache mặc định và cấu hình provider nằm tại đây.

## Buttons, menus và dialogs

- **`AppButton`** ([source](../../src/components/app-button.tsx)) — dùng cho mọi nút trong giao diện. `variant` nhận `primary`, `secondary`, `ghost`, `danger`, `default`; `iconLeft` và `iconRight` đặt icon hai bên nội dung. Component có trạng thái hover, active, focus-visible và disabled. Dùng `type="button"` cho nút không gửi form; nút chỉ có icon cần `aria-label`. Không tạo nút HTML hoặc kiểu nút riêng trong màn hình.
- **`ConfirmDialog`** ([source](../../src/components/confirm-dialog.tsx)) — hộp xác nhận truy cập được với `role="alertdialog"`, nhãn và mô tả liên kết; nhận request và callback hủy/xác nhận.
- **Modal nghiệp vụ** — các màn hình hiện tự ghép `.modal-backdrop`, `.modal` và `.modal-title` cho form/chi tiết đặc thù. Giữ xử lý đóng, focus và nội dung trong component sở hữu nghiệp vụ; chuyển sang component dùng chung khi có ít nhất hai luồng chung ổn định.
- **Action menu** — `DataTable` hiển thị tối đa hai thao tác trực tiếp; nhiều thao tác hơn sẽ được gom vào menu, có đóng bằng Escape hoặc bấm ngoài.
- **Toasts** — thông báo thành công/lỗi dùng `react-toastify` (`toast.success`, `toast.error`) sau thao tác nghiệp vụ; lỗi cần sửa tại form vẫn nên hiển thị cạnh form.

## App shell và màn hình

- **`AppFrame`** ([source](../../src/components/app-frame.tsx)) — khung điều hướng, trạng thái đăng nhập và lọc mục menu theo quyền. Trên `/pos`, `PosOrderTabs` dùng `PosOrderTabsProvider` để giữ từng hóa đơn độc lập và lưu bản nháp theo tài khoản vào `localStorage` sau 2 giây không có thay đổi.
- **`AppProviders`** — provider cache và kéo thả bao quanh ứng dụng.
- `PointOfSale`, `ProductManagement`, `PurchaseManagement`, `OrdersManagement`, `CustomerManagement`, `AccountManagement`, `AccountSettings`, `PriceListManagement`, và `RoleManagement` là các màn hình nghiệp vụ. Giữ truy cập dữ liệu, quyền, và quy tắc lưu trong màn hình hoặc module nghiệp vụ tương ứng; chỉ trích xuất UI khi hành vi thực sự dùng chung.

## Quy ước mở rộng

- Tất cả nút, ô nhập HTML và bảng trong ứng dụng dùng `AppButton`, `AppInput` và `AppTable`. Các field nghiệp vụ như tìm kiếm, số và ngày phải ghép từ primitive chung; không tạo markup điều khiển mới trong màn hình.
- Ưu tiên tái sử dụng component hoặc token hiện có trước khi thêm biến thể mới.
- Màu sắc, typography, bo góc và trạng thái focus lấy từ [design system](../design-system.md); không thêm màu tùy ý trong trang nếu đã có token tương ứng.
- Giữ nhãn và trạng thái tương tác truy cập được (`aria-label`, `aria-expanded`, `aria-controls`, focus rõ ràng); icon chỉ trang trí cần ẩn khỏi cây trợ năng.
- Khi thay đổi hành vi của component dùng chung, cập nhật tài liệu này và các màn hình gọi component liên quan.
