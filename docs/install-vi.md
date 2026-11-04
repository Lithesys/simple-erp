# Cài ERP trên Windows (không cần lập trình)

## Tải và cài

1. Mở trang [ERP Releases](https://github.com/Lithesys/simple-erp/releases/latest).
2. Trong phần **Assets**, tải file **ERP Setup [phiên bản].exe**.
3. Mở file vừa tải, làm theo hướng dẫn và chọn vị trí cài nếu Windows hỏi.
4. Mở **ERP** từ Start Menu. Không cần cài Node.js, PostgreSQL hay Docker.

## Đăng nhập lần đầu

Một database cục bộ mới dùng tài khoản `admin` và mật khẩu `admin`. Đây chỉ là tài khoản khởi tạo; hãy đổi mật khẩu trong mục tài khoản trước khi đưa dữ liệu thật vào. Nếu database đã được sử dụng, bản cập nhật giữ nguyên tài khoản và mật khẩu hiện có.

Mặc định, ERP dùng database cục bộ trên máy và vẫn chạy khi không có Internet. Dữ liệu offline được lưu trong hồ sơ Windows của người đang đăng nhập. Hãy sao lưu hồ sơ dữ liệu ứng dụng trước khi cài lại Windows hoặc chuyển sang máy khác.

Quản trị viên có thể đặt **Tên cửa hàng** trong **Hệ thống → Cài đặt**. Tên này xuất hiện trên tiêu đề ứng dụng, thanh điều hướng và hóa đơn, tối đa 20 ký tự. Tùy chọn được lưu riêng trong mỗi trình duyệt/cài đặt ERP.

## Kết nối database của website

Chỉ quản trị viên mới có thể đổi kết nối:

1. Đăng nhập vào database hiện tại bằng tài khoản quản trị.
2. Mở **Hệ thống → Cài đặt → Cơ sở dữ liệu**.
3. Chọn **Supabase**, nhập PostgreSQL connection string, Supabase project URL, anon key và service role key.
4. Chọn **Kiểm tra kết nối**. Nếu có migration, đọc danh sách và sao lưu database trước khi đồng ý áp dụng.
5. Chọn **Lưu và chuyển cơ sở dữ liệu**. ERP sẽ đăng xuất và quay lại màn hình đăng nhập.
6. Đăng nhập bằng tài khoản website đã có trong Supabase Auth.

Các khóa kết nối được lưu mã hóa bằng Windows Secure Storage; không gửi các khóa này qua chat hoặc email. ERP không sao chép dữ liệu giữa hai database và không tự chuyển về local khi database từ xa bị lỗi. Muốn dùng offline, hãy chủ động chọn database cục bộ trong phần cài đặt.

## Cập nhật ứng dụng

Mở **Hệ thống → Cài đặt → Cập nhật ứng dụng**, chọn **Kiểm tra cập nhật**, tải bản mới rồi chọn **Cài đặt và khởi động lại**. Bản cập nhật giữ database và cấu hình kết nối của người dùng.

## Nếu không đăng nhập được

- Kiểm tra bạn đang dùng đúng database: local dùng tài khoản local; Supabase dùng tài khoản website.
- Nếu database Supabase chưa kết nối được, mở **Thiết lập hoặc sửa kết nối cơ sở dữ liệu** trên màn hình đăng nhập để khắc phục.
- Không khởi tạo lại database đang có dữ liệu. Liên hệ quản trị viên nếu màn hình kiểm tra báo schema không tương thích.
