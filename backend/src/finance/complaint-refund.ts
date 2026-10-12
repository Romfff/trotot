import { BadRequestException,ConflictException } from '@nestjs/common';
import { Prisma,type Booking } from '../generated/prisma/client.js';
import { calculateAdminRefund,cancellationSnapshot } from '../bookings/booking-refund.js';
import { roomTimestamp } from '../bookings/booking-lifecycle.js';
import { appendFinancialJournal,type FinancialJournalInput } from './finance-journal.js';
import { verifiedPaymentSource } from './payment-source.js';
import { FINANCE_HOLD_MS } from './payout-policy.js';
import type { ResolveComplaintDto } from './complaints.dto.js';

// Read-only projection. Recognized obligations reserve their allocation even before bank confirmation.
export async function complaintBookingSnapshot(tx:Prisma.TransactionClient,id:string,hostId:string) {
  const booking=await tx.booking.findUniqueOrThrow({where:{id}}),keys=['baseAmount','cleaningFee','serviceFee','taxAmount'] as const;
  const policy=booking.policySnapshot as Record<string,Prisma.JsonValue>;
  const validTime=/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(String(policy?.checkOutTime));
  const allocations=await tx.$queryRaw<Record<typeof keys[number],string>[]>`SELECT
    calculation->>'refundBaseAmount' AS "baseAmount",calculation->>'refundCleaningFee' AS "cleaningFee",
    calculation->>'refundServiceFee' AS "serviceFee",calculation->>'refundTaxAmount' AS "taxAmount"
    FROM finance_cancellations WHERE booking_id=${id}::uuid
    UNION ALL SELECT base_amount::text,cleaning_fee::text,service_fee::text,tax_amount::text
    FROM finance_complaint_refunds WHERE booking_id=${id}::uuid`;
  const [cash]=await tx.$queryRaw<{refunded:string;pending:string;unmapped:boolean}[]>`SELECT
    COALESCE((SELECT sum(c.amount) FROM finance_refund_confirmations c JOIN finance_refunds f ON f.id=c.refund_id
      WHERE finance_refund_booking(f.id)=${id}::uuid),0)::text AS refunded,
    COALESCE((SELECT sum(f.amount) FROM finance_refunds f WHERE finance_refund_booking(f.id)=${id}::uuid AND f.status='PENDING'),0)::text AS pending,
    EXISTS(SELECT 1 FROM finance_journals j WHERE j.booking_id=${id}::uuid AND j.kind<>'PAYMENT'
      AND NOT finance_payout_journal_verified(j.id)
      AND NOT EXISTS(SELECT 1 FROM finance_cancellations c WHERE c.reversal_journal_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM finance_complaint_refunds a WHERE a.reversal_journal_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM finance_refund_confirmations c WHERE c.journal_id=j.id)) AS unmapped`;
  let reviewRequired=!validTime||cash.unmapped;
  try { await verifiedPaymentSource(tx,booking,hostId); }
  catch(error) {
    if(error instanceof ConflictException && (error.getResponse() as {errorCode?:string}).errorCode==='FINANCIAL_REVIEW_REQUIRED')reviewRequired=true;
    else throw error;
  }
  const amounts=Object.fromEntries([...keys,'totalAmount' as const].map(key=>[key,booking[key].toFixed(0)]));
  const approvedRefundAmounts=Object.fromEntries(keys.map(key=>{
    let sum=new Prisma.Decimal(0);
    for(const allocation of allocations) {
      const value=allocation[key];
      if(typeof value!=='string'||!/^\d+(?:\.0+)?$/.test(value)){reviewRequired=true;continue;}
      sum=sum.plus(value);
    }
    if(!booking[key].isInteger()||booking[key].lt(0)||sum.gt(booking[key]))reviewRequired=true;
    return [key,sum.toFixed(0)];
  }));
  const approved=keys.reduce((sum,key)=>sum.plus(approvedRefundAmounts[key]),new Prisma.Decimal(0));
  if(!booking.totalAmount.eq(keys.reduce((sum,key)=>sum.plus(booking[key]),new Prisma.Decimal(0)))
    ||new Prisma.Decimal(cash.refunded).plus(cash.pending).gt(approved))reviewRequired=true;
  return {version:booking.version,bookingStatus:booking.bookingStatus,paymentStatus:booking.paymentStatus,
    checkoutAt:validTime?roomTimestamp(booking.checkOutDate.toISOString().slice(0,10),String(policy.checkOutTime)).toISOString():null,
    amounts,approvedRefundAmounts,refundedAmount:new Prisma.Decimal(cash.refunded).toFixed(0),pendingRefundAmount:new Prisma.Decimal(cash.pending).toFixed(0),
    remainingRefundableAmounts:reviewRequired?null:Object.fromEntries(keys.map(key=>[key,booking[key].minus(approvedRefundAmounts[key]).toFixed(0)])),reviewRequired};
}

