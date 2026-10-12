# Homestay availability — API đã kiểm chứng local

> Tài liệu checkpoint lịch sử. Chủ dự án đã cho tiếp tục toàn Sprint 3 sau mốc này. Availability/calendar bên dưới vẫn giữ contract; các câu “chưa có hold/worker/frontend” mô tả thời điểm checkpoint, không còn là trạng thái hiện hành. Xem `SPRINT3_API_HANDOFF.md` và `SPRINT3_IMPLEMENTATION_PROGRESS_LOCAL.md` để tích hợp hiện tại.

Nguồn: 01 §3.2, 02 unit/calendar, 03/04 Sprint3, 06 §2.3 và Q1–Q7 được chủ dự án duyệt trực tiếp ngày04/10/2026. Checkpoint backend lịch công khai/availability/báo giá ký; **dừng trước API giữ phòng**. Không sửa contract Auth/tin trọ đang dùng.

## Endpoint

`GET /api/v1/homestays/check-availability?unitId=<uuid>&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&adults=2&children=0`

Public; mọi query trên bắt buộc. Không nhận `numChildren`/tuổi ở query này: 06 dùng `children` cho availability, `numChildren` cho body booking sau này. Extra fields/repeated fields/UUID/ngày/count sai bị400. Envelope `success/message/data`; response `Cache-Control: no-store`.

```json
{
  "success": true,
  "message": "Yêu cầu thành công.",
  "data": {
    "isAvailable": true,
    "totalNights": 1,
    "quoteToken": "<server-signed-quote-token>",
    "quoteExpiresAt": "2026-10-04T14:30:00.000Z",
    "priceBreakdown": {
      "nightlyPrices": [{ "date": "2026-10-22", "price": 101 }],
      "baseAmount": 101,
      "cleaningFee": 5,
      "serviceFee": 0,
      "taxAmount": 0,
      "totalAmount": 106
    }
  }
}
```

Đây là ví dụ tổng hợp cho làm tròn, không phải phòng/dữ liệu thật. `taxAmount` là phần bổ sung theo quyết định thuế được chốt riêng; giữ toàn bộ field priceBreakdown gốc06. Frontend phải ẩn dòng service/tax bằng0, lấy tổng từ server và không coi `isAvailable:true` là phòng đã được giữ. Không trả commission/hostPayout/PII ra public.

## Quote có chữ ký

- `HOMESTAY_QUOTE_SECRET` bắt buộc cho API quote: >=32 ký tự, độc lập JWT access/refresh. Cấu hình ngoài Git; không dùng giá trị mẫu/dev trong môi trường thật. Thiếu/yếu/dùng chung Auth key trả503 `QUOTE_SIGNING_NOT_CONFIGURED`, không có fallback chữ ký giả. Không thêm yêu cầu mới cho Auth endpoint đang dùng.
- HS256, type/issuer/audience dành riêng cho homestay quote. Token15phút, gắn unit/ngày/counts và hash snapshot đầy đủ từng đêm/khoản/rates bằng Decimal. Hash che commission/payout; token không chứa guest PII/mã booking và không là Auth hoặc Idempotency-Key.
- `quoteExpiresAt` là hạn báo giá, **không phải** hạn giữ phòng/thanh toán. Không cache quote hoặc ghi booking khi trả token. Quote0 vẫn trả200 bình thường; luồng tạo đơn sau checkpoint phải từ chối tổng0 và từng đêm thấp hơn minimum dương được cấu hình.
- Helper xác minh chữ ký/binding/thời hạn và nhận diện snapshot giá đổi đã có unit tests. **HTTP hold409 kèm giá mới chưa có**, vì owner yêu cầu dừng trước hold. Bước hold phải dùng DB clock, tính lại trong transaction, reject invalid/expired token và recheck inventory/ownership dù quote còn hạn.

## Lịch công khai theo ngày

`GET /api/v1/homestays/units/<uuid>/calendar?month=YYYY-MM&adults=2&children=0`

Public, query bắt buộc/không extras/repeated fields, chỉ phòng và tin đã duyệt/Hostactive. `data:{unitId,month,timeZone,days:[{date,isAvailable,price}]}`. `price` là giá một đêm đã làm tròn (custom > Friday/Saturday > base), không bao gồm vệ sinh/service/tax của cả chuyến.

- Không trả bookingId/bookingCode/tên hoặc điện thoại khách, status nội bộ, hay lý do booked/block. Mỗi dòng chỉ3field date/isAvailable/price. Ngày checkout vẫn có thể làm range-end nếu mọi đêm trước đó trống; không dùng boolean đêm làm lệnh cấm checkout.
- Redis inventory cache15giây, còn HTTP `Cache-Control:no-store` để không tạo thêm bản browser/CDN không thể invalidate. Public visibility/capacity/same-day cutoff kiểm DB/live mỗi request, không tin cache cho quyền hoặc hạn trong ngày.
- `HomestayCalendarService.invalidate(unitId)` bump generation sau DB commit; late-fill vào generation cũ không phục hồi cache stale. Phải gọi từ các write hold/cancel/block/expiry ở giai đoạn sau. Hiện chỉ kiểm chứng bằng DBfixture + invalidate trực tiếp, **chưa có endpoint mutation tích hợp các hook**. Quote luôn đọc DB, không dùng cache lịch làm căn cứ giữ phòng.
- Cache hỏng tự đọc lại DB; lỗi Redis cache trả503 `CALENDAR_CACHE_UNAVAILABLE`. Redis limiter vẫn failclosed503/429. Sự thay đổi unit base/weekend dùng config fingerprint nên không tái dùng cache giá cũ; no-store không đồng nghĩa không có Redis cache.

## Quy tắc đã áp dụng

