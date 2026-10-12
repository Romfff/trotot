import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { assertBookingIdempotencyKey,bookingRequestHash, BOOKING_IDEMPOTENCY_MS } from './booking-idempotency.js';

type Operation = 'HOLD' | 'HOST_ACCEPT' | 'HOST_REJECT' | 'GUEST_CANCEL' | 'HOST_CHECK_IN' | 'HOST_COMPLETE' | 'HOST_CALENDAR_PRICE' | 'HOST_CALENDAR_BLOCK' | 'GUEST_CANCEL_PAID' | 'HOST_CANCEL_PAID' | 'ADMIN_REFUND_PAID' | 'HOST_BANK_SUBMIT' | 'ADMIN_BANK_VERIFY' | 'ADMIN_BANK_REJECT' | 'COMPLAINT_CREATE' | 'HOST_COMPLAINT_RESPOND' | 'ADMIN_COMPLAINT_ASSIGN' | 'HOST_NO_SHOW_REPORT' | 'ADMIN_NO_SHOW_RESOLVE' | 'ADMIN_COMPLAINT_RESOLVE' | 'ADMIN_PAYOUT_DRAFT' | 'ADMIN_PAYOUT_CANCEL' | 'ADMIN_PAYOUT_APPROVE' | 'ADMIN_PAYOUT_PAID';
type StoredResponse = { status: number; body: Prisma.InputJsonObject };

@Injectable()
export class BookingIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  // Internal transaction primitive only. Hash the raw parsed JSON body (not a transformed DTO instance).
  // Each operation must still enforce ownership/state/price.
  async run(userId: string, operation: Operation | 'PAYMENT_SESSION' | 'ADMIN_LATE_REFUND_CREATE' | 'ADMIN_DEBT_SETTLEMENT' | 'ADMIN_DEBT_REVERSE', key: string, body: unknown,
    apply: (tx: Prisma.TransactionClient) => Promise<StoredResponse>): Promise<StoredResponse> {
    assertBookingIdempotencyKey(key);
    const requestHash = bookingRequestHash(body);
    return this.prisma.$transaction(async tx => {
      const scope = JSON.stringify([userId, operation, key]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope},0))`;
      // Hold a shared actor lock: a concurrent ban/role update cannot commit during this mutation.
      const [actor] = await tx.$queryRaw<{ role: string; status: string | null }[]>`
        SELECT role,status FROM users WHERE id=${userId}::uuid FOR SHARE`;
      if (!actor || actor.status !== 'ACTIVE' || (operation.startsWith('ADMIN_') ? actor.role!=='ADMIN' : !['TENANT','HOST'].includes(actor.role))
        || (operation.startsWith('HOST_') && actor.role !== 'HOST')) {
        throw new ForbiddenException({ errorCode: 'BOOKING_ACTOR_NOT_ALLOWED', message: 'Tài khoản không được thực hiện thao tác này.' });
      }
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const existing = await tx.bookingIdempotency.findUnique({ where: { userId_operation_key: { userId, operation, key } } });
      if (existing && existing.expiresAt > now) {
        if (existing.requestHash !== requestHash) throw new ConflictException({
          errorCode: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency-Key đã được dùng cho nội dung khác.',
        });
        return { status: existing.responseStatus, body: existing.responseBody as Prisma.InputJsonObject };
      }
      if (existing) await tx.bookingIdempotency.delete({ where: { id: existing.id } });
      const result = await apply(tx);
      // Save exactly the JSON representation that the HTTP response will use; no Decimal/Date objects.
      const normalizedBody = JSON.parse(JSON.stringify(result.body)) as Prisma.InputJsonObject;
      const [{ createdAt }] = await tx.$queryRaw<{ createdAt: Date }[]>`SELECT clock_timestamp() AS "createdAt"`;
      await tx.bookingIdempotency.create({ data: {
        userId, operation, key, requestHash, responseStatus: result.status, responseBody: normalizedBody,
        createdAt, expiresAt: new Date(createdAt.getTime() + BOOKING_IDEMPOTENCY_MS),
      } });
      return { status: result.status, body: normalizedBody };
    }, { maxWait: 30_000, timeout: 30_000 });
  }
}
