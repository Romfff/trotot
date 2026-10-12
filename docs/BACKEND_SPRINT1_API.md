# Backend Sprint 1 — API contract triển khai

Base URL theo file 06: `http://localhost:5000/api/v1`. Swagger theo deliverable gốc: `http://localhost:5000/api/docs`.

## Envelope và lỗi

Response thành công:

```json
{"success":true,"message":"Yêu cầu thành công.","data":{}}
```

Lỗi giữ các trường chuẩn trong file 06:

```json
{"success":false,"errorCode":"INVALID_CREDENTIALS","message":"Thông báo an toàn","errors":[{"field":"password","message":"..."}]}
```

HTTP status phản ánh lỗi thật: validation 400, chưa xác thực 401, thiếu quyền 403, trùng tài khoản 409, vượt giới hạn 429, dịch vụ phụ thuộc/storage chưa sẵn sàng 503. Lỗi máy chủ không trả stack hoặc thông tin provider cho client.

## Auth

| Method | Path | Auth | Nội dung |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | `{phone,password,fullName,email?}`; role luôn `TENANT`, chưa tự đăng nhập |
| POST | `/auth/login` | Public | `{phone,password}`; trả `{accessToken,refreshToken,user}`; yêu cầu phone đã xác thực và account ACTIVE |
| POST | `/auth/send-otp` | Public | `{phone,purpose?}`; purpose mặc định `VERIFY_PHONE`, giá trị `VERIFY_PHONE` hoặc `RESET_PASSWORD` |
| POST | `/auth/verify-otp` | Public | `{phone,code}`; chỉ xác thực phone, OTP 6 số, dùng một lần |
| POST | `/auth/refresh-token` | Public | `{refreshToken}`; xoay refresh token, token cũ bị thu hồi |
| GET | `/auth/me` | Bearer | Trả thông tin user an toàn, không có password hash hoặc thông tin ngân hàng |
| POST | `/auth/logout` | Refresh credential trong body | `{refreshToken}`; thu hồi đúng phiên của credential, không cần Bearer |
| POST | `/auth/forgot-password` | Public | `{phone}`; gửi OTP mục đích `RESET_PASSWORD` |
| POST | `/auth/reset-password` | Public | `{phone,code,newPassword}`; đổi mật khẩu và thu hồi toàn bộ refresh token |

Các route logout/forgot/reset hỗ trợ giao diện Sprint 1 nhưng không có trong bảng endpoint gốc file 06; đây là contract bổ sung của implementation, không sửa file 06. Sai lệch tên/path/payload cần được đồng đội xác nhận trước khi UI tích hợp.

Logout xác thực quyền thu hồi bằng SHA-256 của refresh credential khớp chính xác bản ghi DB; không dùng Bearer để chọn tài khoản. Token không có bản ghi trả 401. Token đã thu hồi có bản ghi trả 200 idempotent; token đã hết hạn vẫn có thể thu hồi nếu còn bản ghi. Không cấp token mới và không phụ thuộc quota/Redis. Next BFF chỉ lấy credential từ cookie HttpOnly (không lấy từ body browser), giữ kiểm tra Origin/JSON và xóa cookie; refresh token không trả về browser JSON. Thu hồi phiên hiện tại, không tự thu hồi các phiên đăng nhập độc lập khác của user. Nếu DB/backend không xác nhận, trả lỗi và UI không tuyên bố đã thu hồi server.

Access token mặc định 15 phút; refresh token mặc định 30 ngày; OTP mặc định 5 phút, chờ 60 giây mới xin lại, tối đa 5 lần thử. Đây là lựa chọn triển khai/config, không phải giá trị được plan gốc chốt. Các giá trị có thể cấu hình trong `.env`.

Mặc định rate limit theo fixed window lưu Redis (số lần/tài khoản/IP, không phải yêu cầu nguyên văn trong plan): register 10/IP và 5/phone mỗi giờ; login 20/IP và 8/phone mỗi 15 phút; gửi OTP 10/IP mỗi 15 phút và 5/phone mỗi giờ; verify OTP 30/IP mỗi 15 phút và tối đa 5 mã sai/phone trong TTL; refresh 30/IP mỗi 15 phút; reset password 10/IP và 5/phone mỗi 15 phút. Vượt giới hạn trả HTTP 429; các key phone được hash trước khi ghi vào Redis.

Cập nhật 02/10: refresh thêm 30/token và 30/user mỗi 15 phút. Token/IP chịu giới hạn riêng trước kiểm tra phiên; user chỉ bị tính lượt sau khi phiên còn hiệu lực được claim trong transaction. Token đã thu hồi/hết hạn/sai hoặc bị reset thu hồi lúc chờ lock không tiêu hao hạn mức user. Qua BFF local không có edge IP, bỏ bucket IP chung nhưng giữ token/phone/OTP/user limits; khi public phải cấu hình IP edge tin cậy theo setup.

`send-otp` có response `data.devOtp` chỉ ở local/dev để người test tiếp tục luồng; tuyệt đối không xuất trường này ở production. Chưa có Zalo/SMS adapter; mode mock không được dùng trong production.

Verify/reset claim OTP có TTL trước update DB, chỉ finalize sau transaction. Callback DB thất bại/rollback phục hồi đúng claim còn hạn, không ghi đè mã mới gửi. Nếu commit không rõ kết quả hoặc process chết, mã giữ trạng thái không dùng được và cần gửi mã mới (fail-closed); không cam kết retry mã cũ an toàn trong mọi sự cố. Cleanup Redis lỗi sau DB commit không làm response thành thất bại. Endpoint/payload thành công không đổi.

## Media (contract B06 bổ sung)

**Quyết định 03/10/2026:** chủ dự án sẽ dùng server ảnh riêng nhưng chưa có server/API và để nối ảnh sau. Bảng dưới chỉ mô tả adapter Cloudinary đã có trong code, chưa nghiệm thu và không phải contract của server ảnh riêng. Chưa bổ sung endpoint mới hay deploy storage.

Chỉ `HOST` và `ADMIN`, cần Bearer:

| Method | Path | Multipart field | Giới hạn |
| --- | --- | --- | --- |
| POST | `/storage/upload` | `file` | 1 ảnh, 10 MiB |
| POST | `/storage/upload/multiple` | `files` lặp | Tối đa 8 ảnh, 10 MiB/ảnh |

Chấp nhận JPEG, PNG, WebP; kiểm tra magic bytes và decode ảnh, tối đa 25 triệu pixel. Ảnh xoay theo EXIF, thu nhỏ vừa trong 2048×2048, không phóng to, encode WebP quality 82 rồi upload Cloudinary. Response mỗi ảnh gồm `{id,url,format,width,height,bytes}`; giữ thứ tự file gửi lên. Batch lỗi trả thất bại; ảnh đã upload một phần sẽ được xóa best-effort.

Các route media là contract do B06 cần bổ sung vì file 06 chưa chỉ định route/field/quyền/giới hạn. Chỉ cấu hình Cloudinary; không có credential thì trả 503 và không lưu local.
