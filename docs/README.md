# Tài liệu dự án

- [Design system](./design-system.md): token màu, font, nút, trạng thái tương tác và cách mở rộng styling.
- [Architecture](./architecture/overview.md): cấu trúc ứng dụng, quyền truy cập và luồng dữ liệu.
- [Permissions](./permissions.md): danh mục quyền và yêu cầu quyền riêng cho giá vốn, nhập hàng.
- [Client data cache](./data-caching.md): phạm vi cache query, quy tắc query key và invalidation sau mutation.
- [System settings](./system-settings.md): quy tắc cho tùy chọn hệ thống chỉ lưu trong localStorage.
- [Analysis pages](./analysis-guidelines.md): công thức KPI, tổng hợp database, tải widget độc lập, cache lịch sử và phân trang server.
- [Kiểm thử bằng Chrome](./testing.md): tài khoản local cho cả admin và nhân viên, luồng kiểm tra chỉ đọc, cùng cổng xác nhận trước khi push `main`.
- [Skill kiểm thử hệ thống](../.agents/skills/erp-system-testing/SKILL.md): ma trận tổng quan theo vai trò, giao diện và CRUD trên môi trường cô lập.
- [Functions](./functions/README.md): mô tả các nhóm function nghiệp vụ và RPC.
- [Database migrations](./database-migrations.md): quy trình apply schema từ xa, chuẩn bị rollback và xác minh migration history.
- [UI components](./components/README.md): field, filter, bảng, button, dialog, menu và màn hình dùng chung.
- [Quy chuẩn bắt buộc về bảng](./table-guidelines.md): row detail, phân trang, filter sidebar và toolbar phải dùng component chung.
- [Execution plan 2026-10-07 - 05](./plans/2026-10-07%20-%2005.txt): backlog gần nhất cho POS, nhập hàng và đơn hàng.
- [Execution plan 2026-10-08 - 02](./plans/2026-10-08%20-%2002.txt): bộ lọc ngày, Dashboard, bảng dữ liệu và các chỉnh sửa quản lý.

## Plans and delivery

Các yêu cầu và kế hoạch đang theo dõi được lưu trong `docs/plans/`. Khi thay đổi triển khai liên quan đến một plan, hãy đưa file plan tương ứng vào cùng commit/push nếu Louis yêu cầu giao cả kế hoạch; giữ nguyên nội dung backlog chưa hoàn tất và không xem việc đưa plan lên remote là bằng chứng các mục đã triển khai.

Khi thay đổi giao diện dùng chung, cập nhật token và tài liệu design system trong cùng thay đổi.
