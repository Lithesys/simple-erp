# Quy chuẩn trang phân tích

Áp dụng cho các màn hình `/analysis/*` có KPI, biểu đồ, bảng xếp hạng hoặc gợi ý dựa trên dữ liệu bán hàng. Trang Phân tích hàng hóa là ví dụ tham chiếu.

## Định nghĩa chỉ số

- **Lợi nhuận gộp / đơn vị bán** = tổng lợi nhuận gộp của các dòng bán ÷ tổng `quantity` trên hóa đơn trong khoảng ngày. Đây là số bình quân trên số lượng ghi ở dòng hóa đơn; giữ số lẻ và không tự quy đổi Combo/thùng sang đơn vị thành phần.
- Tính tỷ lệ bằng tổng tử số chia tổng mẫu số. Không lấy trung bình các tỷ lệ theo ngày. Nếu tổng số lượng bán bằng 0, hiển thị `—`.
- Lợi nhuận gộp hiện tại = doanh thu dòng sau khi phân bổ chiết khấu đơn trừ giá vốn snapshot của dòng. Phân bổ chiết khấu phải xác định thứ tự dòng ổn định và bảo toàn tổng chiết khấu.
- Thiếu snapshot giá vốn ở bất kỳ dòng liên quan nào thì đánh dấu số liệu lợi nhuận chưa đủ; không âm thầm xem giá vốn thiếu là 0. Endpoint, bảng cache và UI lợi nhuận đều yêu cầu `products.cost.read`.
- Chỉ số doanh thu/hàng hóa hiện tại giữ công thức doanh thu thuần ÷ số hàng hóa khác nhau có bán trong toàn khoảng ngày. Không cộng số hàng hóa khác nhau theo từng ngày để thay cho số distinct của cả kỳ.
- Chưa trừ hàng trả cho đến khi ứng dụng lưu và tổng hợp được giao dịch trả hàng.

## Tổng hợp ở database

- Không tải toàn bộ `order_items` để tính dashboard trên trình duyệt. Tổng hợp trước theo ngày, sản phẩm, phạm vi người bán và cặp sản phẩm mua cùng.
- Lưu đóng góp theo từng đơn làm dữ liệu gốc có thể đảo. Khi đơn hoàn tất, sửa dòng/chiết khấu/người bán/ngày, hủy hoặc thay đổi snapshot giá vốn, trừ đóng góp cũ và cộng đóng góp mới trong cùng transaction; đổi ngày/người bán phải tăng phiên bản cả phạm vi cũ lẫn mới.
- Tổng hợp mua cùng phải đếm cặp distinct một lần cho mỗi đơn, sau đó cộng toàn bộ các ngày rồi mới chọn top. Không cộng top-N theo ngày để suy ra top-N toàn kỳ.
- Backfill một lần từ đơn hoàn tất; script backfill phải chạy lại an toàn. Thêm index theo phạm vi quyền, ngày và sản phẩm; kiểm tra truy vấn với `EXPLAIN` sau khi áp dụng migration.
- Dùng snapshot giá vốn tại thời điểm bán. Tên và tồn kho hiện tại lấy từ catalog hiện tại; không lưu tồn kho vào tổng hợp lịch sử.
- Đơn đọc theo `orders.read_all` dùng phạm vi toàn bộ; `orders.read_own` chỉ đọc phạm vi cashier hiện tại. Kiểm tra quyền cả trong API/RPC lẫn RLS. Không trả hoặc cache lợi nhuận cho người thiếu `products.cost.read`.

## Tải độc lập theo widget

