# Nhóm function nghiệp vụ

Các database function/RPC là hợp đồng nghiệp vụ ở phía server. Tham số và quyền chi tiết được định nghĩa trong migrations tại `supabase/migrations/`.

## Bán hàng và tồn kho

- `checkout_order`: tạo hóa đơn idempotent, kiểm tra bảng giá/giá kỳ vọng và ghi các dòng bán cùng cập nhật tồn.
- `record_stock_change` trigger: ghi thay đổi tồn thành `inventory_movements`, gắn với hóa đơn khi có checkout context.
- `delete_order`: xóa đơn theo quyền và hoàn số lượng về kho trong giao dịch database.
- `edit_order`: sửa thông tin khách, giảm giá và số lượng dòng đơn; khóa đơn/sản phẩm, kiểm tra tồn kho, cập nhật hàng hóa, tổng tiền và nhật ký tồn kho trong một giao dịch. Cần quyền `orders.edit`.
- `get_product_inventory_history`: trả lịch sử nhập, bán và điều chỉnh tồn theo sản phẩm.
- `get_product_sales_summary`: tổng hợp lượng bán và doanh thu sản phẩm theo ngày.

## Nhập hàng

- `create_purchase_order`: tạo đơn nhập chờ duyệt cùng các dòng hàng và khóa idempotency; cần `purchases.create`. Kết quả không trả tổng tiền nếu thiếu `products.cost.read`.
- `get_purchase_orders(p_from, p_to)`: trả danh sách đơn nhập và `created_at` cho vai trò có ít nhất một quyền `purchases.read`, `purchases.update`, `purchases.delete` hoặc `purchases.approve`; lọc khoảng ngày theo `created_at` với múi giờ Việt Nam. Không lọc theo `purchased_at` (ngày nhập) hoặc `received_at` (ngày duyệt/nhận). Không truyền khoảng ngày thì trả tối đa 200 đơn mới nhất; có khoảng ngày thì trả mọi đơn khớp. Tổng tiền chỉ có với quyền `products.cost.read`.
- `get_purchase_order_items`: trả chi tiết theo quyền `purchases.read`; giá nhập và thành tiền được ẩn nếu thiếu `products.cost.read`.
- `update_pending_purchase_order`, `update_purchase_order`: sửa đơn; cần `purchases.update` và hiện tại cần thêm `products.cost.read`.
- `delete_pending_purchase_order`, `delete_purchase_order`: xóa hoặc hủy đơn; cần `purchases.delete`.
- `receive_purchase_order`: duyệt đơn, tăng tồn và ghi nhận giao dịch tồn kho; cần `purchases.approve` và `products.cost.read`.

## Quản trị và truy vấn

- `search_customers`: tìm khách hàng theo mọi từ trong truy vấn (không phân biệt thứ tự hoặc dấu tiếng Việt) và phân trang theo quyền database.
- `get_products_page`, `get_products_page_summary`: lọc và phân trang hàng hóa theo mọi từ trong truy vấn; tổng cuối trang dùng cùng điều kiện tìm kiếm.
- `orders_page_filtered`, `orders_summary_filtered`: lọc trang đơn hàng và tổng hợp theo khách, mã hóa đơn, thời gian, trạng thái, nhiều SKU hoặc một `product_id`; các bộ lọc là AND, còn sản phẩm đã chọn khớp theo OR.
- `search_order_products`: tìm mã/tên hàng trong các đơn mà tài khoản được phép xem.
- `archive_product`: ngừng kinh doanh sản phẩm mà vẫn giữ dữ liệu đơn cũ.
- `export_products`: trả danh mục và tổng lượng bán trong khoảng ngày cho chức năng xuất CSV.
- `orders_summary`: tổng hợp số đơn, tổng tiền hàng và tổng thanh toán theo bộ lọc.

Khi thay đổi hành vi, cập nhật migration và trang/component gọi RPC, rồi bổ sung ghi chú này nếu hợp đồng nghiệp vụ thay đổi.
