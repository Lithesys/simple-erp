# Trải nghiệm mobile

## Quy tắc cập nhật

- Các route protected có cặp route desktop và `/mobile/...`, được khai báo tại `src/lib/mobile-routes.ts`.
- Route component mobile tái sử dụng page desktop tương ứng để dùng chung kiểm tra quyền, truy vấn dữ liệu và mutation. Khi thêm page protected, tạo cả route mobile và khai báo cặp route trong `mobile-routes.ts`.
- `AppFrame` chuyển route theo breakpoint 720px và khi kích thước màn hình thay đổi. Giữ lại query string và hash khi chuyển route.
- Điều hướng mobile dùng cùng danh sách trang đã lọc theo quyền. Cập nhật menu và liên kết mobile cùng lúc với route desktop.
- Khi chỉnh giao diện page, kiểm tra cả route desktop và route `/mobile/...`, kể cả nội dung thẻ, thao tác, modal và phân trang.

## Cách hiển thị

Trên mobile, trang khách hàng dùng thẻ tên, số điện thoại và địa chỉ; chạm thẻ mở đầy đủ thông tin. Trang hàng hóa dùng thẻ tên và tồn kho; chạm thẻ mở chi tiết, nhật ký tồn kho và thống kê bán. Trang đơn hàng dùng thẻ thời gian, khách hàng, tiền khách thanh toán và tiền giảm giá.

Các trang dữ liệu khác vẫn dùng bảng và cuộn ngang trong vùng bảng khi cần. Nhãn của nút Xuất và Thêm được ẩn trên route mobile; icon, nhãn trợ năng và chức năng vẫn được giữ.

## Route mobile

| Desktop                   | Mobile                           |
| ------------------------- | -------------------------------- |
| `/account`                | `/mobile/account`                |
| `/dashboard`              | `/mobile/dashboard`              |
| `/debt`                   | `/mobile/debt`                   |
| `/management/accounts`    | `/mobile/management/accounts`    |
| `/management/customers`   | `/mobile/management/customers`   |
| `/management/orders`      | `/mobile/management/orders`      |
| `/management/price-lists` | `/mobile/management/price-lists` |
| `/management/products`    | `/mobile/management/products`    |
| `/management/purchase`    | `/mobile/management/purchase`    |
| `/management/roles`       | `/mobile/management/roles`       |
| `/pos`                    | `/mobile/pos`                    |
