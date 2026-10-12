import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class BookingExpiryService {
  constructor(private readonly prisma: PrismaService) {}

  // Called by the BullMQ worker and restart reconciliation, never a public route.
  // Conditional UPDATE is atomic even if Host accept/reject or payment races the job.
  async expire(bookingId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE bookings SET booking_status=CASE
        WHEN booking_status='PENDING_HOST_APPROVAL' THEN 'CANCELLED_HOST_TIMEOUT'
        ELSE 'CANCELLED_TIMEOUT' END,
        version=version+1,updated_at=clock_timestamp()
      WHERE id=${bookingId}::uuid AND booking_status IN ('PENDING_HOST_APPROVAL','PENDING_PAYMENT')
        AND payment_status IN ('NOT_CONFIGURED','PENDING') AND expires_at <= clock_timestamp()
      RETURNING id`;
    return rows.length === 1;
  }
}
