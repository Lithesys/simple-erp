# Kiểm thử trình duyệt bằng Chrome

## Tài khoản và dữ liệu

Đặt các biến sau trong `.env.local`; tài khoản admin và nhân viên dùng chung mật khẩu:

```dotenv
LOCAL_TEST_ADMIN_ACCOUNT=
LOCAL_TEST_EMPLOYEE_ACCOUNT=
LOCAL_TEST_PASSWORD=
```

Không đưa giá trị thật vào tài liệu, lệnh có thể lưu lịch sử, log, ảnh chụp hoặc commit. Không copy cookie giữa các hồ sơ trình duyệt. Chỉ dùng các tài khoản kiểm thử trên dữ liệu hiện có; không tạo, sửa hoặc xóa dữ liệu.

## Quy trình kiểm thử trình duyệt

1. Chạy `npm run dev` và dùng browser `@Chrome` được kết nối với ứng dụng ChatGPT desktop. Dùng Chrome profile do người dùng chọn cho bài kiểm thử.
2. Nếu `@Chrome` chưa xuất hiện trong menu `@`, bật Chrome trong Settings > Computer Use và dùng profile đã cài ChatGPT extension. Xem [hướng dẫn thiết lập Chrome](https://learn.chatgpt.com/docs/chrome-extension). Không sao chép cookie, session hoặc credentials giữa các profile.
3. Chỉ dùng Browser Use CLI khi người dùng yêu cầu rõ hoặc `@Chrome` không khả dụng. Không dùng Playwright làm mặc định cho browser test của repo này.
4. Đăng nhập tự động theo vai trò bằng URL `http://localhost:3000/login?local-test=admin` và `http://localhost:3000/login?local-test=employee`. Trong development, máy chủ đọc các biến `LOCAL_TEST_ADMIN_ACCOUNT`, `LOCAL_TEST_EMPLOYEE_ACCOUNT` và `LOCAL_TEST_PASSWORD` từ môi trường; không yêu cầu Louis nhập hay gửi thông tin đăng nhập. Luồng này chỉ hoạt động trên localhost khi chạy `npm run dev`; endpoint trả 404 ngoài development, không trả username/mật khẩu ra trình duyệt và chỉ trả token phiên để ứng dụng mở phiên đăng nhập. Chờ quyền và dữ liệu tải xong trước khi đánh giá trang.
5. Kiểm tra danh sách không còn skeleton tải; khi dữ liệu rỗng, xác nhận trạng thái rỗng được hiển thị thay cho skeleton.
6. Kiểm tra các luồng chỉ đọc dưới đây. Quyền của tài khoản quyết định trang nào phải truy cập được.

### Admin

- Mở `/pos`, `/dashboard`, `/account`, `/management/products`, `/management/purchase`, `/stock-check`, `/management/customers`, `/debt`, `/management/orders`, `/management/price-lists`, `/management/accounts` và `/management/roles`.
- Trên các bảng/thẻ thực thể, nhấn vào nội dung hàng để mở modal chi tiết; xác nhận không có nút mắt ngoài bảng. Bút chì chỉnh sửa chỉ xuất hiện trong đầu modal bên cạnh nút đóng và chỉ khi tài khoản có quyền cập nhật. Các thao tác xóa, duyệt, hủy và xuất vẫn ẩn khi thiếu quyền tương ứng.
- Ở Hàng hóa, nhấn ô giá bán/giá vốn để sửa trực tiếp; ô phải giữ focus mà không mở modal chi tiết. Dùng Enter để lưu giá hiện có mà không đổi số và xác nhận focus chuyển tiếp vẫn không mở modal. Không thay đổi giá trên dữ liệu dùng chung.
- Ở thanh điều hướng, hover hoặc dùng bàn phím mở menu Khách hàng; xác nhận mục Quản lý nợ dẫn đến `/debt`. Trong Công nợ, xác nhận bộ lọc ngày mặc định là tháng hiện tại và khôi phục khoảng ngày đã lưu trong localStorage nếu có. Kiểm tra danh sách và các bộ lọc ngày, khách hàng, loại nợ, từ khóa và trạng thái trên cùng một màn hình. Chọn cả khách hàng và loại nợ để xác nhận hàng tổng tự hiện. Kiểm tra lựa chọn Tạo mới có nền xanh, mở rồi đóng modal tạo mới. Mở một hàng để xem chi tiết; nếu có quyền sửa thì xác nhận bút chì nằm cạnh nút đóng và biểu mẫu mở đúng khoản nợ. Không lưu thay đổi hoặc xóa dữ liệu trong kiểm tra chỉ đọc.
- Trên hàng thêm nhanh của Công nợ, xác nhận có ghi chú “Thêm nhanh”; hover để đọc hướng dẫn nhấn Enter sau khi điền đủ thông tin. Không gửi khoản nợ trong kiểm tra chỉ đọc.
- Trên Dashboard, đổi khoảng ngày và xác nhận doanh thu, số đơn, biểu đồ và sản lượng cùng cập nhật. Chỉ xác nhận chỉ số Tiền lời xuất hiện với tài khoản có `products.cost.read`; tài khoản thiếu quyền không được thấy giá trị này.
- Ở Hàng hóa, xác nhận cột Tên hàng có biểu tượng sắp xếp tăng dần; ẩn rồi hiện lại một cột; kéo đổi vị trí hai cột rồi trả về thứ tự ban đầu.
- Ở Hàng hóa, dùng bộ lọc **Tình trạng kinh doanh** để xem hàng đang kinh doanh và hàng đã ngừng. Với vai trò có `products.archive`, xác nhận hàng đã ngừng có nút **Kinh doanh lại**; không bấm nút này trên dữ liệu dùng chung.
- Ở Hàng hóa, mở menu Thêm và chọn Combo; xác nhận form cho phép chọn hàng hóa có sẵn, nhập số lượng lẻ tối đa 3 chữ số thập phân và giá theo từng bảng giá. Đóng form mà không lưu. Nếu cửa hàng đã có Combo, xác nhận POS hiển thị thành phần và số lượng thực tế dưới dòng Combo; xem chi tiết Đơn hàng để xác nhận thành phần được lưu cùng giao dịch. Không thanh toán, sửa hoặc xóa đơn trong kiểm tra chỉ đọc.
- Ở Đơn hàng và Nhập hàng, mở/đóng bộ lọc, kiểm tra ngày, trạng thái, mã đơn và URL sau khi áp dụng/xóa bộ lọc. Xác nhận nút Áp dụng trong bộ chọn ngày tự tải lại Đơn hàng mà không cần bấm Tìm kiếm lần nữa. Không gửi thao tác cập nhật dữ liệu.
- Ở Đơn hàng, xác nhận danh sách mặc định giữ cả đơn hoàn thành và đã hủy. Đơn đã hủy phải còn mở được, hiện trạng thái **Đã hủy**, không có thao tác sửa hoặc hủy lần nữa; không bấm thao tác hủy trong kiểm tra chỉ đọc.
- Ở Kiểm kho, xác nhận tìm kiếm, lọc ngày/trạng thái, sắp xếp, mở chi tiết phiếu và trạng thái tải xong. Không lưu, hoàn thành, sửa hoặc hủy phiếu trên dữ liệu dùng chung.
- Ở Bảng giá, Tài khoản và Vai trò, xác nhận danh sách hoặc thẻ tải xong.

### Nhân viên

- Xác nhận vai trò trong dữ liệu quyền là nhân viên và thanh điều hướng chỉ hiện trang được cấp quyền.
- Nếu nhân viên có `products.read` nhưng không có `products.archive`, xác nhận bộ lọc Hàng hóa vẫn hiển thị các hàng đã ngừng kinh doanh, mở được chi tiết hàng đã ngừng, và không hiện thao tác **Kinh doanh lại**.
- Kiểm tra `/pos`, `/dashboard`, `/account`, `/management/products`, `/management/purchase`, `/management/customers`, `/debt` và `/management/orders` theo quyền của tài khoản.
- Kiểm tra `/stock-check` theo quyền được cấp; xác nhận tài khoản không có quyền xem/ghi không thấy dữ liệu hoặc không thể gọi RPC trái quyền.
- Nếu nhân viên được cấp quyền xem/bán hàng, xác nhận Combo hiển thị thành phần trong POS; không tạo Combo hoặc thanh toán.
- Xác nhận Tài khoản và Vai trò không hiện trong thanh điều hướng. Mở trực tiếp `/management/accounts` và `/management/roles`; trang không được hiển thị bảng dữ liệu trái quyền.

### Chống vòng lặp và lỗi tải

- Sau khi mở trang có bộ lọc, để trang đứng yên ít nhất 30 giây. Xác nhận URL không tự đổi liên tục và Network không lặp cùng truy vấn.
- Thử tải URL đã lọc, áp dụng/xóa bộ lọc, tải lại và dùng Back/Forward. Giá trị bộ lọc, URL và danh sách phải thống nhất.
- Nếu trang vẫn hiện skeleton, kiểm tra Console và Network. Không coi trạng thái loading kéo dài là thành công chỉ vì route trả HTTP 200.
- Nếu tài khoản không có quyền, ghi nhận là bị giới hạn; không dùng tài khoản khác để vượt quyền và không thay đổi role/permission để làm test xanh.

## Cổng kiểm tra và push `main`

Thực hiện cổng này trong phiên làm việc hiện tại; không dựa vào kết quả từ phiên cũ. Với mỗi thay đổi ứng dụng, chạy `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` và kiểm thử hai tài khoản trong `@Chrome` (hoặc Browser Use CLI khi được yêu cầu hay `@Chrome` không khả dụng). Nếu bất kỳ kiểm tra nào lỗi, tìm nguyên nhân, sửa rồi chạy lại các kiểm tra bị ảnh hưởng và toàn bộ cổng trước khi phát hành. Không push khi còn lỗi chưa giải quyết hoặc chưa chạy được.

Louis muốn tự động giao thay đổi: khi toàn bộ kiểm tra tự động và kiểm tra hai vai trò đạt, hãy commit và push các thay đổi dự định lên `origin/main` mà không chờ yêu cầu push riêng. Nếu Louis yêu cầu push tất cả, đưa cả thay đổi tracked và untracked hiện có vào sau khi kiểm tra staged files không chứa credential; ngoài trường hợp đó, giữ lại các ghi chú local không liên quan.

Trước khi commit, xác nhận nhánh là `main` và không có credential trong staged files. Sau push, xác nhận `HEAD` bằng `origin/main` và báo rõ các thay đổi local nào vẫn chưa được commit.
