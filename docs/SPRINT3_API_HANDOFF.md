# Sprint 3 — API và luồng tích hợp

Nguồn: 01 nghiệp vụ homestay, 02 unit/calendar/booking, 03 Sprint3, 04 Booking Engine, 05 chi tiết/checkout/chuyến đi, 06 §2.3/2.4/state machine; các bổ sung đã được chủ dự án duyệt riêng. Không sửa API Auth/tin trọ đang sử dụng. Chưa phải hướng dẫn chạy production.

## Chạy ở máy khác

1. Cài đúng Node theo `engines`, PostgreSQL16/PostGIS và Redis7. `npm ci` riêng backend/frontend theo lockfile. Tạo env riêng từ mẫu, không gửi env thật lên Git.
2. Backend cần DATABASE_URL, REDIS_PASSWORD và các JWT/BFF secret hiện có. Quote cần HOMESTAY_QUOTE_SECRET >=32 ký tự, khác JWT access/refresh. Không log secret, quoteToken, OTP hoặc nội dung khách.
3. Review/backup DB đích trước `npm run db:deploy` (backend). Có12 migration additive; không sửa/reset migration đã áp dụng. Chưa deploy các migration mới lên DB chính của chủ dự án trong lượt triển khai này.
4. `npm run build`, chạy backend/frontend như setup hiện có. Frontend BFF cần BACKEND_API_URL, FRONTEND_ORIGIN chính xác và cùng BFF_PROXY_SECRET với backend. Dùng cổng/origin nhất quán, không thay bằng forwarding header do client tự gửi.
5. Giữ phòng thử chỉ local/dev với BOOKING_ALLOW_UNCONFIGURED_PAYMENT=true. Mặc định false; production thiếu provider chặn503. BOOKING_MIN_NIGHTLY_PRICE mặc định1. Không tự tạo tài khoản Admin hoặc seed dữ liệu mẫu vào DB đang dùng.
6. `compose.app.local.yaml` nhận LOCAL_HOMESTAY_QUOTE_SECRET, LOCAL_BOOKING_ALLOW_UNCONFIGURED_PAYMENT (false mặc định), LOCAL_BOOKING_MIN_NIGHTLY_PRICE. Không gộp/chạy thêm stack trùng cổng hoặc xóa volume đang có.
7. Danh mục địa chỉ cần nguồn/provenance thật trước onboarding. API trả503 nếu chưa có metadata/dữ liệu. Import vào DB chính là thao tác riêng có kiểm tra nguồn/backup; không dùng fixture synthetic làm danh mục thật.

## Endpoint thực tế (prefix /api/v1)

| Vai trò | Method/path | Payload/query |
|---|---|---|
| Public | GET /homestays/search | page/limit, q, provinceCode; nếu tìm theo ngày phải đủ checkIn/checkOut/adults/children |
| Public | GET /homestays/:slug | chỉ tin/phòng đã duyệt còn public, Host ACTIVE |
| Public | GET /homestays/check-availability | unitId/checkIn/checkOut/adults/children |
| Public | GET /homestays/units/:unitId/calendar | month YYYY-MM/adults/children; chỉ date/isAvailable/price |
| Public | GET /catalog/provinces, /catalog/wards | wards bắt buộc provinceCode; version/asOf/sourceUrl/items |
| Tenant/Host | POST /bookings/hold | unitId, checkInDate, checkOutDate, numAdults, numChildren, guestName, guestPhone, guestEmail?, guestNotes?, quoteToken |
| Tenant/Host | GET /bookings, /bookings/:id | page/limit cho list; chỉ đơn mình |
| Tenant/Host | POST /bookings/:id/cancel | expectedVersion, chỉ chủ đơn chưa trả tiền |
| Host | GET /host/bookings, /host/bookings/:id | chỉ đơn thuộc tin mình |
| Host | POST /host/bookings/:id/accept, /reject, /check-in, /complete | expectedVersion; ownership/state/time kiểm server |
| Host | POST/GET /host/homestays | tạo tin kèm ít nhất1 unit; list page/limit |
| Host | GET/PUT/DELETE /host/homestays/:id | PUT nội dung đầy đủ + expectedVersion; DELETE soft/version |
| Host | POST /host/homestays/:id/hide, /show | expectedVersion, chỉ tin đã duyệt |
| Host | POST /host/homestays/:id/units | unit fields + expectedVersion của property |
| Host | PUT/DELETE /host/homestays/:id/units/:unitId | version của unit; delete bị chặn nếu còn đơn hiệu lực |
| Host | GET /host/calendar/:unitId | month; nội bộ được thấy status/bookingId của phòng mình |
| Host | PUT /host/calendar/:unitId/pricing | expectedVersion, dates[], customPrice (number hoặc null; không được thiếu field) |
| Host | POST /host/calendar/:unitId/toggle-block | expectedVersion, dates[], isBlocked; bulk atomic |
| Admin | GET /admin/homestays, /admin/homestays/:id | hàng chờ duyệt nội dung/revision |
| Admin | POST /admin/homestays/:id/approve, /reject | expectedVersion; audit cùng transaction |
| Admin | PUT /admin/homestays/units/:unitId/fees | expectedVersion, serviceFeeRate, taxRate, commissionRate; audit old/new/actor |

