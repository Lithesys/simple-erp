# Phân quyền

Quyền được gán theo vai trò trong trang **Vai trò & quyền**. Tài khoản được phép làm một việc khi vai trò có mã quyền tương ứng và tài khoản còn hoạt động. Điều hướng chỉ ẩn giao diện; truy vấn Supabase, RPC và RLS vẫn kiểm tra quyền ở phía dữ liệu.

## Danh mục quyền

| Nhóm       | Mã quyền                | Cho phép                                                                                  |
| ---------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Hàng hóa   | `products.read`         | Xem danh sách hàng hóa đang và đã ngừng kinh doanh, cùng giá bán theo bảng giá.           |
| Hàng hóa   | `products.create`       | Tạo hàng hóa.                                                                             |
| Hàng hóa   | `products.update`       | Sửa tên, đơn vị và giá hàng hóa. Điều chỉnh tồn kho cần quyền tạo và hoàn thành kiểm kho. |
| Hàng hóa   | `products.archive`      | Ngừng kinh doanh hoặc mở bán lại hàng hóa.                                                |
| Hàng hóa   | `products.cost.read`    | Xem giá vốn và các trường giá nhập đã được cấp quyền.                                     |
| Bán hàng   | `sales.create`          | Tạo và thanh toán đơn hàng.                                                               |
| Đơn hàng   | `orders.read_own`       | Xem đơn hàng do tài khoản tạo.                                                            |
| Đơn hàng   | `orders.read_all`       | Xem toàn bộ đơn hàng.                                                                     |
| Đơn hàng   | `orders.edit`           | Sửa thông tin khách, giảm giá và số lượng trong đơn hàng.                                 |
| Đơn hàng   | `orders.delete`         | Hủy đơn, cộng lại tồn kho và không thể khôi phục đơn đã hủy.                              |
| Nhập hàng  | `purchases.read`        | Xem danh sách và chi tiết đơn nhập.                                                       |
| Nhập hàng  | `purchases.create`      | Tạo đơn nhập chờ duyệt.                                                                   |
| Nhập hàng  | `purchases.update`      | Sửa đơn nhập. Theo cấu hình hiện tại cần thêm `products.cost.read` để sửa đơn giá.        |
| Nhập hàng  | `purchases.delete`      | Xóa hoặc hủy đơn nhập theo trạng thái và tồn kho.                                         |
| Nhập hàng  | `purchases.approve`     | Duyệt đơn và cộng hàng vào kho. Theo cấu hình hiện tại cần thêm `products.cost.read`.     |
| Kiểm kho   | `stock_checks.read`     | Xem danh sách, chi tiết và lịch sử phiếu kiểm kho.                                        |
| Kiểm kho   | `stock_checks.create`   | Tạo và lưu tạm phiếu kiểm kho.                                                            |
| Kiểm kho   | `stock_checks.update`   | Sửa phiếu kiểm kho; sửa phiếu đã hoàn thành cần thêm quyền hoàn thành.                    |
| Kiểm kho   | `stock_checks.delete`   | Xóa phiếu tạm; hủy phiếu đã hoàn thành cần thêm quyền hoàn thành.                         |
| Kiểm kho   | `stock_checks.complete` | Hoàn thành phiếu và cập nhật chênh lệch tồn kho.                                          |
| Kiểm kho   | `stock_checks.export`   | Xuất dữ liệu kiểm kho; giá trị lệch chỉ xuất hiện khi có `products.cost.read`.            |
| Khách hàng | `customers.create`      | Thêm khách hàng.                                                                          |
| Khách hàng | `customers.read`        | Tìm và xem khách hàng.                                                                    |
| Khách hàng | `customers.update`      | Sửa khách hàng.                                                                           |
| Khách hàng | `customers.delete`      | Xóa khách hàng.                                                                           |
| Bảng giá   | `price_lists.manage`    | Quản lý bảng giá.                                                                         |
| Mẫu in     | `print_templates.read`   | Xem danh sách, nội dung và bản xem trước của mẫu in.                                     |
| Mẫu in     | `print_templates.create` | Tạo mẫu in.                                                                              |
| Mẫu in     | `print_templates.update` | Chỉnh sửa nội dung, khổ giấy và mẫu mặc định.                                             |
| Mẫu in     | `print_templates.delete` | Xóa mẫu in không còn được dùng làm mặc định.                                              |
| Tài khoản  | `accounts.manage`       | Quản lý tài khoản và vai trò gắn với tài khoản.                                           |
| Vai trò    | `roles.manage`          | Tạo, sửa và xóa vai trò.                                                                  |

## Quy tắc bảng và quyền thao tác

