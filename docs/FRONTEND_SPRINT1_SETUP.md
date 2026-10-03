# Frontend Sprint 1 — Chạy local

## Yêu cầu

- Khuyến nghị Node `24.15.0` và npm; engines đồng bộ backend (`^22.22.3 || ^24.15.0 || >=26.0.0`).
- Backend/API tại `http://localhost:5000/api/v1`; xem `docs/BACKEND_SPRINT1_SETUP.md`.

## Cài và chạy

Từ repo root:

```powershell
Copy-Item frontend/.env.example frontend/.env.local
Set-Location frontend
npm ci
npm run dev
```

macOS/Linux:

```sh
cp frontend/.env.example frontend/.env.local
cd frontend
npm ci
npm run dev
```

Mở `http://localhost:3000`. Backend `FRONTEND_ORIGIN`/`CORS_ORIGINS` và frontend `FRONTEND_ORIGIN` phải cùng `http://localhost:3000`. Route Handler gọi upstream bằng `BACKEND_API_URL` chỉ phía server; không đặt backend URL vào biến `NEXT_PUBLIC_*`.

`BFF_PROXY_SECRET` trong frontend `.env.local` phải giống backend `.env`, ít nhất 32 ký tự. Giá trị mẫu dùng local; thay bằng secret ngẫu nhiên trước triển khai. `TRUSTED_CLIENT_IP_HEADER` để trống ở local. Chỉ cấu hình header này khi edge proxy của bạn ghi đè IP đơn và chặn truy cập bỏ qua edge; chi tiết ở hướng dẫn backend.

## Scripts

```sh
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

Auth pages: `/login`, `/register`, `/verify-otp`, `/forgot-password`, `/reset-password`. `/account` hiển thị phiên và role hiện tại.

OTP provider hiện ở mock local; mã `devOtp` hiện trong giao diện khi backend mock trả về. Không dùng backend mock OTP ở production.

Login, refresh, reset và logout cùng dùng Web Locks để cập nhật cookie và memory theo thứ tự giữa các tab. BroadcastChannel kèm revision không chứa token trong storage; tab bỏ thông báo của phiên cũ. Trình duyệt cần Web Locks trên secure context (HTTPS hoặc localhost). Kiểm thử nhiều tab browser và thiết bị mobile thật còn cần xác nhận.

`/`, `/thue-phong-tro`, `/homestay`, `/phong-tro/1` hiển thị phòng mẫu để xem UI; các chức năng đặt phòng/đặt lịch/liên hệ chưa nối backend. Auth dùng API thật được cấu hình qua Route Handlers. Không cần thư mục giao diện nguồn trên máy khác để chạy frontend này.