Envelopes: success `{success:true,message,data}`, list thêm `meta:{page,limit,total,totalPages}`; error `{success:false,errorCode,message,errors?}`. Hold trả201, các action trả200. Check actual Swagger `/api/docs` và DTO trước nối form; không đoán field.

Hold, cancel, Host booking actions và calendar writes bắt buộc `Idempotency-Key` (1–128 ký tự ASCII không khoảng trắng). Gắn user/operation/target/bodyhash,7ngày. Cùng key+body replay đúng data cũ; nội dung khác409 IDEMPOTENCY_CONFLICT. Sau timeout mạng, retry body/key cũ hoặc kiểm tra My Bookings; không tự cấp key mới để tạo lại đơn.

Unit fields: unitName, maxAdults, maxChildren, maxGuests?, maxNights1–90, bedrooms, bathrooms, basePricePerNight, weekendPricePerNight?, cleaningFee, checkInTime/checkOutTime/sameDayBookingCutoff dạng HH:mm:ss, cancellationPolicy FLEXIBLE/MODERATE/STRICT, instantBook. Host không nhận fee/tax/commission. Property fields theo DTO: title/description/propertyType HOMESTAY hoặc VILLA/addressDetail/provinceCode/wardCode/latitude/longitude/amenityIds/imageUrls/videoUrl. Server ảnh chưa nối: imageUrls khác rỗng trả503, không nhận URL tùy ý để né upload; video metadata không coi là upload thật.

## Luồng khách / Host

- Quote chỉ báo giá, không giữ phòng. [checkIn,checkOut), mỗi đêm custom > Fri/Sat > base; phí vệ sinh một lần; Decimal HALF_UP, tổng=sum các khoản. QuoteToken15phút độc lập Idempotency-Key.
- Hold tính lại cùng hàm trong transaction khóa DB. Giá/snapshot khác quote trả409 PRICE_CHANGED kèm `data` là quote mới; UI phải cho khách xác nhận giá mới, không tự retry chấp nhận giá. Token hết hạn400 QUOTE_EXPIRED, sai binding400 INVALID_QUOTE_TOKEN.
- Instant → PENDING_PAYMENT; Request → PENDING_HOST_APPROVAL, Host accept → PENDING_PAYMENT. Hạn12h/15m bị cắt tại giờ nhận phòng với Request. UI dùng expiresAt + serverTime, không cố định15phút cho mọi đơn.
- Khi chưa có provider trả payment:null, paymentStatus=NOT_CONFIGURED, không PAID/CONFIRMED. Reject, timeout hoặc guest cancel chưa trả tiền nhả tồn; DB overlap guard + lock unit là nguồn bảo đảm, không chỉ Redis.
- Chỉ Host sở hữu được check-in đơn PAID/CONFIRMED trong khung giờ; complete PAID/CHECKED_IN sau giờ trả. Các test PAID là fixture riêng, không có endpoint giả thanh toán. No-show chưa có nghiệp vụ, không tự hoàn tất theo đồng hồ.
- Revision giữ bản duyệt cũ đến Admin duyệt; calendar override/block có hiệu lực ngay nhưng không sửa snapshot đơn. Có đơn hiệu lực chỉ ẩn, không soft delete; lịch sử không bị xóa cứng.
- Worker BullMQ dùng deadline DB và recovery scan15s sau restart; không cần khách mở trang để hết hạn. Cache public15s; hold luôn recheck DB.

## Giao diện tối thiểu và ranh giới làm đẹp

Routes: /homestay, /homestay/:slug, /checkout, /bookings, /host/bookings. Component ở `frontend/src/features/homestays/screens.tsx`, types/API ở `frontend/src/lib/api/homestays.ts`. CSS s3-* dùng token brand sẵn có. Login/refresh/access-memory/httpOnly-cookie dùng cơ chế Auth hiện có.

Người làm đẹp có thể tách JSX/presentation/CSS, giữ props/handler/query keys/body/Idempotency-Key và các cảnh báo chưa thanh toán. Không lưu access/refresh hoặc thông tin khách trong localStorage/URL; không tự đánh dấu paid/confirmed. Không biến public calendar thành API có PII. Không dùng demo fallback khi API lỗi, không tự viết payment/Portal Sprint4.

Kiểm thử: `npm test`, `npm run test:booking:unit:coverage` (unit, I/O mock), `npm run test:listings:integration`, `npm run test:booking:coverage` (coverage integration với DB thật); browser `npm run test:homestay:browser:integration` cần frontend đã build và Playwright test runtime có Chromium/Edge. Test DB UUID/Redis namespace riêng; không dùng production. Ngày/kết quả/skip chính xác ở `SPRINT3_IMPLEMENTATION_PROGRESS_LOCAL.md`.
