# KẾ HOẠCH HÀNH ĐỘNG CHI TIẾT DÀNH CHO DEVELOPER 2
## VAI TRÒ: LEAD FRONTEND / UI-UX / CLIENT WEB & HOST PORTAL

> Bản UX ban đầu. Phân vai hiện tại là một người backend, một người thiên UX và hỗ trợ code linh hoạt; xem [kế hoạch mới, mục 4, 6 và 8](07_PRODUCTION_DELIVERY_PLAN.md) để chọn phiên bản còn hỗ trợ, chốt contract, bổ sung trạng thái lỗi và giao người viết frontend. Không coi countdown hoặc Socket event là bằng chứng thanh toán đã hoàn tất.

---

## 1. MỤC TIÊU & TRÁCH NHIỆM CỐT LÕI

Developer 2 là người chịu trách nhiệm về toàn bộ trải nghiệm người dùng (UX) và giao diện trực quan (UI):
- Xây dựng ứng dụng Web chuẩn **Mobile-First** (tối ưu 100% cho màn hình điện thoại vì người tìm phòng trọ tại Việt Nam chủ yếu dùng smartphone).
- Triển khai Framework **Next.js 14/15 App Router** tối ưu tốc độ tải trang và chỉ số SEO Google Core Web Vitals.
- Phát triển giao diện cho 3 phân hệ người dùng:
  1. **Khách hàng (Tenant / Guest):** Tìm trọ theo bản đồ, đặt Homestay theo lịch, thanh toán quét mã QR.
  2. **Chủ nhà (Host / Landlord):** Màn hình đăng tin trực quan, ma trận lịch phòng theo tháng (Calendar Matrix View) để đổi giá và khóa ngày.
  3. **Quản trị viên (Admin):** CMS duyệt tin đăng, thống kê đơn đặt phòng và xử lý khiếu nại.
- Tối ưu hóa SEO On-page: Metadata động, thẻ OpenGraph chia sẻ Zalo/Facebook, cấu trúc JSON-LD Schema.org.

---

## 2. CHECKLIST CÔNG VIỆC THEO TỪNG GIAI ĐOẠN

### Sprint 1: Base Framework, Design System & Auth UI (Tuần 1 - 2)
- [ ] Khởi tạo Next.js 14/15 (TypeScript, TailwindCSS, Shadcn UI)
- [ ] Xây dựng Theme màu, Typography, Bộ Icon Lucide
- [ ] Header, Footer, Bottom Navigation Bar cho Mobile
- [ ] Màn hình Auth (Đăng nhập, Đăng ký, Nhập mã OTP, Reset pass)
- [ ] Cấu hình Axios Client + TanStack Query + Zustand Auth Store

### Sprint 2: Giao Diện Phân Hệ Phòng Trọ Dài Hạn (Tuần 3 - 4)
- [ ] Màn hình Tìm trọ: Bộ lọc đa tiêu chí (Giá, Quận, Tiện ích)
- [ ] Tích hợp Bản đồ Leaflet / Mapbox: Render pin phòng trọ tương tác
- [ ] Trang Chi tiết phòng: Gallery ảnh, Bảng chi phí điện nước, Host card
- [ ] Nút Gọi nhanh, Mở chat Zalo, Modal Đặt lịch xem phòng
- [ ] Form Đăng tin phòng trọ cho Chủ nhà (Kéo thả ảnh, chọn tiện nghi)

### Sprint 3: Giao Diện Đặt Phòng Homestay (Chuẩn Agoda) (Tuần 5 - 6)
- [ ] Component Chọn ngày lưu trú (Date Range Picker) & Chọn khách
- [ ] Khung tóm tắt chi phí Sticky (Giá theo đêm + Phí dịch vụ)
- [ ] Màn hình Checkout: Điền thông tin khách & Đồng hồ đếm ngược 15 phút
- [ ] Trang Quản lý chuyến đi của tôi (My Bookings)

### Sprint 4: Màn Hình Thanh Toán QR & Portal Chủ Nhà (Tuần 7 - 8)
- [ ] Giao diện quét mã QR VietQR động (Copy số tài khoản, Cú pháp)
- [ ] Hiệu ứng Realtime tự động nhảy trang khi thanh toán thành công
- [ ] Host Portal: Ma trận Lịch tháng (Calendar Grid View) cập nhật giá / khóa ngày
- [ ] Dashboard Thống kê doanh thu & Danh sách booking của Host

### Sprint 5: Admin CMS, Đánh Giá & Tối Ưu SEO (Tuần 9 - 10)
- [ ] Admin CMS: Giao diện duyệt tin phòng trọ 1-click
- [ ] Form Đánh giá sao & Nhận xét xác thực sau chuyến đi
- [ ] Popup Chat Realtime với Chủ nhà ở góc màn hình
- [ ] Gắn thẻ Schema.org Microdata & Tối ưu Google Lighthouse > 90

---

## 3. CẤU TRÚC SITEMAP & TRANG (PAGE BREAKDOWN)