- Ngày theo Asia/Ho_Chi_Minh, `[checkIn,checkOut)`, không nhận/trả cùng ngày. Không nhận check-in quá khứ.
- Unit `maxNights`1–90, default90. Instant Book today chỉ trước `sameDayBookingCutoff`, default18:00; đúng mốc chốt bị từ chối. Request-to-Book từ ngày mai. Không tự thay giờ check-in/check-out thành giờ chốt đặt.
- Adults>=1/children>=0, kiểm riêng maxAdults/maxChildren; nếu maxGuests không null thì kiểm tổng. Không thu phụ phí tuổi.
- Tin và unit PUBLISHED, tin chưa xóa/available, rentalMode SHORT_TERM/HYBRID, loại HOMESTAY/VILLA, Host ACTIVE/HOST. Không đạt điều kiện thì404.
- Calendar unique unit/date, mọi đêm trong range phải AVAILABLE; BLOCKED/BOOKED ở bất kỳ đêm nào cho `isAvailable:false`. Kiểm thêm overlap DB booking: pending Host/payment chưa hết hạn, confirmed/checkedin. Không calendar override thì dùng giá gốc/còn trống. Booking trong integration hiện là fixture; chưa có publichold tạo booking.
- Giá riêng ngày > giá Friday/Saturday > base. Mỗi đêm HALF_UP tới VND nguyên đồng, base=sum nightly; vệ sinh một lần HALF_UP. Service=rounded((base+cleaning)*serviceRate/100); tax=rounded((base+cleaning+roundedService)*taxRate/100). Total đúng sum4khoản.
- CommissionRate default10%,8–12% configurable. Commission=rounded((base+cleaning)*rate/100), payout=base+cleaning-commission; không service/tax trong cơ sở hoa hồng hoặc payout. Tính nội bộ bằng `Prisma.Decimal`; chuyển JSON number chỉ sau rounding/bounds (NUMERIC15,2 dưới Number.MAX_SAFE_INTEGER).
- ServiceFeeRate/taxRate default0%; stored Decimal5,2 percent, không float. Nonzero chỉ kiểm chứng local/test; NODE_ENV production từ chối503 cho đến khi bên kê khai/nộp thuế và giá đã gồm thuế được chủ dự án chốt. Không có public mutation/config bypass.
- Đọc unit/calendar trong RepeatableRead transaction; không cache quote. Mỗi request mới tính lại giá DB. Hàm `calculateStayPrice` sẽ dùng lại cho hold; snapshot rates/prices và409 giá thay đổi triển khai ở mốc booking sau review, chưa có ở API này.
- Redis IP quota dùng chung với public listings; không tin forwarding headers thường để đổi identity. Limiter lỗi503, vượt quota429.

## Lỗi

| Status | errorCode | Điều kiện |
| --- | --- | --- |
|400|VALIDATION_ERROR/INVALID_DATE_RANGE|Query sai, ngày không tồn tại, range sai|
|400|STAY_TOO_LONG|Vượt maxNights của unit|
|400|INVALID_CHECK_IN_DATE|Quá khứ hoặc Request-to-Book hôm nay|
|400|SAME_DAY_BOOKING_CLOSED|Instant Book hôm nay từ mốc cutoff trở đi|
|400|INVALID_CAPACITY|Count sai, vượt capacity riêng/tổng|
|400|INVALID_PRICE/INVALID_PRICING_RATE|Giá/rate không hợp lệ hoặc tổng tràn storage bound|
|404|UNIT_NOT_FOUND|Không có hoặc chưa public/sai loại/Host không active|
|429|RATE_LIMITED|Vượt shared IP quota|
|503|RATE_LIMIT_UNAVAILABLE|Redis limiter không sẵn sàng|
|503|PRICING_POLICY_NOT_CONFIGURED|Nonzero service/tax ở production còn gate thuế|
|400|INVALID_CALENDAR_MONTH|Lịch tháng không hợp lệ|
|503|QUOTE_SIGNING_NOT_CONFIGURED|Thiếu/yếu hoặc dùng chung Auth key cho quote|
|503|CALENDAR_CACHE_UNAVAILABLE|Cache/invalidation Redis lỗi|

## Schema và kiểm thử

- Prisma có8migration: policy/unit/calendar, nền booking/snapshot/idempotency và exclusion guard, nightly JSON date/order/subtotal integrity. Migrations7/8 additive; giữ migrations cũ. Chỉ deploy lên DBtest UUID riêng; chưa migrate DB/runtime chính. Snapshot/checks và internal expiry/idempotency primitives đã kiểm fixture, không là API hold hoặc BullMQ worker.
- Sau bàn giao code, người vận hành dùng quy trình `npm ci`, `npm run build`, `npm run db:deploy` trong môi trường đã cấu hình theo setup hiện có. Không dùng seed fixture/test catalog làm nguồn production. Chưa có form/API Host cấu hình unit tại mốc này.
- Lệnh unit trọng tâm: `npm test -- src/bookings/booking-dates.spec.ts src/bookings/booking-policy.spec.ts src/bookings/booking-pricing.spec.ts src/homestays/homestay-quote.spec.ts src/homestays/homestay-calendar.spec.ts`; full backend `npm test`.
- Lệnh real DB/HTTP: `npm run test:listings:integration`; dùng DB UUID riêng/Redis namespace riêng, bao phủ cả tin trọ regressions và homestay. Chi tiết ngày/kết quả/skip trong progress local, không coi fixtures là provider thật.
- Không có BFF/frontend availability, publichold/snapshot được tạo từ HTTP booking, BullMQ worker, payment hoặc nghiệm thu điện thoại thật. Hold/collision coverage90% chưa chứng minh vì chưa có fullhold; không đánh dấu Sprint3DONE. Mốc dừng mới nhất sau availability/quote có hiệu lực.