// Caller holds Host bank -> unit -> booking -> complaint locks and writes the
// immutable Admin resolution in this transaction. No payment/bank execution here.
export async function recordComplaintRefund(tx:Prisma.TransactionClient,booking:Booking,hostId:string,complaintId:string,
  actorId:string,dto:ResolveComplaintDto,resolvedAt:Date) {
  if(dto.decision==='HOST' || !dto.allocation || !Number.isInteger(dto.expectedBookingVersion))
    throw new BadRequestException({errorCode:'INVALID_REFUND_ALLOCATION',message:'Cần từng khoản hoàn và phiên bản đơn.'});
  if(booking.version!==dto.expectedBookingVersion || booking.version>=2147483647)
    throw new ConflictException({errorCode:'STALE_BOOKING_VERSION',message:'Đơn đã thay đổi. Vui lòng tải lại.'});
  if(booking.paymentStatus!=='PAID' || !['CONFIRMED','CHECKED_IN','COMPLETED'].includes(booking.bookingStatus))
    throw new ConflictException({errorCode:'COMPLAINT_REFUND_NOT_ALLOWED',message:'Trạng thái đơn cần đối soát trước khi hoàn.'});
  const sourceId=await verifiedPaymentSource(tx,booking,hostId);
  const [unsupported]=await tx.$queryRaw<{found:boolean}[]>`SELECT (
    EXISTS(SELECT 1 FROM finance_journals WHERE booking_id=${booking.id}::uuid AND kind<>'PAYMENT' AND NOT finance_complaint_journal_verified(id) AND NOT finance_payout_journal_verified(id))
    OR EXISTS(SELECT 1 FROM finance_cancellations WHERE booking_id=${booking.id}::uuid)
    OR EXISTS(SELECT 1 FROM finance_payout_items i JOIN finance_payout_batches b ON b.id=i.batch_id WHERE i.booking_id=${booking.id}::uuid AND i.status='ACTIVE' AND b.status<>'PAID')
    OR EXISTS(SELECT 1 FROM finance_no_show_resolutions WHERE booking_id=${booking.id}::uuid)
  ) AS found`;
  if(unsupported.found) throw new ConflictException({errorCode:'FINANCIAL_REVIEW_REQUIRED',message:'Đơn đã có ghi sổ hoặc phân bổ khác; cần xử lý chứng cứ công nợ trước khi hoàn.'});
  const snapshot=await complaintBookingSnapshot(tx,booking.id,hostId);
  if(snapshot.reviewRequired)throw new ConflictException({errorCode:'FINANCIAL_REVIEW_REQUIRED',message:'Chứng cứ khoản đã hoàn cần được đối soát.'});
  const previous={baseAmount:snapshot.approvedRefundAmounts.baseAmount,cleaningFee:snapshot.approvedRefundAmounts.cleaningFee,
    serviceFee:snapshot.approvedRefundAmounts.serviceFee,taxAmount:snapshot.approvedRefundAmounts.taxAmount};
  const refund=calculateAdminRefund(cancellationSnapshot(booking),dto.allocation,dto.decision,previous);
  const policy=booking.policySnapshot as Record<string,Prisma.JsonValue>;
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(String(policy.checkOutTime)))
    throw new ConflictException({errorCode:'INVALID_REFUND_SNAPSHOT',message:'Đơn thiếu giờ trả phòng đã chốt.'});
  const checkout=roomTimestamp(booking.checkOutDate.toISOString().slice(0,10),String(policy.checkOutTime));
  const paid=await tx.$queryRaw<{id:string}[]>`SELECT i.id FROM finance_payout_items i JOIN finance_payout_batches b ON b.id=i.batch_id
    JOIN finance_payout_paid_items x ON x.item_id=i.id WHERE i.booking_id=${booking.id}::uuid AND i.status='ACTIVE' AND b.status='PAID'
    AND b.host_id=${hostId}::uuid AND finance_payout_journal_verified(x.journal_id)`;
  const debits=[[paid.length?'HOST_DEBT':'HOST_PAYABLE',refund.hostPayoutReduction],['PLATFORM_COMMISSION',refund.commissionReversal],
    ['PLATFORM_SERVICE',refund.refundServiceFee],['TAX_PAYABLE',refund.refundTaxAmount]] as const;
  const lines:FinancialJournalInput['lines']=debits.filter(([,amount])=>amount.gt(0)).map(([account,amount])=>({account,side:'DEBIT',amount}));
  lines.push({account:'REFUND_PAYABLE',side:'CREDIT',amount:refund.refundTotal});
  const journal=await appendFinancialJournal(tx,{eventKey:`complaint-refund:${complaintId}`,kind:'REFUND',bookingId:booking.id,hostId,actorId,reason:dto.reason.trim(),lines});
  const [{holdStart}]=await tx.$queryRaw<{holdStart:Date|null}[]>`INSERT INTO finance_complaint_refunds (complaint_id,booking_id,source_journal_id,reversal_journal_id,
    booking_version_before,booking_status_before,base_amount,cleaning_fee,service_fee,tax_amount,refund_amount,
    commission_reversal,host_reduction,checkout_at,hold_start)
    SELECT ${complaintId}::uuid,${booking.id}::uuid,${sourceId}::uuid,${journal.journalId}::uuid,${booking.version},${booking.bookingStatus},
      ${refund.refundBaseAmount.toFixed(0)}::numeric,${refund.refundCleaningFee.toFixed(0)}::numeric,${refund.refundServiceFee.toFixed(0)}::numeric,
      ${refund.refundTaxAmount.toFixed(0)}::numeric,${refund.refundTotal.toFixed(0)}::numeric,${refund.commissionReversal.toFixed(0)}::numeric,
      ${refund.hostPayoutReduction.toFixed(0)}::numeric,${checkout}::timestamptz,
      CASE WHEN r.decision='PARTIAL_REFUND' THEN greatest(${checkout}::timestamptz,r.created_at) ELSE NULL END
      FROM finance_complaint_resolutions r WHERE r.complaint_id=${complaintId}::uuid RETURNING hold_start AS "holdStart"`;
  const [obligation]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_refunds (complaint_id,amount)
    VALUES (${complaintId}::uuid,${refund.refundTotal.toFixed(0)}::numeric) RETURNING id`;
  if(paid.length && refund.hostPayoutReduction.gt(0)) await tx.$executeRaw`INSERT INTO finance_host_debts (refund_id,paid_item_id,host_id,booking_id,journal_id,amount)
    VALUES (${obligation.id}::uuid,${paid[0].id}::uuid,${hostId}::uuid,${booking.id}::uuid,${journal.journalId}::uuid,${refund.hostPayoutReduction.toFixed(0)}::numeric)`;
  // Keep all immutable stay/price snapshots. No historical calendar or pricing rows are deleted.
  const cancel=dto.decision==='FULL_REFUND' && resolvedAt<checkout;
  await tx.booking.update({where:{id:booking.id,version:booking.version,paymentStatus:'PAID'},data:{
    ...(cancel?{bookingStatus:'CANCELLED'}:{}),version:{increment:1},
  }});
  return {refundObligation:{id:obligation.id,amount:refund.refundTotal.toFixed(0),status:'PENDING'},
    holdUntil:holdStart?new Date(holdStart.getTime()+FINANCE_HOLD_MS).toISOString():null,cancelled:cancel};
}
