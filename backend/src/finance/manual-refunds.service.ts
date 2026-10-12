import { BadRequestException,ConflictException,Injectable,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { appendFinancialJournal } from './finance-journal.js';
import { PaginatedResult } from '../common/paginated-result.js';
import type { ConfirmRefundDto } from './manual-refunds.dto.js';

async function refundSource(tx:Prisma.TransactionClient,id:string) {
  const [source]=await tx.$queryRaw<{bookingId:string;hostId:string;actorType:string;reason:string;refundAmount:string;complaint:boolean}[]>`SELECT
    coalesce(c.booking_id,a.booking_id) AS "bookingId",j.host_id AS "hostId",coalesce(c.actor_type,'ADMIN') AS "actorType",
    coalesce(c.reason,s.reason) AS reason,coalesce(c.refund_amount,a.refund_amount)::text AS "refundAmount",(a.complaint_id IS NOT NULL) AS complaint
    FROM finance_refunds f LEFT JOIN finance_cancellations c ON c.id=f.cancellation_id
    LEFT JOIN finance_complaint_refunds a ON a.complaint_id=f.complaint_id
    LEFT JOIN finance_complaint_resolutions s ON s.complaint_id=a.complaint_id
    JOIN finance_journals j ON j.id=coalesce(c.source_journal_id,a.source_journal_id) WHERE f.id=${id}::uuid`;
  if(!source) throw new ConflictException({errorCode:'REFUND_SOURCE_MISMATCH',message:'Khoản hoàn thiếu chứng cứ nguồn.'});
  return source;
}

@Injectable()
export class ManualRefundsService {
  constructor(private readonly prisma:PrismaService,private readonly idempotency:BookingIdempotencyService) {}
  async read(id:string) {
    return this.prisma.$transaction(async tx=>{
    const r=await tx.financeRefund.findUnique({where:{id},include:{
      confirmation:{select:{id:true,journalId:true,actorId:true,bankReference:true,evidenceNote:true,reason:true,createdAt:true}}}});
    if(!r) throw new NotFoundException({errorCode:'REFUND_NOT_FOUND',message:'Không tìm thấy khoản hoàn.'});
    const source=await refundSource(tx,id);
    return {id:r.id,bookingId:source.bookingId,amount:r.amount.toFixed(0),status:r.status,version:r.version,
      cancelledBy:source.actorType,reason:source.reason,createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString(),
      confirmation:r.confirmation?{...r.confirmation,createdAt:r.confirmation.createdAt.toISOString()}:null};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async list(page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{id:string;bookingId:string;amount:string;status:string;version:number;createdAt:Date}[]>`SELECT
        id,finance_refund_booking(id) AS "bookingId",amount::text AS amount,status,version,created_at AS "createdAt"
        FROM finance_refunds ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`;
      const total=await tx.financeRefund.count();
      const data=rows.map(r=>({...r,amount:new Prisma.Decimal(r.amount).toFixed(0),createdAt:r.createdAt.toISOString()}));
      return new PaginatedResult(data,{page,limit,total,totalPages:Math.ceil(total/limit)});
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async confirm(actorId:string,id:string,dto:ConfirmRefundDto,key:string,rawBody:unknown) {
    const bankReference=dto.bankReference?.trim(),evidence=dto.evidenceNote?.trim(),reason=dto.reason?.trim();
    if(!bankReference || bankReference.length>200 || !evidence || evidence.length>500 || !reason || reason.length>500)
      throw new BadRequestException({errorCode:'INVALID_REFUND_EVIDENCE',message:'Cần mã giao dịch, bằng chứng và lý do xác nhận.'});
    try {return (await this.idempotency.run(actorId,'ADMIN_REFUND_PAID',key,{id,body:rawBody},async tx=>{
      const initial=await tx.financeRefund.findUnique({where:{id}});
      if(!initial) throw new NotFoundException({errorCode:'REFUND_NOT_FOUND',message:'Không tìm thấy khoản hoàn.'});
      const source=await refundSource(tx,id);
      const booking=await tx.booking.findUniqueOrThrow({where:{id:source.bookingId}});
      await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${booking.homestayUnitId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM bookings WHERE id=${booking.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM finance_refunds WHERE id=${id}::uuid FOR UPDATE`;
      const r=await tx.financeRefund.findUniqueOrThrow({where:{id}});
      if(r.version!==dto.expectedVersion) throw new ConflictException({errorCode:'STALE_REFUND_VERSION',message:'Khoản hoàn đã thay đổi. Vui lòng tải lại.'});
      if(r.status!=='PENDING') throw new ConflictException({errorCode:'REFUND_ALREADY_PROCESSED',message:'Khoản hoàn không còn chờ xử lý.'});
      const current=await tx.booking.findUniqueOrThrow({where:{id:booking.id}});
      if(current.paymentStatus!=='PAID' || !(source.complaint?['CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED']:['CANCELLED','CANCELLED_BY_GUEST']).includes(current.bookingStatus))
        throw new ConflictException({errorCode:'REFUND_STATE_MISMATCH',message:'Trạng thái đơn cần được đối soát trước khi xác nhận khoản hoàn.'});
      const [{referenceKey}]=await tx.$queryRaw<{referenceKey:string}[]>`SELECT upper(${bankReference}) AS "referenceKey"`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-ref:${referenceKey}`},0))`;
      const used=await tx.$queryRaw<{id:string}[]>`SELECT id FROM finance_refund_confirmations WHERE reference_key=${referenceKey}`;
      if(used.length) throw new ConflictException({errorCode:'REFUND_REFERENCE_REUSED',message:'Mã giao dịch đã được dùng cho khoản hoàn khác.'});
      const [balance]=await tx.$queryRaw<{pending:string;returned:string}[]>`SELECT
        COALESCE(sum(CASE WHEN e.account='REFUND_PAYABLE' THEN CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0)::text AS pending,
        COALESCE(sum(CASE WHEN j.kind='REFUND' AND e.account='CASH_CLEARING' AND e.side='CREDIT' THEN e.amount ELSE 0 END),0)::text AS returned
        FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id WHERE j.booking_id=${booking.id}::uuid`;
      const returned=new Prisma.Decimal(balance.returned).plus(r.amount);
      if(new Prisma.Decimal(balance.pending).lt(r.amount) || returned.gt(booking.totalAmount) || !r.amount.eq(source.refundAmount))
        throw new ConflictException({errorCode:'REFUND_BALANCE_MISMATCH',message:'Sổ hoàn tiền cần được đối soát.'});
      const journal=await appendFinancialJournal(tx,{eventKey:`refund-paid:${id}`,kind:'REFUND',bookingId:booking.id,hostId:source.hostId,actorId,reason,
        lines:[{account:'REFUND_PAYABLE',side:'DEBIT',amount:r.amount},{account:'CASH_CLEARING',side:'CREDIT',amount:r.amount}]});
      await tx.$executeRaw`INSERT INTO finance_refund_confirmations (refund_id,journal_id,actor_id,bank_reference,reference_key,evidence_note,reason,amount)
        VALUES (${id}::uuid,${journal.journalId}::uuid,${actorId}::uuid,${bankReference},upper(${bankReference}),${evidence},${reason},${r.amount.toFixed(0)}::numeric)`;
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      const updated=await tx.financeRefund.update({where:{id,version:dto.expectedVersion,status:'PENDING'},data:{status:'PAID',version:{increment:1},updatedAt:now}});
      if(returned.eq(booking.totalAmount)) await tx.booking.update({where:{id:booking.id,paymentStatus:'PAID'},data:{paymentStatus:'REFUNDED',version:{increment:1}}});
      return {status:200,body:{id,bookingId:booking.id,amount:r.amount.toFixed(0),status:updated.status,version:updated.version,
        journalId:journal.journalId,message:'Đã ghi nhận xác nhận chuyển trả thủ công của Admin; hệ thống không thực hiện chuyển tiền.'}};
    })).body;} catch(error) {
      // Prisma diagnostic stacks may include SQL/arguments containing bank evidence. Do not forward/log them.
      if(error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError
        || error instanceof Prisma.PrismaClientInitializationError)
        throw new ServiceUnavailableException({errorCode:'REFUND_RECORDING_FAILED',message:'Chưa thể ghi nhận khoản hoàn. Vui lòng thử lại với cùng Idempotency-Key.'});
      throw error;
    }
  }
}
