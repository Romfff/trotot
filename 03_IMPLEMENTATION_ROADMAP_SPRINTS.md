# LỘ TRÌNH TRIỂN KHAI DỰ ÁN & KẾ HOẠCH SPRINT (10 TUẦN)
## HYBRID RENTAL PLATFORM (PHÒNG TRỌ & HOMESTAY)

---

## 1. TỔNG QUAN LỘ TRÌNH 10 TUẦN (5 SPRINTS x 2 TUẦN)

Mô hình triển khai chuẩn Agile/Scrum rút gọn cho **2 Developers**:
- **Sprint Cycle:** 2 tuần / sprint.
- **Daily Sync:** 15 phút mỗi sáng (Dev 1 & Dev 2 đồng bộ tiến độ, tháo gỡ điểm nghẽn).
- **Sprint Demo & Review:** Cuối mỗi thứ Sáu của tuần thứ 2 mỗi Sprint.

```mermaid
gantt
    title LỘ TRÌNH 10 TUẦN TRIỂN KHAI DỰ ÁN (2 DEVELOPERS)
    dateFormat  YYYY-MM-DD
    section Sprint 1: Nền Móng & Auth
    Thiết lập Repo, DB, Docker, Auth API (Dev 1)      :s1_d1, 2026-10-01, 14d
    Thiết kế Design System, Layout, Auth UI (Dev 2)    :s1_d2, 2026-10-01, 14d
    section Sprint 2: Phòng Trọ Dài Hạn
    Listing API, PostGIS Radius Search, Media (Dev 1)  :s2_d1, 2026-10-15, 14d
    Trang Tìm Trọ, Bộ lọc, Bản đồ, Chi tiết (Dev 2)   :s2_d2, 2026-10-15, 14d
    section Sprint 3: Homestay & Booking Engine
    Calendar Engine, Redis Lock, Booking API (Dev 1)   :s3_d1, 2026-10-29, 14d
    Flow Đặt Homestay, Chọn ngày, Tóm tắt giá (Dev 2)  :s3_d2, 2026-10-29, 14d
    section Sprint 4: Thanh Toán & Host Portal
    Tích hợp VietQR, VNPay, Webhook IPN, Payout (Dev 1):s4_d1, 2026-11-12, 14d
    Portal Chủ nhà: Lịch tháng, Doanh thu, QR (Dev 2)  :s4_d2, 2026-11-12, 14d
    section Sprint 5: Admin CMS, SEO & Production
    BullMQ Queue, Audit Log, Server Deployment (Dev 1) :s5_d1, 2026-11-26, 14d
    Admin CMS, SEO Microdata, Kiểm thử UAT (Dev 2)     :s5_d2, 2026-11-26, 14d
```

---

## 2. KẾ HOẠCH CHI TIẾT TỪNG SPRINT

### SPRINT 1: NỀN MÓNG HỆ THỐNG & XÁC THỰC NGƯỜI DÙNG (Tuần 1 - Tuần 2)
> **Mục tiêu Sprint 1:** Hoàn thiện hạ tầng Backend, CSDL PostgreSQL/Redis, khung ứng dụng Frontend Next.js, hệ thống Auth JWT, Đăng ký/Đăng nhập người dùng và quản lý phân quyền (Tenant, Host, Admin).

| Lập Trình Viên | Hạng Mục Công Việc Cụ Thể | Sản Phẩm Bàn Giao (Deliverables) |
|:---|:---|:---|
| **Dev 1 (Backend)** | 1. Khởi tạo Repo NestJS + Prisma ORM + TypeScript.<br>2. Cấu hình Docker Compose: PostgreSQL 16 (PostGIS) + Redis 7.<br>3. Tạo Migration Schema bảng `users`, `host_profiles`, `refresh_tokens`.<br>4. Xây dựng Auth Module: Đăng ký, Đăng nhập (Phone/Password), OTP SMS (mock/Zalo), JWT Access/Refresh Token, RBAC Guards.<br>5. Tích hợp Swagger OpenAPI tự động sinh tài liệu API.<br>6. Thiết lập Storage Module upload ảnh lên Cloudinary / Cloudflare R2. | - Docker Compose chạy 1 lệnh `docker compose up -d`.<br>- Swagger UI tại `/api/docs` chạy chuẩn.<br>- API upload file đơn & đa file có resize/nén ảnh. |
| **Dev 2 (Frontend)** | 1. Khởi tạo Next.js 14/15 App Router + TailwindCSS + Shadcn UI.<br>2. Xây dựng Design System: Bảng màu thương hiệu (Primary, Secondary, Accent), typography, nút bấm, modal, input, dropdown.<br>3. Xây dựng Main Layout (Header, Navigation Bar, Footer, Mobile Bottom Bar).<br>4. Xây dựng màn hình Đăng ký / Đăng nhập / Quên mật khẩu / Xác thực OTP.<br>5. Tích hợp Zustand lưu User State + TanStack Query cấu hình API client (Axios interceptor tự refresh token). | - Bộ UI Components tái sử dụng trong thư mục `@/components/ui`.<br>- Luồng Auth mượt mà, lưu token an toàn trong Cookie / LocalStorage.<br>- Responsive hoàn hảo trên iPhone và Android. |

