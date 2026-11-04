# Quy chuẩn bắt buộc khi làm việc với bảng

Tài liệu này là nguồn hướng dẫn bắt buộc cho mọi thay đổi tạo mới hoặc chỉnh sửa bảng trong ứng dụng. Trước khi viết giao diện bảng, hãy đọc phần này và dùng component chung bên dưới. Không tạo biến thể riêng theo trang cho các hành vi đã được chuẩn hóa.

## Thành phần bắt buộc

### Mở chi tiết bằng cách bấm vào row

- Dùng `DataTable` hoặc `AppTable` và truyền `onRowClick` để mở chi tiết entity. Dùng `isRowClickable` để giới hạn từng row khi cần; không tự gắn `onClick`/`tabIndex` lên `<tr>` trong trang.
- Để trống `onRowClick` trên trang hoặc loại entity không được mở detail từ row. Ví dụ `/accounts` và `/roles` không bật row detail.
- Các nút, link, input và menu trong row phải tiếp tục hoạt động riêng. `AppTable` đã bỏ qua các tương tác này; với markup dòng tùy chỉnh, dùng hành vi tương đương và không để action click mở detail ngoài ý muốn.
- Tôn trọng quyền hiện tại khi cung cấp thao tác mở chi tiết và khi render nội dung trong modal. Không thêm link hoặc callback riêng để lách quyền.

### Phân trang

- Dùng `AppPagination` từ `src/components/app-pagination.tsx`; không dựng nút Trước/Sau hoặc bộ chọn trang riêng trong từng màn hình.
- `AppPagination.page` là chỉ số bắt đầu từ 0. Nếu state hoặc API của màn hình dùng trang bắt đầu từ 1, chuyển đổi ở ranh giới component.
- Danh sách lớn phải lấy trang, tổng số dòng và thứ tự ổn định từ API/server. Không phân trang một phần dữ liệu đã tải về rồi trình bày như tổng kết toàn bộ kết quả.
- Truyền `disabled` trong lúc đổi trang hoặc tải dữ liệu nếu cần ngăn gửi yêu cầu lặp. Giữ sort/filter hiện tại khi đổi trang và reset trang về đầu khi thay filter làm thay đổi tập kết quả.

### Bộ lọc bên trái

- Panel filter bên trái phải dùng một wrapper React dùng chung trong `src/components/`; không tự dựng `<aside>` và cấu trúc panel riêng trong màn hình bảng.
- Hiện các màn hình đang có một số wrapper sidebar theo trang, chưa có primitive sidebar filter chung. Khi tạo bảng mới hoặc thay đổi cấu trúc sidebar hiện có, hãy trích xuất hoặc mở rộng wrapper dùng chung trong cùng thay đổi rồi dùng lại ở màn hình liên quan. Giữ các field, query, quyền và quy tắc nghiệp vụ ở màn hình sở hữu filter; wrapper chỉ chuẩn hóa khung, nhãn truy cập được, heading, vùng nội dung và footer khi có.
- Không dùng chung state/query giữa các trang chỉ để dùng chung khung. Giữ debounce, đồng bộ URL, hành vi áp dụng/xóa filter và responsive theo hợp đồng của trang.
- Filter dạng popover vẫn dùng primitive filter/popover chung hiện có của ứng dụng; không biến popover thành sidebar riêng hoặc sao chép logic dismiss/focus.

### Toolbar của bảng

- Dùng toolbar slot của `AppTable`/`DataTable`: `heading` hoặc `title`, `toolbarSummary`, `tools`, và `summary`. Không dựng lại `.app-table-toolbar` trong màn hình nghiệp vụ.
- Dùng `MobileTableToolbarMetrics` cho số liệu dạng thẻ trên mobile khi bảng có các chỉ số tóm tắt. Dùng cùng dữ liệu có thẩm quyền với summary desktop.
- Dùng menu cột/action, sort, trạng thái rỗng và kiểu row tích hợp của `DataTable`/`AppTable`; không tạo toolbar/table primitive riêng chỉ để đổi nhãn hay thứ tự control.
- Khi một URL hoặc chế độ xem cần ép tập cột hiển thị, truyền `initialVisible` và đặt `persistVisibleColumns={false}` để không ghi đè tùy chọn cột thông thường của người dùng. Giữ phạm vi cột trong `columns` nếu các cột khác phải luôn bị ẩn ở chế độ đó.
- Chỉ đặt control đặc thù nghiệp vụ vào slot dùng chung. Logic quyền, export và hành vi nghiệp vụ vẫn thuộc màn hình hoặc module nghiệp vụ.

## Khi component chung còn thiếu

Nếu một mục ở trên chưa có component dùng chung phù hợp, trước tiên hãy tạo hoặc mở rộng component trong `src/components/`, ghi hợp đồng của nó tại [UI components](./components/README.md), rồi dùng component đó cho màn hình cần thay đổi trong cùng phạm vi công việc. Không hoàn tất tính năng mới bằng markup lặp lại theo trang trong khi component chung còn thiếu.

## Checklist review

- [ ] Row detail dùng `DataTable`/`AppTable` callback và đúng quy tắc bật/tắt theo quyền, route và nghiệp vụ.
- [ ] Phân trang dùng `AppPagination`, khớp chỉ số trang với API và giữ filter/sort.
- [ ] Sidebar filter dùng wrapper dùng chung; nếu wrapper chưa tồn tại thì được trích xuất và tái sử dụng trong thay đổi này.
- [ ] Toolbar desktop dùng slot của `AppTable`/`DataTable`; metrics mobile dùng `MobileTableToolbarMetrics` khi phù hợp.
- [ ] Không thêm hành vi riêng gây xung đột với click của action, permission hoặc responsive.
