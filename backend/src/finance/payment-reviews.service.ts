import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaginatedResult } from '../common/paginated-result.js';

type Review = {
  id:string; sessionId:string; bookingId:string; bookingCode:string; provider:string;
  transactionNo:string; expectedAmount:string; receivedAmount:string; reasonCode:string;
  sessionBookingVersion:number; bookingVersion:number; bookingStatus:string; paymentStatus:string;
  sessionExpiresAt:Date; payDate:Date|null; receivedAt:Date;
};
// Explicit projection: never return raw callback/signature, payload hash or guest/bank data.
const columns=Prisma.sql`r.id,r.session_id AS "sessionId",s.booking_id AS "bookingId",b.booking_code AS "bookingCode",
  s.provider,r.transaction_no AS "transactionNo",s.amount_vnd::text AS "expectedAmount",r.amount_vnd::text AS "receivedAmount",
  r.reason_code AS "reasonCode",s.booking_version AS "sessionBookingVersion",b.version AS "bookingVersion",
  b.booking_status AS "bookingStatus",b.payment_status AS "paymentStatus",s.expires_at AS "sessionExpiresAt",
  r.pay_date AS "payDate",r.received_at AS "receivedAt"`;
const source=Prisma.sql`FROM vnpay_ipn_receipts r JOIN payment_sessions s ON s.id=r.session_id JOIN bookings b ON b.id=s.booking_id`;
const render=(row:Review)=>({...row,sessionExpiresAt:row.sessionExpiresAt.toISOString(),payDate:row.payDate?.toISOString()??null,receivedAt:row.receivedAt.toISOString()});

@Injectable()
export class PaymentReviewsService {
  constructor(private readonly prisma:PrismaService) {}
  async list(page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Review[]>(Prisma.sql`SELECT ${columns} ${source} WHERE r.outcome='REVIEW'
        ORDER BY r.received_at DESC,r.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`);
      const [{total}]=await tx.$queryRaw<{total:bigint}[]>`SELECT count(*) AS total FROM vnpay_ipn_receipts WHERE outcome='REVIEW'`;
      return new PaginatedResult(rows.map(render),{page,limit,total:Number(total),totalPages:Math.ceil(Number(total)/limit)});
    },{isolationLevel:'RepeatableRead'});
  }
  async read(id:string) {
    const [row]=await this.prisma.$queryRaw<Review[]>(Prisma.sql`SELECT ${columns} ${source} WHERE r.id=${id}::uuid AND r.outcome='REVIEW'`);
    if(!row)throw new NotFoundException({errorCode:'PAYMENT_REVIEW_NOT_FOUND',message:'Không tìm thấy giao dịch cần đối soát.'});
    return render(row);
  }
}
