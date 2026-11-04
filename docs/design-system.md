# Design system

## Nguồn và phạm vi

`src/app/tokens.css` là nguồn duy nhất cho giá trị màu. `src/app/globals.css` dùng token cho các lớp chung; component dùng `var(--...)` khi cần inline style. Token áp dụng cho đăng nhập, bán hàng, quản lý, tài khoản và hóa đơn in.

## Màu

| Token              | Giá trị   | Sử dụng                                |
| ------------------ | --------- | -------------------------------------- |
| `--primary`        | `#0070F4` | Thanh trên, nút chính, tổng thanh toán |
| `--secondary`      | `#677484` | Nút phụ và nút In                      |
| `--text-primary`   | `#15171A` | Nội dung                               |
| `--text-secondary` | `#525D6A` | Chú thích                              |
| `--text-icon`      | `#292E35` | Thao tác icon                          |
| `--surface`        | `#FFFFFF` | Panel, ô nhập                          |
| `--surface-subtle` | `#F7F8F9` | Vùng phụ                               |
| `--background`     | `#F0F1F3` | Nền trang, tìm khách                   |
| `--background-end` | `#E8EAED` | Cuối gradient nền                      |

Màu trạng thái bổ sung gồm `--success`, `--warning`, `--danger` và nền `*-subtle`; đường viền dùng `--border`, `--border-subtle`. Hóa đơn dùng `--print-text`, `--print-border` để giữ độ tương phản khi in. Backdrop dùng `--overlay`, nền trắng bán trong suốt dùng `--surface-overlay`.

## Font, khoảng cách và bo góc

Roboto được nạp một lần bằng `next/font/google` trong root layout, có subset Latin và tiếng Việt, `display: swap`, rồi phục vụ từ ứng dụng. Build cần truy cập Google Fonts để tải font. Font fallback là Helvetica, Arial, sans-serif. Dự án tiếp tục dùng Lucide; không cần Font Awesome Pro hay font Inter của widget hỗ trợ.

- Chữ: `--font-size-sm` 13px, `--font-size-base` 14px, `--font-size-md` 16px, `--font-size-lg` 18px; line-height 1.4.
- Độ đậm: `--weight-regular` 400, `--weight-medium` 500, `--weight-bold` 700.
- Khoảng cách: `--space-1` đến `--space-6`: 4, 8, 12, 16, 20, 24px.
- Bo góc: input 5px, button 8px, lớn 10px, panel phụ 12px, tròn 999px.
- Bóng: `--shadow-card`, `--shadow-search`, `--shadow-focus`.

Ô `.field` trong POS dùng chiều cao 32px và chữ 12px; các select React và menu ngày theo cùng kích thước, màu và focus state. Khu vực quản trị dùng chiều cao compact 34px. Hóa đơn in và bảng giữ kích thước chữ chuyên biệt.

## Bố cục quản trị compact

Các trang quản trị dùng thanh tiện ích 48px và navbar xanh 47px. Nội dung bắt đầu với lề 16px. Bảng hàng hóa dùng panel lọc 264px và khoảng cách 10px trên desktop; dưới 980px panel thu còn 220px, dưới 720px panel xếp lên trên bảng. Header và dòng bảng cao 44px, control compact cao 34px. Các số đo này là token `--utility-bar-height`, `--primary-nav-height`, `--page-inset`, `--filter-panel-width`, `--table-row-height` và `--control-height-compact`.

Panel có tìm theo tên và lọc Tất cả / Còn hàng / Hết hàng. Lọc được áp dụng ở truy vấn dữ liệu và lưu cùng tham số URL; Xóa bộ lọc đặt lại cả từ khóa lẫn trạng thái tồn. Các cột giá và tồn kho canh phải.

## Thành phần và trạng thái

- Mọi modal và sheet dạng lớp phủ phải render backdrop bằng `ModalLayer`. Component này portal lớp phủ vào `document.body` và sắp xếp các modal đang mở theo thứ tự, để modal mở sau luôn nằm trên modal đang mở trước đó. `--z-modal` trong `tokens.css` là lớp nền chung, `--z-modal-popover` dành cho dropdown/date picker bên trong modal; không đặt z-index riêng cho từng modal.
- Dùng `AppButton` cho nút; biến thể gồm primary, secondary, ghost, danger và default. Icon dùng `iconLeft`/`iconRight`; kích thước đặc thù giữ qua class bổ sung trên component.
- `AppButton` cung cấp hover, active, focus-visible và disabled theo token; không dựng style nút mới trong từng màn hình.
- `AppInput` là primitive của input HTML, có `iconLeft`/`iconRight`; `SearchInputField`, `NumberInputField` và `DateRangeInput` dùng chung primitive này.
- Dùng `AppTable` cho bảng HTML dựng trong giao diện: có slot tiêu đề, công cụ, tổng kết; `AppTable.Header` cấu hình title/sort/kéo thả/tổng cột, `AppTable.Body` cho dòng chuẩn hoặc render dòng đặc thù. Zebra dòng lẻ trong suốt và dòng chẵn xanh nhạt trong suốt bật mặc định. `DataTable` ghép các primitive này với ẩn/hiện cột và sort server.
- `.field` quản trị: cao 34px, padding ngang 10px, bo góc 8px. `.card`, `.pos-panel`: nền surface.

