# Cài đặt hệ thống

## Tên cửa hàng dùng chung

Tên cửa hàng được lưu trong `public.app_settings` ở khóa `store_name`. Bảng dùng cặp `setting_key`/`value` với kiểu JSONB để có thể thêm các thuộc tính khác mà không cần thêm cột cho từng tùy chọn. `is_public` cho phép chủ động công khai một giá trị; mặc định các setting mới là riêng tư. Các cột `is_default`, `updated_at` và `updated_by` hỗ trợ giá trị mặc định và theo dõi lần cập nhật.

Mọi khách có thể đọc setting được đánh dấu công khai; người dùng đã đăng nhập cũng đọc được các setting công khai. Quyền `accounts.manage` mới được đọc setting riêng tư hoặc ghi/xóa setting. Row `store_name` được công khai vì tên xuất hiện cả ở trang đăng nhập. RLS và GRANT được khai báo cùng migration.

Migration tạo tên mặc định `ERP`. Khi tài khoản Admin mở ứng dụng lần đầu sau nâng cấp, tên cũ đang lưu trong trình duyệt được chuyển một lần vào database nếu giá trị database vẫn là mặc định. Sau khi lưu thành công, key cũ trong `localStorage` được xóa.

## Tùy chọn trên thiết bị

Tùy chọn in vẫn lưu trong `localStorage` trên thiết bị hiện tại. Key dùng tiền tố `erp-preference:system:v1:`; tự in được tách theo ID tài khoản. Tùy chọn **In tự động** mặc định bật và quyết định việc mở hộp thoại in sau khi sửa hóa đơn thành công. Nếu storage bị chặn, lỗi hoặc đầy, trang vẫn tiếp tục hoạt động với giá trị mặc định.

Khi thêm tùy chọn cục bộ mới, khai báo key và giá trị mặc định trong `src/lib/system-settings.ts`, đọc và ghi bằng hook cùng module này, rồi kiểm tra khởi tạo sau hydration để tránh ghi đè giá trị đã lưu. Setting cần dùng chung giữa thiết bị phải được thêm như một khóa trong `app_settings` với RLS, GRANT và giao diện tương ứng.

### Cơ sở dữ liệu Desktop

Trong bản Electron Windows, trang này còn có cài đặt database và cập nhật ứng dụng. Chỉ tài khoản có `accounts.manage` mới được đổi nguồn dữ liệu. Database URL và API keys chỉ đi qua IPC của Electron, được mã hóa bằng Windows `safeStorage` khi lưu, và không được trả lại cho renderer. Chế độ local dùng PGlite; chế độ PostgreSQL chạy PostgREST trên loopback; chế độ Supabase dùng Auth và Data API của project hiện có.

Kiểm tra kết nối là thao tác chỉ đọc. Với database trống, **Lưu và chuyển** yêu cầu xác nhận riêng trước khi chạy toàn bộ migration và tạo `admin/admin`. Database không trống nhưng không có schema ERP bị từ chối. Khi chuyển nguồn, phiên đăng nhập của Supabase và bộ nhớ phiên của cửa sổ desktop bị xóa, ứng dụng khởi động lại và yêu cầu đăng nhập vào nguồn mới. Dữ liệu auto-print vẫn được giữ trong cài đặt theo tài khoản.

Khi database đang lỗi, `/desktop/setup` vẫn mở từ liên kết ở trang đăng nhập và cho phép đổi kết nối mà không cần phiên database hiện tại. Bộ cập nhật dùng electron-updater với GitHub Releases; build/tag và repository phát hành được cấu hình theo hướng dẫn Desktop trong README.