- Nhấn vào một hàng hoặc thẻ của thực thể sẽ mở chi tiết thực thể đó. Bảng không dùng nút mắt để mở chi tiết.
- Nút bút chì chỉ nằm trong phần đầu modal chi tiết, cạnh nút đóng. Nút chỉ xuất hiện khi tài khoản có quyền cập nhật thực thể; quyền xóa, duyệt, hủy và xuất vẫn được kiểm tra riêng theo từng thao tác.
- Các trường được phép sửa trực tiếp trong bảng Hàng hóa (như giá theo bảng giá và giá vốn) tiếp tục sửa tại chỗ. Nhấn hoặc dùng bàn phím trong trường đó không được mở modal chi tiết. Giá bán cần `products.update`; giá vốn cần `products.cost.read` và quyền cập nhật tương ứng. Điều chỉnh tồn kho tiếp tục yêu cầu quyền kiểm kho theo quy tắc phía trên.
- Sau khi lưu thành công, hàng đang hiển thị phải cập nhật ngay trong bảng; tải lại nền chỉ dùng để đồng bộ dữ liệu máy chủ. Giao diện không được bỏ qua kiểm tra quyền của API, RPC hoặc RLS.
- Không hiển thị nút sửa/xóa/duyệt/hủy nếu thiếu quyền tương ứng. Có quyền xem không tự cấp quyền chỉnh sửa, và quyền chỉnh sửa không làm lộ các trường giá vốn bị giới hạn.

## Quyền xem giá vốn khi nhập hàng

Quyền xem, tạo, sửa, xóa và duyệt đơn nhập được cấp riêng, không dùng một quyền `purchases.manage` chung. Người có `purchases.create` có thể lưu đơn ở trạng thái **Đợi duyệt**. Form và kết quả tìm hàng không hiển thị giá nếu thiếu `products.cost.read`; database lưu giá tạm bằng 0 và không trả các giá trị này khi đọc đơn.

Người sửa đơn cần `purchases.update`; theo cấu hình hiện tại, form sửa đơn cần thêm `products.cost.read`. Người duyệt cần `purchases.approve` và `products.cost.read`. Để người duyệt mở chi tiết đơn, cấp thêm `purchases.read`; để họ sửa giá trước khi duyệt, cấp thêm `purchases.update`. Database từ chối mỗi thao tác khi thiếu quyền tương ứng.

## Kiểm kho

Tạo phiếu tạm yêu cầu `stock_checks.create`; sửa phiếu yêu cầu `stock_checks.update`; hoàn thành yêu cầu `stock_checks.complete`. Sửa phiếu đã hoàn thành yêu cầu cả quyền sửa và hoàn thành. Xóa phiếu tạm yêu cầu `stock_checks.delete`; hủy phiếu đã hoàn thành yêu cầu thêm `stock_checks.complete` và đảo phần chênh lệch đã áp dụng vào tồn hiện tại. Mọi điều chỉnh tồn kho trực tiếp ở trang hàng hóa cũng cần quyền tạo và hoàn thành phiếu; database tự tạo phiếu liên kết. Giá trị lệch và giá vốn chỉ được đọc/xuất khi có `products.cost.read`.

## Lợi nhuận đơn hàng

Cột **Tiền lời** trong danh sách đơn hàng và chỉ số **Tiền lời** trên Dashboard chỉ dành cho tài khoản có `products.cost.read` và quyền xem đơn tương ứng. Truy vấn lợi nhuận chỉ chạy khi quyền này có mặt; RLS tiếp tục giới hạn dữ liệu theo quyền xem đơn. Giá vốn được chụp lại theo từng mặt hàng khi thanh toán; lợi nhuận không đổi khi giá vốn danh mục thay đổi và được tính lại khi đơn hàng được chỉnh sửa.

## Trạng thái hàng hóa và đơn hàng

Ngừng kinh doanh chỉ đổi trạng thái hàng hóa; bản ghi, đơn giá và lịch sử vẫn được giữ. Người có `products.read` xem được cả hàng đang và đã ngừng kinh doanh. Chỉ người có `products.archive` mới được ngừng kinh doanh hoặc kinh doanh lại; thiếu quyền này thì không hiện thao tác kinh doanh lại.

Hủy đơn giữ nguyên hóa đơn và các dòng hàng, đổi trạng thái thành **Đã hủy**, đồng thời cộng số lượng đã bán lại vào kho. Đơn đã hủy không thể mở lại và không bị xóa khỏi danh sách. Quyền `orders.delete` chỉ còn cho phép hủy đơn; database chặn xóa cứng.

## Mẫu in

Trang `/system/print-templates` yêu cầu `print_templates.read`; các nút tạo, sửa, đặt mặc định và xóa kiểm tra riêng quyền tương ứng. Mẫu được lưu dùng chung trong `public.print_templates` và được RLS bảo vệ. Tài khoản có quyền bán hàng hoặc xem đơn hàng chỉ đọc được mẫu mặc định để in hóa đơn, không mở được trang quản lý nếu thiếu quyền xem mẫu in. Mẫu mặc định không thể bị xóa; hãy đặt một mẫu khác làm mặc định trước.

## Vai trò mặc định

- **Admin**: toàn quyền quản trị, bao gồm `products.cost.read` và toàn bộ quyền nhập hàng.
- **Nhân viên**: quyền bán hàng cơ bản và xem hàng hóa; không mặc định có quyền xem giá vốn hoặc nhập hàng.
- Vai trò tùy chỉnh chỉ có các quyền được chọn. Migration chuyển vai trò cũ có `purchases.manage` sang năm quyền nhập hàng độc lập; quyền này không tự động cấp `products.cost.read`.
- Migration chuyển vai trò cũ có `customers.manage` sang `customers.create`, `customers.update` và `customers.delete`.
