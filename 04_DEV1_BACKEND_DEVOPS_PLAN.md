# KẾ HOẠCH HÀNH ĐỘNG CHI TIẾT DÀNH CHO DEVELOPER 1
## VAI TRÒ: LEAD BACKEND / DEVOPS / DATA & CORE ARCHITECTURE

---

## 1. MỤC TIÊU & TRÁCH NHIỆM CỐT LÕI

Developer 1 là người chịu trách nhiệm chính về nền tảng kỹ thuật phía server:
- Thiết lập hạ tầng CSDL PostgreSQL 16 (PostGIS), Redis 7, Docker và môi trường Local / Staging / Production.
- Xây dựng Core API NestJS chuẩn TypeScript, kiến trúc Modular, sạch sẽ, dễ bảo trì.
- Phát triển **Booking Engine** với thuật toán kiểm tra phòng trống và cơ chế **Redis Redlock** chống đặt trùng (Double Booking).
- Tích hợp cổng thanh toán trực tuyến tự động (VietQR / VNPay / MoMo) và xử lý an toàn Webhook IPN.
- Thiết lập các tiến trình ngầm (BullMQ Workers) để xử lý hết hạn thanh toán, nhắc lịch hẹn, đối soát tiền.
- Cấu hình CI/CD và triển khai ứng dụng lên máy chủ Linux VPS.

---

## 2. CHECKLIST CÔNG VIỆC THEO TỪNG GIAI ĐOẠN

```mermaid
checklist
  Sprint 1 : Hạ tầng, Database, Auth & Media
    - Khởi tạo Docker Compose (Postgres PostGIS, Redis)
    - Cấu hình NestJS + Prisma ORM + Class Validator
    - Viết Auth Module (JWT Access/Refresh, RBAC, Phone OTP)
    - Tích hợp Cloudinary/R2 Service upload và resize ảnh
    - Cấu hình Swagger OpenAPI tại /api/docs
  Sprint 2 : API Phòng Trọ Dài Hạn & PostGIS
    - Migration Schema Properties, LongTermDetails, Amenities
    - API Đăng tin trọ & Quản lý tin (Chủ trọ)
    - API Tìm kiếm bán kính PostGIS ST_DWithin quanh tọa độ
    - API Đặt lịch hẹn xem phòng & thông báo chủ trọ
  Sprint 3 : Booking Engine Homestay & Redis Lock
    - Migration Schema HomestayUnits, CalendarPricing, Bookings
    - Thuật toán kiểm tra lịch trống Date Overlap & Tính giá
    - Distributed Lock Redis Redlock giữ phòng 15 phút
    - Worker BullMQ tự động giải phóng phòng khi hết hạn
  Sprint 4 : Tích Hợp Cổng Thanh Toán & Webhook
    - Tích hợp VietQR (PayOS/SePAY) sinh QR động
    - Tích hợp VNPay URL redirect & IPN Webhook
    - Xử lý Idempotency Key và xác thực HMAC Signature
    - Module Quản lý ví và tính hoa hồng (Commission/Payout)
  Sprint 5 : Realtime Chat, Admin API & Triển khai VPS
    - WebSocket Gateway (Socket.io) cho Chat và Notification
    - API Admin CMS duyệt tin & báo cáo GMV
    - Setup Nginx Reverse Proxy, SSL Let's Encrypt trên Linux VPS
    - Thiết lập script tự động sao lưu Database mỗi đêm
```

---

## 3. HƯỚNG DẪN KỸ THUẬT & CODE MẪU QUAN TRỌNG

### 3.1. Cấu Hình Docker Compose Môi Trường Phát Triển (`docker-compose.yml`)

```yaml
version: '3.8'

services:
  postgres:
    image: postgis/postgis:16-3.4
    container_name: rental_postgres
    restart: always
    environment:
      POSTGRES_USER: rental_user
      POSTGRES_PASSWORD: rental_password_secret
      POSTGRES_DB: rental_platform_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: rental_redis
    restart: always
    command: redis-server --requirepass redis_password_secret
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

### 3.2. Triển Khai Cơ Chế Khóa Phòng Chống Double-Booking (Redis Distributed Lock)

Dev 1 áp dụng Redis Lock khi người dùng bấm vào bước thanh toán giữ phòng:

```typescript
import { Injectable, ConflictException } from '@nestjs/common';
import { RedisService } from './redis.service';
import { PrismaService } from './prisma.service';

@Injectable()
export class BookingService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async holdRoomForBooking(dto: CreateBookingHoldDto, userId: string) {
    const { unitId, checkInDate, checkOutDate } = dto;
    const lockKey = `lock:unit:${unitId}:${checkInDate}_${checkOutDate}`;
    
    // 1. Thử khóa trong 15 phút (900 giây)
    const acquired = await this.redis.set(lockKey, userId, 'EX', 900, 'NX');
    if (!acquired) {
      throw new ConflictException('Phòng đang được một khách hàng khác giữ chỗ thanh toán. Vui lòng quay lại sau ít phút!');
    }

