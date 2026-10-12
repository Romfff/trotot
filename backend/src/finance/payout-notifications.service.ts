import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaginatedResult } from '../common/paginated-result.js';

type Notice = { id:string; batchId:string; type:'CREATED'|'APPROVED'|'CANCELLED'|'PAID'; readAt:Date|null; createdAt:Date };
const messages = {
  CREATED:'Admin đã lập lô chi trả nháp. Đây chưa phải khoản đã chuyển.',
  APPROVED:'Admin đã duyệt lô chi trả. Đây chưa phải xác nhận đã chuyển tiền.',
  CANCELLED:'Lô chi trả đã bị hủy. Xem lịch sử chi trả để biết trạng thái hiện tại.',
  PAID:'Admin đã ghi nhận bằng chứng chi trả thủ công. Hệ thống không thực hiện chuyển tiền.',
};
const columns=Prisma.sql`e.id,e.batch_id AS "batchId",e.action AS type,r.read_at AS "readAt",e.created_at AS "createdAt"`;
const render=(row:Notice)=>({...row,message:messages[row.type],readAt:row.readAt?.toISOString()??null,createdAt:row.createdAt.toISOString()});

// Audit events already commit atomically with their batch transition and survive restart.
@Injectable()
export class PayoutNotificationsService {
  constructor(private readonly prisma:PrismaService) {}
  async list(hostId:string,page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Notice[]>(Prisma.sql`SELECT ${columns} FROM finance_payout_events e
        JOIN finance_payout_batches b ON b.id=e.batch_id
        LEFT JOIN finance_payout_notification_reads r ON r.event_id=e.id AND r.recipient_id=${hostId}::uuid
        WHERE b.host_id=${hostId}::uuid ORDER BY e.created_at DESC,e.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`);
      const [{total,unread}]=await tx.$queryRaw<{total:bigint;unread:bigint}[]>`SELECT count(*) AS total,
        count(*) FILTER(WHERE r.event_id IS NULL) AS unread FROM finance_payout_events e
        JOIN finance_payout_batches b ON b.id=e.batch_id
        LEFT JOIN finance_payout_notification_reads r ON r.event_id=e.id AND r.recipient_id=${hostId}::uuid
        WHERE b.host_id=${hostId}::uuid`;
      return new PaginatedResult(rows.map(render),{page,limit,total:Number(total),totalPages:Math.ceil(Number(total)/limit),unreadCount:Number(unread)});
    },{isolationLevel:'RepeatableRead'});
  }
  async markRead(hostId:string,id:string) {
    return this.prisma.$transaction(async tx=>{
      const [owned]=await tx.$queryRaw<{id:string}[]>`SELECT e.id FROM finance_payout_events e
        JOIN finance_payout_batches b ON b.id=e.batch_id WHERE e.id=${id}::uuid AND b.host_id=${hostId}::uuid`;
      if(!owned)throw new NotFoundException({errorCode:'NOTIFICATION_NOT_FOUND',message:'Không tìm thấy thông báo.'});
      await tx.$executeRaw`INSERT INTO finance_payout_notification_reads(event_id,recipient_id)
        VALUES(${id}::uuid,${hostId}::uuid) ON CONFLICT DO NOTHING`;
      const [row]=await tx.$queryRaw<Notice[]>(Prisma.sql`SELECT ${columns} FROM finance_payout_events e
        JOIN finance_payout_notification_reads r ON r.event_id=e.id AND r.recipient_id=${hostId}::uuid WHERE e.id=${id}::uuid`);
      return render(row);
    });
  }
}
