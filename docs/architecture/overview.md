# Kiến trúc hệ thống

## Thành phần

- `src/app/`: Next.js App Router, chia route công khai, protected, API và layout.
- `src/components/`: giao diện nghiệp vụ phía client.
- `src/lib/`: Supabase client, quyền hạn, định dạng, tìm kiếm và logic dùng chung.
- `supabase/migrations/`: schema, RLS, function/RPC và trigger theo thứ tự thời gian.

## Truy cập dữ liệu

Các trang protected được bọc bởi `AppFrame`, nơi đọc quyền từ phiên Supabase và lọc điều hướng. Client truy vấn dữ liệu nghiệp vụ qua Supabase; RLS là ranh giới truy cập dữ liệu. Quản trị Auth dùng API route phía server và kiểm tra quyền trước khi thao tác.

Danh mục quyền và quy tắc kết hợp quyền nằm trong [Phân quyền](../permissions.md). Các thao tác nhập hàng dùng quyền đọc, tạo, sửa, xóa và duyệt riêng; giá nhập tiếp tục tuân theo `products.cost.read`.

Dữ liệu nghiệp vụ đọc ở client được cache bằng TanStack Query: dùng `useQuery` hoặc `fetchCachedQuery`, key phải bao gồm user và mọi tham số ảnh hưởng kết quả, và mutation thành công phải invalidate các key liên quan. Quy ước và danh mục query nằm ở [Client data cache](../data-caching.md). Cache không thay thế RLS hoặc kiểm tra quyền phía server.

Tài khoản có username duy nhất trong `profiles`. Route đăng nhập phía server tìm tài khoản theo username, xác thực mật khẩu qua Supabase Auth bằng email tài khoản, rồi trả session token để client thiết lập phiên. API quản lý tài khoản dùng service role chỉ ở server. Mật khẩu cá nhân được đổi sau khi xác minh lại mật khẩu hiện tại.

## POS và tồn kho

POS gửi các dòng đơn hàng tới `checkout_order` cùng idempotency key và giá kỳ vọng. Database chịu trách nhiệm hoàn tất giao dịch và cập nhật tồn kho. Nhật ký tồn kho được tạo bởi trigger. Nhập hàng dùng các RPC tạo và nhận đơn để trạng thái duyệt, số lượng và nhật ký cùng được xử lý phía database.

## Điều hướng

Topbar chuyển giữa `/pos` và `/dashboard`. POS ẩn primary navigation để ưu tiên màn hình bán hàng; các route quản lý giữ thanh điều hướng nghiệp vụ.