```
app/
├── (auth)/
│   ├── login/page.tsx               # Đăng nhập (Số điện thoại / Mật khẩu)
│   ├── register/page.tsx            # Đăng ký tài khoản
│   └── verify-otp/page.tsx          # Xác thực mã OTP
├── (public)/
│   ├── page.tsx                     # Trang chủ (Hero search, Gợi ý trọ, Homestay hot)
│   ├── thue-phong-tro/              # Phân hệ Phòng trọ dài hạn
│   │   ├── page.tsx                 # Danh sách tìm kiếm kèm bản đồ & bộ lọc
│   │   └── [slug]/page.tsx          # Chi tiết phòng trọ, bảng phí, đặt lịch xem
│   ├── homestay/                    # Phân hệ Homestay ngắn hạn
│   │   ├── page.tsx                 # Tìm homestay theo ngày & số khách
│   │   └── [slug]/page.tsx          # Chi tiết homestay, lịch trống, review
│   └── booking/
│       ├── checkout/page.tsx        # Màn hình tóm tắt đặt phòng & đếm ngược
│       └── payment/[bookingId]/     # Màn hình quét mã VietQR tự động
├── (user)/                          # Dành cho khách đã đăng nhập
│   ├── profile/page.tsx             # Thông tin cá nhân
│   ├── my-bookings/page.tsx         # Lịch sử đặt phòng Homestay
│   └── my-appointments/page.tsx     # Lịch sử đặt lịch xem phòng trọ
├── host/                            # Portal dành cho Chủ Nhà (Landlord / Host)
│   ├── dashboard/page.tsx           # Tổng quan doanh thu, số tin đăng
│   ├── properties/
│   │   ├── create/page.tsx          # Đăng tin phòng trọ / Homestay mới
│   │   └── page.tsx                 # Quản lý danh sách bất động sản
│   ├── calendar/[unitId]/page.tsx   # Ma trận Lịch tháng cập nhật giá & khóa ngày
│   └── payouts/page.tsx             # Quản lý tiền về tài khoản ngân hàng
└── admin/                           # Dashboard dành cho Quản Trị Viên
    ├── properties-approval/page.tsx # Duyệt tin đăng mới
    ├── users/page.tsx               # Quản lý người dùng, khóa tài khoản
    └── finance/page.tsx             # Báo cáo doanh thu & đối soát thanh toán
```

---

## 4. CÁC COMPONENT TRỌNG TÂM CẦN XÂY DỰNG

### 4.1. Bộ Chọn Ngày & Khách (Date Range & Guest Picker - Kiểu Agoda)
- Sử dụng thư viện `react-day-picker` (tích hợp sẵn trong Shadcn UI).
- Khi khách chọn ngày:
  - Tự động gọi API `/api/homestay/availability` để lấy các ngày đã bị khóa/đã đặt và disable trên lịch.
  - Hiển thị mức giá ước tính ngay dưới từng con số ngày trên lịch.

### 4.2. Màn Hình Thanh Toán Quét Mã VietQR Thông Minh
- Hiển thị mã QR PayOS / SePAY chuẩn EMVCo.
- Kèm theo nút "Sao chép số tài khoản", "Sao chép nội dung chuyển khoản", "Sao chép số tiền".
- Đồng hồ đếm ngược 15:00: Nếu hết giờ, hiển thị thông báo "Phiên giao dịch đã hết hạn, phòng đã được giải phóng".
- Kết nối WebSocket tới server: Khi nhận event `PAYMENT_SUCCESS`, tự động phát âm thanh thông báo và chuyển hướng sang trang `booking/success`.

### 4.3. Ma Trận Lịch Tháng Dành Cho Chủ Nhà (Host Calendar Matrix View)
- Giao diện lưới lịch 30/31 ngày trực quan:
  - **Màu xanh lá:** Còn trống (Available), hiển thị giá tiền (VD: 650k).
  - **Màu đỏ cam:** Đã có khách đặt (Booked), click vào xem tên khách và số điện thoại.
  - **Màu xám:** Chủ nhà chủ động khóa (Blocked).
- Cho phép kéo thả chọn một khoảng ngày liên tiếp (Multi-select) để mở popup:
  - Đổi giá nhanh cho các ngày đã chọn.
  - Bật/tắt trạng thái Khóa phòng (Block/Unblock).

---

## 5. TỐI ƯU SEO & HIỆU NĂNG TẢI TRANG (CORE WEB VITALS)

1. **Server-Side Rendering (SSR) & Server Components:**
   - Các trang danh sách phòng trọ (`/thue-phong-tro`) và chi tiết (`/thue-phong-tro/[slug]`) phải render phía Server để Google Bot quét toàn bộ nội dung.
2. **Schema.org Microdata (JSON-LD):**
   - Chèn cấu trúc dữ liệu `RentAction` và `LodgingBusiness` để Google hiển thị Rich Snippets (Giá phòng, Đánh giá sao, Địa chỉ) trực tiếp trên kết quả tìm kiếm Google:
     ```tsx
     <script
       type="application/ld+json"
       dangerouslySetInnerHTML={{
         __html: JSON.stringify({
           "@context": "https://schema.org",
           "@type": "Apartment",
           "name": property.title,
           "description": property.description,
           "address": {
             "@type": "PostalAddress",
             "streetAddress": property.addressDetail,
             "addressLocality": property.district,
             "addressRegion": property.province,
           },
           "offers": {
             "@type": "Offer",
             "price": property.monthlyPrice,
             "priceCurrency": "VND",
           }
         })
       }}
     />
     ```
3. **Tối ưu hình ảnh (Next/Image):**
   - 100% hình ảnh phòng trọ dùng component `next/image` với format `webp` hoặc `avif`, tự động lazy-load để đạt điểm Lighthouse Performance > 90.
