# Backend Sprint 1 — Setup local

Tài liệu này chỉ hướng dẫn backend B01–B06. Backend được chạy ngoài Docker; Compose chỉ khởi động PostgreSQL/PostGIS và Redis. Chưa có lệnh deploy production trong Sprint này.

## Yêu cầu máy chạy

- Git.
- Node.js `22.22.3+` trong nhánh 22, `24.15.0+` trong nhánh 24, hoặc `26+`; khuyến nghị Node 24.15.0 đã kiểm thử. Các nhánh 23/25 không nằm trong engines của Nest CLI hiện tại.
- Docker Engine/Desktop và Docker Compose v2 có hỗ trợ `--wait`.
- Không cần dịch vụ ảnh để chạy Auth. Theo quyết định hiện tại, server ảnh riêng chưa có API và kết nối upload được hoãn.

## Cài lần đầu (PowerShell)

Tại thư mục gốc repo:

```powershell
Copy-Item .env.example .env
docker compose up -d --wait --wait-timeout 120
Set-Location backend
npm ci
npm run db:generate
npm run db:deploy
npm run start:dev
```

## Cài lần đầu (macOS/Linux)

Tại thư mục gốc repo:

```sh
cp .env.example .env
docker compose up -d --wait --wait-timeout 120
cd backend
npm ci
npm run db:generate
npm run db:deploy
npm run start:dev
```

`.env.example` chỉ có giá trị local-dev minh họa. Trước khi chia sẻ môi trường, thay password PostgreSQL, Redis và hai JWT secret bằng các giá trị ngẫu nhiên riêng. Backend và Compose đều yêu cầu `REDIS_PASSWORD`; giữ giá trị đó đồng bộ trong `.env`.

Tạo mỗi secret riêng bằng PowerShell (`[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`) hoặc macOS/Linux (`openssl rand -hex 32`). Dùng chuỗi hex làm `POSTGRES_PASSWORD`, `REDIS_PASSWORD` và hai JWT secret; chép cùng password PostgreSQL vào `DATABASE_URL`. Hex tránh ký tự cần URL-encode trong URL kết nối.

Nếu đổi `POSTGRES_USER`, `POSTGRES_PASSWORD` hoặc `POSTGRES_DB`, cập nhật đồng bộ `DATABASE_URL` trong `.env`. Không dùng `docker compose down -v` khi cập nhật vì lệnh đó xóa volume dữ liệu.

## Chạy API

Trong terminal tại `backend/`:

```sh
npm run start:dev
```

- API base: `http://localhost:5000/api/v1`
- Swagger UI: `http://localhost:5000/api/docs`
- Health: `http://localhost:5000/api/v1/health`

Backend yêu cầu PostgreSQL và Redis sẵn sàng lúc khởi động. Lệnh Compose trong phần cài lần đầu đợi cả hai healthcheck healthy trước khi migration chạy.

## Kiểm tra và migration

```sh
npm run db:status
npm run db:deploy
npm run db:generate
npm run build
npm run lint
npm test
```

`db:deploy` chỉ áp migration đã có; tạo migration mới trong phát triển bằng `npm run db:migrate -- --name ten_thay_doi` sau khi xem kỹ diff SQL. Migration hiện tại bật `uuid-ossp` và PostGIS, rồi tạo `users`, `host_profiles`, `refresh_tokens`.

Prisma client không nằm trong Git. Sau `npm ci`, chạy `db:generate` trước khi test hoặc seed; `start:dev` cũng tự generate qua hook `prestart:dev`. Generate cần `DATABASE_URL` trong `.env` nhưng không cần kết nối database.

## Tài khoản demo local

Chỉ dùng trên database local dùng một lần. Thêm `ALLOW_DEV_SEED=true` vào `.env`, sau đó chạy `npm run seed:dev`. Script từ chối môi trường production. Tài khoản demo có số `0999999911` (Tenant), `0999999922` (Host), `0999999933` (Admin); mật khẩu chung `LocalOnly-Trotot-2026!`. Đây là thông tin cố định dành riêng cho local; không dùng lại ở bất kỳ môi trường nào có dữ liệu thật. Xóa `ALLOW_DEV_SEED` sau khi seed.

## Cloudinary

Đây là adapter cũ được giữ lại. Chủ dự án đã chọn server ảnh riêng và xác nhận để kết nối sau; không cần tạo tài khoản Cloudinary để chạy Sprint 1. Phần upload thật chưa nghiệm thu.

Đặt `CLOUDINARY_URL=cloudinary://<api-key>:<api-secret>@<cloud-name>` trong `.env` để bật upload. Không thêm giá trị thật vào `.env.example`, source, log hoặc tài liệu. Nếu chưa có biến này, API vẫn khởi động nhưng upload trả `503 CLOUDINARY_NOT_CONFIGURED`; Sprint B06 chưa được xác nhận hoàn tất.

OTP hiện chỉ có `OTP_PROVIDER=mock` để phát triển và test local. OTP được trả trong `data.devOtp` chỉ ngoài production. Tích hợp Zalo/SMS và vận hành OTP thật chưa nằm trong trạng thái hoàn tất; ứng dụng từ chối khởi động production với mock provider.

## Cập nhật Auth ngày 02/10/2026

Chạy `npm run db:deploy` trước khi khởi động bản mới. Migration bổ sung `users.session_version`, chuẩn hóa số Việt Nam dạng `+849…`, `00849…`, `849…` về `09…`, và thêm constraint chống ghi số chưa chuẩn hóa. Nếu có hai tài khoản cùng số sau chuẩn hóa, migration rollback và báo `Phone normalization collision`. Không xóa hoặc gộp tài khoản tự động; cần quyết định xử lý dữ liệu trùng trước khi chạy lại. Mật khẩu, role và liên kết tài khoản giữ nguyên. Access token cũ thiếu session version sẽ cần refresh; reset mật khẩu tăng version và thu hồi refresh token trong cùng transaction.