- Mỗi KPI/sparkline, bảng xếp hạng và bảng mua cùng có query/RPC riêng. Không đặt chúng sau một query tổng chứa mọi dữ liệu.
- Bật/tắt, loading, lỗi và retry theo từng widget. Widget có dữ liệu cache vẫn giữ dữ liệu đó khi lần làm mới lỗi; lỗi của một query không được ẩn hoặc chặn widget khác.
- Không gọi endpoint cho placeholder/chỉ số chưa có nguồn dữ liệu.
- Bảng chi tiết phải lọc, sort, phân trang và trả tổng số dòng ở server. Tính top phần trăm trên toàn tập đã lọc ở server trước khi lấy trang.
- Tồn kho hoặc tên hiện tại không được dùng làm snapshot lịch sử. Nếu cache chứa thông tin catalog hiện tại, phải có phiên bản catalog riêng để làm mới khi tên/tồn thay đổi.

## Cache lịch sử

- Dùng múi giờ báo cáo Việt Nam (`Asia/Ho_Chi_Minh`, UTC+07). Lưu ngày theo dạng `YYYY-MM-DD` và chuyển timestamp thành ngày báo cáo tại database.
- Chỉ ghi thống kê đã tổng hợp của ngày trước hôm nay vào `localStorage`. Ngày hôm nay luôn kiểm tra server khi mở widget và chỉ giữ trong cache bộ nhớ thời gian ngắn; không đưa dòng hóa đơn hoặc token vào storage.
- Sau khi xác thực người dùng và quyền, hiển thị cache lịch sử ngay. Mỗi widget gửi phiên bản ngày đã cache; server trả phiên bản hiện tại và chỉ trả các ngày KPI thiếu/đã đổi. Endpoint xếp hạng/mua cùng kiểm tra phiên bản trước khi tính lại trang/phạm vi.
- Khóa cache phải phân biệt phiên bản schema/công thức, tài khoản, phạm vi quyền, widget, ngày hoặc khoảng ngày và bộ lọc/phân trang tương ứng. `orders.read_all` và `orders.read_own` không dùng chung cache; quyền giá vốn phải nằm trong khóa.
- Nếu kiểm tra phiên bản thất bại, giữ cache hiện có và báo chưa làm mới được. Phiên bản chỉ tăng trong transaction cập nhật tổng hợp, kể cả khi sửa hoặc hủy đơn của ngày cũ.
- Khi đăng xuất, đổi tài khoản hoặc đổi phạm vi quyền, xóa cache analysis tương ứng trước khi đọc dữ liệu theo scope mới. Query/RPC vẫn là nguồn quyết định quyền; cache chỉ tăng tốc hiển thị.
- Tổng dung lượng localStorage cho analysis tối đa **3 MiB**. Khi vượt ngưỡng hoặc gặp quota, bỏ dữ liệu ít dùng gần nhất; cache hỏng, không khả dụng hoặc quá lớn phải được bỏ qua an toàn.
- Không lưu raw `order_items`, access token, thông tin xác thực, giỏ hàng hoặc dữ liệu form.

## Kiểm chứng khi thêm trang analysis

- Đối chiếu kết quả tổng hợp với nguồn đơn trong transaction hoặc dữ liệu cô lập. Bao gồm quantity lẻ, Combo, nhiều ngày có sản lượng khác nhau, mẫu số 0, thiếu giá vốn, phân bổ chiết khấu và distinct theo toàn kỳ.
- Kiểm tra sửa dòng/chiết khấu, hủy đơn và đổi ngày/người bán; chạy backfill lại và ghi đồng thời để xác nhận delta/version nhất quán.
- Kiểm tra quyền Admin/Employee, direct RPC/RLS và cache theo scope. Không dùng dữ liệu live chung làm fixture có ghi.
- Làm chậm hoặc làm lỗi có chủ đích một widget để xác nhận các widget khác vẫn hiển thị và retry độc lập. Kiểm tra cache hit, ngày cũ đổi phiên bản, và ngày hôm nay không lưu dài hạn.
- So sánh tải lần đầu/lần sau trên cùng khoảng ngày. Network trình duyệt không được tải toàn bộ dòng hóa đơn; báo cáo riêng kết quả mã nguồn, migration live và UI hai vai trò.
