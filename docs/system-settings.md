# Cài đặt hệ thống

Các tùy chọn ở **Hệ thống → Cài đặt** chỉ lưu trong `localStorage`, theo tài khoản đăng nhập của trình duyệt hiện tại. Không tạo cột, bảng, RPC hoặc API để đồng bộ các tùy chọn này với database.

Key dùng tiền tố `erp-preference:system:v1:` và có thêm ID tài khoản để tách cài đặt của từng người dùng trên cùng trình duyệt. Tùy chọn **In tự động** mặc định bật và quyết định việc mở hộp thoại in sau khi sửa hóa đơn thành công. Nếu storage bị chặn, lỗi hoặc đầy, trang vẫn tiếp tục hoạt động với giá trị mặc định.

Khi thêm tùy chọn mới, khai báo key và giá trị mặc định trong `src/lib/system-settings.ts`, đọc và ghi bằng hook cùng module này, rồi kiểm tra khởi tạo sau hydration để tránh ghi đè giá trị đã lưu.

### Cơ sở dữ liệu Desktop

Trong bản Electron Windows, trang này còn có cài đặt database và cập nhật ứng dụng. Chỉ tài khoản có `accounts.manage` mới được đổi nguồn dữ liệu. Database URL và API keys chỉ đi qua IPC của Electron, được mã hóa bằng Windows `safeStorage` khi lưu, và không được trả lại cho renderer. Chế độ local dùng PGlite; chế độ PostgreSQL chạy PostgREST trên loopback; chế độ Supabase dùng Auth và Data API của project hiện có.

Kiểm tra kết nối là thao tác chỉ đọc. Với database trống, **Lưu và chuyển** yêu cầu xác nhận riêng trước khi chạy toàn bộ migration và tạo `admin/admin`. Database không trống nhưng không có schema ERP bị từ chối. Khi chuyển nguồn, phiên đăng nhập của Supabase và bộ nhớ phiên của cửa sổ desktop bị xóa, ứng dụng khởi động lại và yêu cầu đăng nhập vào nguồn mới. Dữ liệu auto-print vẫn được giữ trong cài đặt theo tài khoản.

Khi database đang lỗi, `/desktop/setup` vẫn mở từ liên kết ở trang đăng nhập và cho phép đổi kết nối mà không cần phiên database hiện tại. Bộ cập nhật dùng electron-updater với GitHub Releases; build/tag và repository phát hành được cấu hình theo hướng dẫn Desktop trong README.