Hover, focus và disabled là **quy ước bổ sung của dự án**, chưa được xác minh với KiotViet: hover dùng `--primary-hover`/`--secondary-hover`; focus bàn phím có outline; disabled giảm opacity và đổi con trỏ. Focus trên thanh xanh dùng outline trắng.

## Cách sử dụng

```css
.example {
  color: var(--text-primary);
  background: var(--surface);
  border: 1px solid var(--border);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
}
```

```tsx
import { ArrowRight, Save, Search } from "lucide-react";

<AppButton variant="primary" iconLeft={<Save />}>Lưu</AppButton>
<AppButton variant="secondary">Hủy</AppButton>
<AppButton variant="ghost" iconRight={<ArrowRight />}>Tiếp</AppButton>
<AppInput iconLeft={<Search />} placeholder="Tìm kiếm" />
<AppTable>{/* thead/tbody */}</AppTable>
```

Tailwind cũng có semantic utilities như `bg-primary`, `bg-surface`, `text-text-primary`, `border-border`, `font-sans` qua `@theme inline`. Không dùng màu hex/RGB hoặc palette Tailwind cố định trong component; thêm token theo vai trò nếu token hiện tại chưa đủ. `transparent`, `inherit`, `currentColor` được phép vì không tạo palette riêng.

## Giao diện mobile

Ở màn hình rộng tối đa 720px, `AppFrame` dùng thanh trên gọn với nút burger ở góc phải và thanh điều hướng dưới với tối đa bốn lối tắt cùng mục Thêm. Burger và mục Thêm mở menu route được lọc theo quyền hiện có. Mục đang mở được đánh dấu; trang ngoài các lối tắt nhanh dùng trạng thái đang chọn ở mục Thêm.

Trang protected có route desktop và route tương ứng dưới `/mobile/...`; `AppFrame` đổi route theo chiều rộng và menu mobile giữ nguyên kiểm tra quyền. Khi thêm hoặc sửa trang, cập nhật cả route mobile và bố cục mobile theo [quy tắc trải nghiệm mobile](./mobile-experience.md). Danh sách khách hàng, hàng hóa và đơn hàng dùng thẻ trên mobile; các danh sách khác tiếp tục dùng bảng cuộn ngang.

Thanh điều hướng và các vùng bấm dùng khoảng an toàn của thiết bị (`viewport-fit=cover`) cùng `--mobile-nav-height`. Nội dung trang chừa khoảng trống dưới thanh này; POS tính phần chiều cao còn lại để vùng sản phẩm và thanh thanh toán không bị che. Dùng `--control-height-touch` cho điều khiển cần chạm, `--radius-mobile-card` cho panel, `--radius-mobile-sheet` cho sheet và `--shadow-mobile-nav` cho thanh dưới. Modal chuyển thành sheet neo phía dưới; bảng vẫn giữ ngữ nghĩa bảng và cuộn ngang trong vùng riêng khi cần.

## Kiểm tra khi thay đổi

Chạy `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Kiểm tra trực quan đăng nhập, POS, bảng quản lý, modal, focus, disabled, màn hình nhỏ và hóa đơn in. Kiểm tra trang được bảo vệ cần phiên đăng nhập; build thành công không thay thế việc kiểm tra các trạng thái này.

### Kết quả triển khai bộ token ngày 06/10/2026

- Lint, typecheck, 11 bài test và production build thành công.
- Trang đăng nhập đã được xem trên trình duyệt ở 1280 × 720: font tính toán là Roboto, nút có nền `rgb(0, 112, 244)`, chữ trắng và bo góc 8px.
- Quét source không còn mã màu hex/RGB/HSL ngoài `tokens.css`, không có token được tham chiếu nhưng chưa định nghĩa.

### Bố cục compact ngày 07/10/2026

- Các trang quản trị dùng thanh tiện ích và navbar riêng; bỏ sidebar dọc để tăng không gian nội dung.
- Bảng hàng hóa có cột bộ lọc tồn kho, truy vấn thực và kiểu dáng compact.
- Lint, typecheck và build thành công; chưa kiểm tra trực quan sau đăng nhập hoặc trên màn hình nhỏ.

# Components và tương tác dùng chung

- Mọi nút, ô input và bảng HTML trong màn hình dùng component chung `AppButton`, `AppInput`, `AppTable`; field nghiệp vụ mở rộng từ các primitive này.
- Input tìm kiếm đặt icon bên trong trường nhập; danh sách gợi ý hỗ trợ mũi tên lên/xuống, Enter để chọn và Escape để đóng/xóa.
- Bảng danh sách có sort hai chiều theo header và menu `Cột` để chọn cột hiển thị. Sort và tổng của tập dữ liệu phân trang lấy từ API.
- Trường số tự chọn giá trị khi focus và hiển thị dấu phẩy phân nhóm hàng nghìn. Tồn kho trong form sản phẩm chấp nhận 0 và không chấp nhận số âm.
- Topbar giữ đường dẫn nhanh `Bán hàng` và `Quản lý`; primary navigation chỉ xuất hiện trong khu vực quản lý.