Backend `.env` và frontend `.env.local` phải cùng `BFF_PROXY_SECRET`, ít nhất 32 ký tự, không dùng `NEXT_PUBLIC_*`. Giá trị ví dụ chỉ dành cho local. BFF ký ngữ cảnh IP để backend không tính tất cả người dùng vào IP của máy chủ frontend. Không bật `trust proxy` toàn cục và không tin `X-Forwarded-For` do khách gửi.

Local không có edge proxy: để `TRUSTED_CLIENT_IP_HEADER` trống ở frontend. Các giới hạn phone/OTP/user vẫn chạy; BFF không dùng bucket IP chung. Khi triển khai public, cấu hình edge proxy ghi đè một header IP đơn (ví dụ `X-Real-IP`), chặn truy cập trực tiếp vào frontend bỏ qua edge, rồi đặt `TRUSTED_CLIENT_IP_HEADER=x-real-ip`. Backend chỉ nhận ngữ cảnh được BFF ký; giữ API riêng qua loopback/private network. Refresh giới hạn thêm theo user, không chỉ theo IP.

## Kiểm thử tích hợp thật

Khởi động Compose, build frontend và generate Prisma trước. Sau đó tại `backend/` chạy:

```sh
npm run test:integration
```

Script chỉ chấp nhận PostgreSQL/Redis local, tạo database `trotot_auth_test_<uuid>` riêng và namespace Redis riêng; không chạy trên database ứng dụng. Nó áp migration từ đầu, chạy Nest + Next BFF thật trên port tạm, kiểm tra OTP mock/login/rotation/reset/logout/cookie và rate limit, rồi xóa database test và các key test. User PostgreSQL local cần quyền `CREATE DATABASE`. `npm test` thường bỏ qua suite này để không tự kết nối hạ tầng; không coi test bị skip là đã kiểm thử tích hợp.

Giới hạn nghiệm thu: OTP vẫn mock; upload server riêng chưa triển khai. Kiểm thử trên máy đồng đội, nhiều tab browser và thiết bị mobile thật còn cần xác nhận.

## Chuyển cho máy đồng đội

Đồng đội clone repo, cài Node/Docker, tạo `.env` từ `.env.example`, điền secret local, chạy các lệnh lần đầu ở trên rồi gọi `/api/v1/health` và `/api/docs`. Không gửi kèm `.env` hoặc `node_modules`. Chỉ ghi nhận “đã chạy trên máy đồng đội” sau khi người đó tự chạy và xác nhận kết quả; tài liệu này chưa phải bằng chứng máy khác đã chạy.

## Kiểm chứng clean và phục hồi local — 04/10/2026

Clean setup trên cùng máy đã qua `npm ci --offline --no-audit --no-fund`, Prisma generate, build/lint/unit, fresh migration và deploy lặp lại. Source hiện có thêm migration audit moderation `20261004000000_listing_moderation_audit` sau Sprint 2. Migration mới chỉ áp trên DB test; runtime ứng dụng 5000 chưa được nâng. Không lấy clean copy trên cùng máy làm bằng chứng máy đồng đội đã chạy.

[Runbook backup/restore](DATABASE_BACKUP_RUNBOOK.md) mô tả script Bash native pg_dump/gzip/SHA256 và restore vào DB mới. `npm run test:backup:integration` và `npm run test:runtime:restart` chỉ nhận hạ tầng test loopback có guard sở hữu. Đã kiểm tra restore nội dung 15 bảng/4 migrations, audit không rỗng và restart hai container test giữ DB/Redis AOF. Không chạy restart cùng lúc với integration/browser suite. Schedule, retention, offsite, RPO/RTO và phục hồi booking/ledger/worker chưa nghiệm thu.

## P03 kiểm catalog địa chỉ (local, 04/10/2026)

`backend/scripts/check-address-catalog.mjs` chỉ validate file đã review và các XLS nguồn kèm SHA256. Mã tỉnh2chữ số/mã xã5chữ số luôn là string. API catalog nhóm E còn PROPOSED; không có endpoint địa chỉ mới để FE gọi lúc này.

Chạy từ backend trên clean copy đã npmci:

```powershell
npm run test:catalog
npm run catalog:check -- E:/DuAn/trotot/.tmp/s345/address-catalog-nso-2026-10-04.json b59a28ef00e9b4566f19407ec63f1913cc4c277d0e97a7b76d81fbe0e3352d81
npm run test:catalog:integration -- E:/DuAn/trotot/.tmp/s345/address-catalog-nso-2026-10-04.json b59a28ef00e9b4566f19407ec63f1913cc4c277d0e97a7b76d81fbe0e3352d81
```

Integration chỉ nhận root.env `NODE_ENV=test`, loopback và database `trotot_clean_test_<UUID>` của clean infrastructure, tự tạo/xóa database `trotot_catalog_test_<UUID>`. Không chạy với env chính. Không dùng `seed:dev` để nhập catalog thật; script hiện không có lệnh importmain. Real DB dry-run đã kiểm4migrations/3355records/idempotence/FK/SQLfailure/rollback. Nội dung/version/nguồn phải được kiểm lại khi đổi ngày; bảng2025 không đại diện dữ liệu hiện hành04/10/2026.

Raw/normalized exports hiện ở .tmp/s345 cùng checksum, chưa đóng gói dataset vào source bàn giao. DB provenance/import vận hành/API catalog vẫn là acceptance còn thiếu; không coi dry-run là nhập DB chính thành công.