---

### SPRINT 2: PHÂN HỆ PHÒNG TRỌ DÀI HẠN (MÔ HÌNH NHÀ TỐT) (Tuần 3 - Tuần 4)
> **Mục tiêu Sprint 2:** Hoàn thiện 100% nghiệp vụ phòng trọ dài hạn: Chủ nhà đăng tin, Khách hàng tìm kiếm theo địa điểm, bán kính trường học, lọc tiện ích, xem chi tiết và đặt lịch xem phòng.

| Lập Trình Viên | Hạng Mục Công Việc Cụ Thể | Sản Phẩm Bàn Giao (Deliverables) |
|:---|:---|:---|
| **Dev 1 (Backend)** | 1. Migration bảng `properties`, `long_term_details`, `amenities`, `property_images`, `viewing_appointments`.<br>2. API Đăng tin phòng trọ (Multi-step DTO validation).<br>3. API Tìm kiếm & Lọc nâng cao: Lọc theo Tỉnh/Huyện, khoảng giá, diện tích, tiện ích có sẵn.<br>4. Viết Raw SQL PostGIS `ST_DWithin` tìm trọ quanh tọa độ trường ĐH/BV.<br>5. API Đặt lịch hẹn xem phòng (`/api/appointments`) và thông báo cho chủ nhà. | - Trọn bộ CRUD Listing API cho phòng trọ.<br>- API Search trả kết quả dưới 100ms với phân trang cursor/offset.<br>- Seed dữ liệu 63 tỉnh thành & các trường ĐH lớn tại VN. |
| **Dev 2 (Frontend)** | 1. Xây dựng Form Đăng Tin Trọ cho Chủ Nhà: Upload nhiều ảnh, kéo thả sắp xếp, chọn địa chỉ qua dropdown 3 cấp (Tỉnh -> Huyện -> Xã), nhập bảng phí điện/nước.<br>2. Xây dựng Trang Tìm Kiếm (Listing Page): Tích hợp bản đồ Leaflet hiển thị các ghim phòng trọ kèm giá.<br>3. Xây dựng Trang Chi Tiết Phòng Trọ: Slider ảnh, bảng tính chi phí tạm tính, danh sách tiện nghi, nút "Gọi ngay", "Chat Zalo", Modal "Đặt lịch xem phòng".<br>4. Trang quản lý lịch hẹn xem phòng cho cả Khách và Chủ trọ. | - Màn hình đăng tin trực quan dễ dùng.<br>- Bản đồ tương tác mượt mà trên mobile, click vào pin hiện popup tóm tắt phòng.<br>- Trang chi tiết hiển thị đầy đủ thông tin chuẩn Nhà Tốt. |

---

### SPRINT 3: PHÂN HỆ HOMESTAY & ENGINE ĐẶT PHÒNG (MÔ HÌNH AGODA) (Tuần 5 - Tuần 6)
> **Mục tiêu Sprint 3:** Xây dựng cỗ máy Booking Engine cho Homestay: Quản lý phòng trống, kiểm tra trùng lịch (Collision check), cơ chế khóa phòng tạm thời bằng Redis Redlock, tính toán chi phí theo số đêm và phụ phí.

