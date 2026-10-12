import { ConflictException,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { appendFinancialJournal,type FinancialJournalInput } from '../finance/finance-journal.js';
import { createVnpaySandboxAdapter } from './vnpay-sandbox.js';

// Internal consumer only: raw query -> server key verification BEFORE DB work.
// No public fake callback/controller and no client-supplied normalized event.
export async function consumeVnpayIpn(prisma:PrismaService,config:Parameters<typeof createVnpaySandboxAdapter>[0],rawQuery:string) {
  const event=createVnpaySandboxAdapter(config).verifyIpn(rawQuery);
  if (!event.providerReportedSuccess) return {outcome:'NOT_SUCCESS' as const};
  const transactionNo=BigInt(event.transactionNo).toString();
  try {return await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vnpay:${event.merchantCode}:${transactionNo}`},0))`;
    const old=await tx.$queryRaw<{id:string;payloadHash:string;bookingId:string;outcome:string;reasonCode:string}[]>`
      SELECT r.id,r.payload_hash AS "payloadHash",s.booking_id AS "bookingId",r.outcome,r.reason_code AS "reasonCode"
      FROM vnpay_ipn_receipts r JOIN payment_sessions s ON s.id=r.session_id
      WHERE r.merchant_code=${event.merchantCode} AND r.transaction_no=${transactionNo}`;
    if (old.length) {
      if (old[0].payloadHash!==event.payloadHash) throw new ConflictException({errorCode:'PAYMENT_EVENT_CONFLICT',message:'Mã giao dịch đã nhận với nội dung khác; cần đối soát.'});
      return {eventId:old[0].id,bookingId:old[0].bookingId,outcome:old[0].outcome,reasonCode:old[0].reasonCode};
    }
    const [session]=await tx.$queryRaw<{id:string;bookingId:string;amount:string;version:number;expiresAt:Date;unitId:string}[]>`
      SELECT s.id,s.booking_id AS "bookingId",s.amount_vnd::text AS amount,s.booking_version AS version,s.expires_at AS "expiresAt",b.homestay_unit_id AS "unitId"
      FROM payment_sessions s JOIN bookings b ON b.id=s.booking_id
      WHERE s.transaction_ref=${event.transactionRef} AND s.merchant_code=${event.merchantCode} AND s.provider='VNPAY_SANDBOX'`;
    if (!session) throw new NotFoundException({errorCode:'PAYMENT_SESSION_NOT_FOUND',message:'Không tìm thấy phiên thanh toán.'});
    await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${session.unitId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM bookings WHERE id=${session.bookingId}::uuid FOR UPDATE`;
    const b=await tx.booking.findUniqueOrThrow({where:{id:session.bookingId},include:{unit:{select:{property:{select:{hostId:true}}}}}});
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const payDate=event.payDate?new Date(event.payDate):null;
    const [{payable}]=await tx.$queryRaw<{payable:boolean}[]>`SELECT vnpay_session_payable(${session.id}::uuid,${event.amountVnd}::numeric,${payDate},${now}) AS payable`;
    const sources=await tx.$queryRaw<{id:string}[]>`SELECT id FROM finance_journals WHERE booking_id=${b.id}::uuid AND kind='PAYMENT'`;
    const reasonCode=!new Prisma.Decimal(session.amount).eq(event.amountVnd)?'AMOUNT_MISMATCH'
      : b.bookingStatus!=='PENDING_PAYMENT' || b.paymentStatus!=='PENDING' || b.expiresAt<=now || b.version===2147483647?'BOOKING_NOT_PAYABLE'
      : b.version!==session.version || b.expiresAt.getTime()!==session.expiresAt.getTime() || !b.totalAmount.eq(session.amount)?'SESSION_CHANGED'
      : !payable?'PAYMENT_TIME_INVALID' : sources.length?'SOURCE_EXISTS':'MATCHED';
    const outcome=reasonCode==='MATCHED'?'APPLIED':'REVIEW';
    let journalId:string|null=null;
    if (outcome==='APPLIED') {
      const credits=[['HOST_PAYABLE',b.hostPayoutAmount],['PLATFORM_COMMISSION',b.commissionAmount],['PLATFORM_SERVICE',b.serviceFee],['TAX_PAYABLE',b.taxAmount]] as const;
      const lines:FinancialJournalInput['lines']=[{account:'CASH_CLEARING',side:'DEBIT',amount:b.totalAmount},
        ...credits.filter(([,amount])=>amount.gt(0)).map(([account,amount])=>({account,side:'CREDIT' as const,amount}))];
      journalId=(await appendFinancialJournal(tx,{eventKey:`vnpay-paid:${event.merchantCode}:${transactionNo}`,kind:'PAYMENT',bookingId:b.id,
        hostId:b.unit.property.hostId,actorId:null,reason:'Verified VNPay Sandbox IPN; exact booking price snapshot',lines})).journalId;
    }
    const [receipt]=await tx.$queryRaw<{id:string}[]>`INSERT INTO vnpay_ipn_receipts(session_id,merchant_code,transaction_no,payload_hash,amount_vnd,pay_date,outcome,reason_code,journal_id)
      VALUES(${session.id}::uuid,${event.merchantCode},${transactionNo},${event.payloadHash},${event.amountVnd}::numeric,${payDate},${outcome},${reasonCode},${journalId}::uuid) RETURNING id`;
    if (outcome==='APPLIED') {
      const rows=await tx.$queryRaw<{id:string}[]>`UPDATE bookings SET booking_status='CONFIRMED',payment_status='PAID',version=version+1,updated_at=clock_timestamp()
        WHERE id=${b.id}::uuid AND version=${session.version} AND booking_status='PENDING_PAYMENT' AND payment_status='PENDING' AND expires_at>clock_timestamp() RETURNING id`;
      if (!rows.length) throw new ConflictException({errorCode:'BOOKING_PAYMENT_STATE_CHANGED',message:'Đơn đã hết hạn hoặc thay đổi; cần xử lý lại callback.'});
    }
    return {eventId:receipt.id,bookingId:b.id,outcome,reasonCode};
  },{maxWait:30_000,timeout:30_000});}catch(error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientInitializationError)
      throw new ServiceUnavailableException({errorCode:'PAYMENT_RECORDING_FAILED',message:'Chưa thể ghi nhận giao dịch; cần gửi lại cùng callback, không thanh toán lần nữa.'});
    throw error;
  }
}
