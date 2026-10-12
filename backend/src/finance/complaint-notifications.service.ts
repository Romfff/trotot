import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaginatedResult } from '../common/paginated-result.js';

type Notice = { id: string; complaintId: string; bookingId: string; type: 'CREATED' | 'RESPONDED' | 'RESOLVED'; readAt: Date | null; createdAt: Date };
const messages = {
  CREATED: 'Có khiếu nại mới cho một đơn của bạn. Khoản liên quan đang chờ xử lý.',
  RESPONDED: 'Chủ nhà đã phản hồi khiếu nại của bạn.',
  RESOLVED: 'Admin đã xử lý khiếu nại. Xem chi tiết quyết định; thông báo này không xác nhận chuyển tiền.',
};
const columns = Prisma.sql`e.id,e.complaint_id AS "complaintId",c.booking_id AS "bookingId",e.action AS type,
  r.read_at AS "readAt",e.created_at AS "createdAt"`;
const scope = (recipient: string) => Prisma.sql`((e.action='CREATED' AND c.host_id=${recipient}::uuid)
  OR (e.action='RESPONDED' AND c.guest_id=${recipient}::uuid)
  OR (e.action='RESOLVED' AND (c.guest_id=${recipient}::uuid OR c.host_id=${recipient}::uuid)))`;
const render = (r: Notice) => ({ ...r, message: messages[r.type], readAt: r.readAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() });

@Injectable()
export class ComplaintNotificationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(recipientId: string, page: number, limit: number) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Notice[]>(Prisma.sql`SELECT ${columns} FROM finance_complaint_events e
        JOIN finance_complaints c ON c.id=e.complaint_id
        LEFT JOIN finance_complaint_notification_reads r ON r.event_id=e.id AND r.recipient_id=${recipientId}::uuid
        WHERE ${scope(recipientId)} ORDER BY e.created_at DESC,e.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`);
      const [{ total, unread }] = await tx.$queryRaw<{ total: bigint; unread: bigint }[]>(Prisma.sql`SELECT count(*) AS total,
        count(*) FILTER(WHERE r.event_id IS NULL) AS unread FROM finance_complaint_events e
        JOIN finance_complaints c ON c.id=e.complaint_id
        LEFT JOIN finance_complaint_notification_reads r ON r.event_id=e.id AND r.recipient_id=${recipientId}::uuid
        WHERE ${scope(recipientId)}`);
      return new PaginatedResult(rows.map(render), { page, limit, total: Number(total), totalPages: Math.ceil(Number(total)/limit), unreadCount: Number(unread) });
    }, { isolationLevel: 'RepeatableRead' });
  }
  async markRead(recipientId: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const [owned] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT e.id FROM finance_complaint_events e
        JOIN finance_complaints c ON c.id=e.complaint_id WHERE e.id=${id}::uuid AND ${scope(recipientId)}`);
      if (!owned) throw new NotFoundException({ errorCode: 'NOTIFICATION_NOT_FOUND', message: 'Không tìm thấy thông báo.' });
      await tx.$executeRaw`INSERT INTO finance_complaint_notification_reads(event_id,recipient_id)
        VALUES(${id}::uuid,${recipientId}::uuid) ON CONFLICT DO NOTHING`;
      const [row] = await tx.$queryRaw<Notice[]>(Prisma.sql`SELECT ${columns} FROM finance_complaint_events e
        JOIN finance_complaints c ON c.id=e.complaint_id
        JOIN finance_complaint_notification_reads r ON r.event_id=e.id AND r.recipient_id=${recipientId}::uuid WHERE e.id=${id}::uuid`);
      return render(row);
    });
  }
}