    try {
      // 2. Kiểm tra xung đột lịch thực tế trong CSDL
      const hasConflict = await this.prisma.calendarPricing.findFirst({
        where: {
          homestayUnitId: unitId,
          date: { gte: new Date(checkInDate), lt: new Date(checkOutDate) },
          status: { in: ['BLOCKED', 'BOOKED'] },
        },
      });

      if (hasConflict) {
        await this.redis.del(lockKey); // Giải phóng lock nếu phòng đã kín
        throw new ConflictException('Phòng đã được đặt hoặc bị khóa trong khoảng ngày này.');
      }

      // 3. Tính toán chi phí và tạo đơn Booking với trạng thái PENDING
      const totalPricing = await this.calculatePricing(unitId, checkInDate, checkOutDate);
      const bookingCode = `BK-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const booking = await this.prisma.booking.create({
        data: {
          bookingCode,
          homestayUnitId: unitId,
          guestId: userId,
          checkInDate: new Date(checkInDate),
          checkOutDate: new Date(checkOutDate),
          totalNights: totalPricing.totalNights,
          baseAmount: totalPricing.baseAmount,
          cleaningFee: totalPricing.cleaningFee,
          serviceFee: totalPricing.serviceFee,
          totalAmount: totalPricing.totalAmount,
          commissionAmount: totalPricing.commissionAmount,
          hostPayoutAmount: totalPricing.hostPayoutAmount,
          paymentStatus: 'PENDING',
          bookingStatus: 'PENDING_CONFIRMATION',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 phút
        },
      });

      // 4. Đẩy task vào BullMQ để tự động hủy đơn và nhả lock nếu quá 15 phút không trả tiền
      await this.bookingQueue.add(
        'expire-booking',
        { bookingId: booking.id, lockKey },
        { delay: 15 * 60 * 1000 },
      );

      return { booking, expiresInSeconds: 900 };
    } catch (error) {
      await this.redis.del(lockKey);
      throw error;
    }
  }
}
```

---

### 3.3. Xử Lý Webhook Thanh Toán An Toàn & Chống Trùng (Idempotency)

```typescript
@Post('webhook/payment-ipn')
async handlePaymentWebhook(@Body() payload: any, @Headers('x-signature') signature: string) {
  // 1. Xác thực chữ ký bí mật từ Cổng thanh toán (HMAC SHA256 / SHA512)
  const isValid = this.verifySignature(payload, signature, process.env.PAYMENT_WEBHOOK_SECRET);
  if (!isValid) {
    throw new UnauthorizedException('Chữ ký Webhook không hợp lệ!');
  }

  // 2. Chống xử lý trùng Webhook bằng Redis Idempotency Key
  const eventId = payload.orderCode || payload.transactionId;
  const processed = await this.redis.set(`ipn:processed:${eventId}`, '1', 'EX', 86400, 'NX');
  if (!processed) {
    return { status: 'ALREADY_PROCESSED', message: 'Giao dịch này đã được ghi nhận trước đó.' };
  }

  // 3. Thực thi transaction cập nhật trạng thái đơn đặt phòng
  return await this.prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { bookingCode: payload.orderCode } });
    if (!booking) throw new NotFoundException('Không tìm thấy đơn đặt phòng');

    // Chuyển trạng thái đơn sang CONFIRMED và PAID
    await tx.booking.update({
      where: { id: booking.id },
      data: { paymentStatus: 'PAID', bookingStatus: 'CONFIRMED' },
    });

    // Cập nhật các ngày trong calendar_pricing sang BOOKED
    // ... Cập nhật bảng calendar_pricing ...

    // Gửi thông báo realtime qua WebSocket tới Guest & Host
    this.socketGateway.notifyBookingSuccess(booking.guestId, booking.id);
    return { success: true };
  });
}
```

---

## 4. CHIẾN LƯỢC CACHING VÀ TỐI ƯU HIỆU SUẤT
1. **Cache L1 (In-Memory / Redis):**
   - Danh mục tiện ích (`/api/amenities`): Cache 24 giờ.
   - Danh sách tỉnh thành, quận huyện: Cache vĩnh viễn (chỉ xóa cache khi admin cập nhật).
   - Trang chi tiết tin đăng (`/api/properties/:slug`): Cache 5 phút, tự động invalidate khi chủ nhà sửa tin.
2. **PostgreSQL Tuning:**
   - Đặt `shared_buffers = 25% RAM`, `work_mem = 16MB`.
   - Bắt buộc tạo index trên các khóa ngoại và cột lọc: `idx_properties_location (GIST)`, `idx_properties_status`, `idx_properties_price`.

---

## 5. HƯỚNG DẪN TRIỂN KHAI PRODUCTION (DEVOPS)
- **Môi trường:** Ubuntu 22.04 LTS VPS (Tối thiểu 2 vCPU, 4GB RAM).
- **Quy trình:**
  1. Nginx cài trực tiếp trên máy chủ, đóng vai trò Reverse Proxy chuyển tiếp cổng 80/443 về Docker containers.
  2. Cài SSL tự động miễn phí thông qua Certbot:
     ```bash
     sudo certbot --nginx -d api.domain.vn -d app.domain.vn
     ```
  3. Cấu hình Cronjob backup CSDL tự động mỗi 02:00 sáng, nén file `.sql.gz` và đồng bộ lên Cloudflare R2 / S3.