| Lập Trình Viên | Hạng Mục Công Việc Cụ Thể | Sản Phẩm Bàn Giao (Deliverables) |
|:---|:---|:---|
| **Dev 1 (Backend)** | 1. Migration bảng `homestay_units`, `calendar_pricing`, `bookings`.<br>2. API kiểm tra phòng trống theo dải ngày `[check_in, check_out]` và số khách.<br>3. Xây dựng thuật toán tính giá: `(Giá ngày thường x n đêm) + (Giá cuối tuần x m đêm) + Phí vệ sinh + Phí dịch vụ`.<br>4. API Giữ chỗ phòng (Hold Booking): Cơ chế **Redis Redlock** khóa ngày trong 15 phút.<br>5. API Quản lý trạng thái Booking (`PENDING` -> `CONFIRMED` -> `CANCELLED`).<br>6. BullMQ Job tự động giải phóng phòng (Release Lock & Cancel Booking) sau 15 phút nếu khách không thanh toán. | - Cỗ máy Booking Engine không bao giờ bị lỗi trùng phòng (Double Booking).<br>- Background worker giải phóng phòng tự động theo thời gian thực.<br>- Unit Test đạt 90% coverage cho luồng Hold & Check collision. |
| **Dev 2 (Frontend)** | 1. Xây dựng Bộ Chọn Ngày & Khách (Date Range Picker & Guest Counter) phong cách Agoda/Airbnb.<br>2. Trang Chi Tiết Homestay: Hiển thị tình trạng còn phòng theo ngày, chính sách nhận/trả phòng, quy định hủy phòng.<br>3. Màn hình Checkout (Xác nhận đặt phòng):<br>   - Tóm tắt chi tiết chuyến đi (Ngày, số đêm, số khách).<br>   - Bảng phân tích chi phí chi tiết.<br>   - Đồng hồ đếm ngược 15:00 phút thanh toán.<br>4. Trang Danh Sách Chuyến Đi của Khách (My Bookings) hiển thị mã đặt phòng và trạng thái. | - UI Chọn ngày trực quan, disable những ngày đã kín phòng.<br>- Màn hình thanh toán chuẩn thương mại điện tử du lịch.<br>- Trải nghiệm mượt mà, phản hồi ngay lập tức khi chọn ngày. |

---

### SPRINT 4: THANH TOÁN TỰ ĐỘNG & PORTAL CHỦ NHÀ (Tuần 7 - Tuần 8)
> **Mục tiêu Sprint 4:** Tích hợp cổng thanh toán trực tuyến VietQR quét mã tự động (SePAY / PayOS) & VNPAY, Webhook tự động cập nhật trạng thái đơn đặt phòng; Xây dựng Cổng thông tin cho Chủ nhà quản lý lịch và giá.

| Lập Trình Viên | Hạng Mục Công Việc Cụ Thể | Sản Phẩm Bàn Giao (Deliverables) |
|:---|:---|:---|
| **Dev 1 (Backend)** | 1. Tích hợp VietQR (PayOS / SePAY API): Sinh mã QR động có sẵn nội dung chuyển khoản và số tiền chính xác từng đồng.<br>2. Tích hợp VNPAY Sandbox (URL Redirect & IPN Webhook).<br>3. Xây dựng Webhook Receiver có cơ chế Idempotency Key (chống xử lý trùng webhook) và xác thực chữ ký (Signature HMAC SHA512).<br>4. Module Payout & Đối soát ví: Tính toán hoa hồng sàn giữ lại và số tiền thực nhận của chủ nhà.<br>5. Thiết lập WebSocket Gateway (Socket.io) thông báo đơn hàng thành công ngay lập tức về phía Client. | - Luồng thanh toán quét QR tự động xác nhận trong 3 - 5 giây.<br>- Webhook bảo mật tuyệt đối, chống gian lận thay đổi số tiền.<br>- Bảng lưu vết giao dịch `transactions` chuẩn kiểm toán tài chính. |
| **Dev 2 (Frontend)** | 1. Màn hình Thanh toán QR Code: Hiển thị mã QR VietQR động, tài khoản ngân hàng, số tiền, cú pháp chuyển khoản, kèm nút "Sao chép nhanh" và hiệu ứng chờ thanh toán tự động nhảy trang khi thành công.<br>2. Xây dựng **Host Portal - Lịch Tháng (Calendar Matrix View)**:<br>   - Cho phép chủ Homestay click chọn từng ngày để đổi giá hoặc Khóa phòng (Block date).<br>   - Hiển thị các khối đặt phòng màu sắc theo trạng thái.<br>3. Màn hình Quản lý Doanh thu & Lịch sử nhận tiền của Chủ nhà.<br>4. Trang cài đặt thông tin tài khoản ngân hàng nhận tiền (Payout Settings). | - Trải nghiệm thanh toán QR siêu tiện lợi cho người dùng Việt Nam.<br>- Giao diện Lịch phòng chuẩn Agoda YCS / Airbnb Host Calendar.<br>- Biểu đồ trực quan doanh thu theo tháng cho chủ nhà. |

