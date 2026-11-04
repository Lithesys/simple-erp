# Cache dữ liệu phía client

Ứng dụng dùng TanStack Query làm cache cho dữ liệu nghiệp vụ đọc từ Supabase và các API list/detail được gọi từ giao diện.

## Mặc định

- `AppProviders` tạo một `QueryClient` cho phiên ứng dụng. Query có `staleTime` mặc định 30 giây và được giữ trong bộ nhớ tối đa 5 phút sau khi không còn được dùng.
- Dùng `useQuery` cho query gắn trực tiếp với giao diện. Với luồng hiện đang giữ state local, dùng `fetchCachedQuery` từ `src/lib/query-cache.ts`; helper này gọi `QueryClient.fetchQuery` với cùng `staleTime` và tự thêm user ID vào query key.
- Query key phải phân biệt tài khoản đăng nhập, bộ lọc, phân trang, ngày và tham số RPC. Không dùng chung key cho hai tập kết quả khác nhau.
- Query function phải throw khi Supabase/API trả lỗi; không lưu lỗi như dữ liệu thành công.
- `/pos` dùng IndexedDB `lan-duy-linh-pos-search-v1` cho danh sách hàng, bảng giá hoạt động và danh bạ khách. Khi dữ liệu local sẵn sàng, tìm hàng/khách lọc ngay mỗi lần gõ, không debounce và không gọi RPC gợi ý khách; chỉ giữ debounce 200 ms cho RPC dự phòng trước lần đồng bộ danh bạ đầu tiên. Bản ghi được khóa theo user ID, chỉ lấy qua client/RLS, rồi đồng bộ nền khi mở POS, mỗi 2 phút khi trang hiển thị, khi quay lại tab/có mạng và qua Supabase Realtime cho các bảng liên quan. Đăng xuất xóa cache của tài khoản hiện tại. Dữ liệu cục bộ chỉ là bản hiển thị gần nhất; quyền và mọi thao tác ghi vẫn do server kiểm soát.
- Sau khi tạo, sửa, xóa, duyệt hoặc thanh toán thành công, invalidate mọi query có thể bị ảnh hưởng. Cache chỉ cập nhật sau khi server xác nhận ghi thành công.
- Với bảng đang giữ dữ liệu bằng local state, chỉ hiển thị skeleton ở lần tải đầu. Khi refresh sau CRUD hoặc đổi bộ lọc, giữ các hàng đã tải thành công cho đến khi có kết quả mới; lỗi refresh không xóa dữ liệu đang hiển thị.
- Không cache dữ liệu form đang sửa, giỏ POS, mật khẩu, idempotency key hoặc kết quả ghi dữ liệu. Những phần này là state của thao tác hiện tại, không phải server state dùng chung.
- Quyền truy cập vẫn do API/RLS kiểm soát. Cache không thay thế kiểm tra quyền. Key có user ID để phân tách dữ liệu giữa phiên; không đưa service role hoặc dữ liệu bí mật vào query key.

## Phạm vi các màn hình

| Màn hình / dữ liệu                                 | Query key gốc                                                  | Khi cần làm mới                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Dashboard theo ngày                                | `dashboard` + ngày                                             | Sau khi thanh toán hoặc xóa đơn                                                    |
| Hàng hóa, trang/tìm kiếm/tồn kho/quyền xem giá vốn | `products` + tham số                                           | Sau khi lưu giá/tồn, tạo hoặc ngừng kinh doanh hàng hóa; sau khi thay đổi bảng giá |
| Bảng giá đang hoạt động (POS và hàng hóa)          | `active-price-lists`                                           | Sau khi tạo, sửa, kích hoạt, xóa hoặc đổi bảng mặc định                            |
| Gợi ý khách hàng POS                               | `customer-suggestions` + từ khóa                               | Sau khi thêm, sửa hoặc xóa khách hàng                                              |
| Danh sách khách hàng                               | `customers` + từ khóa/trang                                    | Sau khi thêm, sửa hoặc xóa khách hàng                                              |
| Danh sách và chi tiết đơn hàng                     | `orders`, `orders-summary`, `order-items` + tham số            | Sau khi sửa hoặc xóa đơn                                                           |
| Sản phẩm/đơn nhập và chi tiết đơn nhập             | `purchase-products`, `purchase-orders`, `purchase-order-items` | Sau khi tạo, sửa, hủy hoặc nhận đơn nhập                                           |
| Bảng giá, giá sản phẩm theo bảng                   | `price-lists`, `product-prices`                                | Sau khi thao tác bảng giá hoặc giá liên quan                                       |
| Vai trò, tài khoản theo trang                      | `roles`, `accounts` + trang/kích thước                         | Sau khi thao tác vai trò hoặc tài khoản                                            |
| Hồ sơ của tôi                                      | `account-settings`                                             | Sau khi lưu tên hoặc email                                                         |

Các query xác thực/quyền hạn (`current_user_access`, permission guards) được đọc trực tiếp để quyền và trạng thái phiên luôn được kiểm tra mới; chúng không phải dữ liệu list/detail nghiệp vụ. Query nội bộ phục vụ một mutation (ví dụ kiểm tra username trước khi tạo tài khoản) cũng tiếp tục chạy ở server tại thời điểm thao tác. Kết quả của mutation không được cache như query.

## Trang analysis

- Làm theo [quy chuẩn trang phân tích](./analysis-guidelines.md). Mỗi KPI/sparkline, bảng xếp hạng và bảng mua cùng dùng query/API riêng để loading, lỗi và retry độc lập.
- Lịch sử được tổng hợp trước ở database. Bảng xếp hạng vẫn lọc, sắp xếp, tính top và phân trang ở server; không dùng localStorage để thay quyền RLS hoặc server pagination.
- Cache bền chỉ chứa thống kê tổng hợp của ngày trước hôm nay, khóa theo user, scope quyền, widget, ngày/khoảng ngày và bộ lọc. Sau khi quyền được xác thực, hiển thị cache trước rồi kiểm tra phiên bản để tải ngày thiếu hoặc đã đổi. Ngày hôm nay chỉ dùng API và cache bộ nhớ ngắn hạn.
- Cache analysis có ngân sách tối đa 3 MiB cho `localStorage`; loại mục ít được dùng gần nhất khi vượt ngưỡng. Bỏ qua cache hỏng, quota error hoặc mục quá lớn mà vẫn giữ số liệu API.
- Cache không lưu dòng hóa đơn, token hay dữ liệu ghi. Lợi nhuận chỉ được cache và đọc trong scope có `products.cost.read`; logout/đổi scope phải loại cache cũ. Nếu API phiên bản lỗi, tiếp tục hiển thị dữ liệu đang có và nêu rõ chưa làm mới được.

## Thêm query mới

1. Xác định mọi tham số làm thay đổi kết quả và đưa chúng vào key.
2. Bao gồm user ID; `fetchCachedQuery` thêm phần này tự động. Với `useQuery`, thêm `access.user.id` hoặc ID phiên tương đương trực tiếp vào key.
3. Chọn `useQuery` cho dữ liệu hiển thị hoặc `fetchCachedQuery` khi cần tích hợp dần với state hiện có.
4. Liệt kê các mutation có thể làm dữ liệu cũ và invalidate theo tiền tố key phù hợp.
5. Không bỏ cache để né lỗi stale; điều chỉnh invalidation hoặc `staleTime` cho đúng luồng dữ liệu.