---

### SPRINT 5: ADMIN DASHBOARD, ĐÁNH GIÁ, SEO & TRIỂN KHAI (Tuần 9 - Tuần 10)
> **Mục tiêu Sprint 5:** Hoàn thiện CMS quản trị duyệt tin, module đánh giá xác thực, hệ thống realtime chat cơ bản, tối ưu hóa SEO Google cho các trang phòng trọ và bàn giao Production.

| Lập Trình Viên | Hạng Mục Công Việc Cụ Thể | Sản Phẩm Bàn Giao (Deliverables) |
|:---|:---|:---|
| **Dev 1 (Backend)** | 1. API Đánh giá & Bình luận (Verified Reviews): Chỉ cho phép review khi `booking_status = COMPLETED`.<br>2. API Admin CMS: Duyệt/từ chối tin đăng phòng, quản lý người dùng (Ban/Unban), danh sách khiếu nại, báo cáo doanh thu toàn sàn.<br>3. Module Realtime Chat đơn giản giữa Khách & Chủ nhà qua Socket.io.<br>4. Tối ưu hiệu năng: Redis Cache cho trang chủ & danh mục tìm kiếm, tối ưu Query Indexing PostgreSQL.<br>5. Thiết lập Nginx Reverse Proxy, SSL Let's Encrypt, CI/CD GitHub Actions deploy tự động lên VPS Linux (Ubuntu / Docker). | - Hệ thống hoạt động ổn định trên Production VPS.<br>- Tải trang API < 150ms dưới tải 500 requests/s.<br>- Tài liệu vận hành server và sao lưu CSDL hàng ngày. |
| **Dev 2 (Frontend)** | 1. Xây dựng **Admin CMS Dashboard**: Duyệt tin trọ nhanh (Preview ảnh, duyệt 1-click), Thống kê số lượng tin đăng, GMV (Tổng giá trị giao dịch).<br>2. Component Viết đánh giá & Chấm điểm sao (Cleanliness, Location, Value).<br>3. Hộp thoại Chat Realtime nổi ở góc màn hình.<br>4. **Tối ưu SEO On-page:**<br>   - Tự động sinh `sitemap.xml` và `robots.txt`.<br>   - Cấu hình Meta Tags, Open Graph, Twitter Cards động theo từng tin trọ.<br>   - Gắn cấu trúc dữ liệu JSON-LD Schema (`Product`, `LodgingBusiness`, `BreadcrumbList`).<br>5. Kiểm thử UAT toàn bộ luồng trên đa thiết bị (iOS Safari, Android Chrome, Desktop). | - Điểm Google Lighthouse SEO & Best Practices đạt > 90 điểm.<br>- Hệ thống hoàn thiện 100% sẵn sàng chạy marketing và onboarding người dùng thật. |

---

## 3. TIÊU CHÍ NGHIỆM THU (DEFINITION OF DONE - DOD)

Mỗi tính năng chỉ được coi là hoàn tất khi:
1. **Mã nguồn sạch:** Code tuân thủ TypeScript strict mode, không có lỗi `any` bừa bãi, không có lint error.
2. **Kiểm thử đầy đủ:** Các API nghiệp vụ trọng yếu (Booking, Lock, Payment Webhook) có Unit Test và Integration Test mô phỏng.
3. **Responsive 100%:** Giao diện hiển thị tốt từ màn hình di động 375px đến màn hình 2K.
4. **Bảo mật:** Không để lộ biến môi trường bí mật (`.env`), SQL Injection được chặn bởi ORM, mật khẩu mã hóa bcrypt, API có Rate Limiter chống spam.
