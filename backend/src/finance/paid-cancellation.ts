import { ConflictException } from '@nestjs/common';
import { Prisma, type Booking } from '../generated/prisma/client.js';
import { appendFinancialJournal, type FinancialJournalInput } from './finance-journal.js';
import type { calculateCancellationRefund } from '../bookings/booking-refund.js';
import { verifiedPaymentSource } from './payment-source.js';

// No public payment simulator. Only a verified-payment adapter may post the source PAYMENT.
// Legacy PAID flags without an exact journal require reconciliation; never invent incoming money.
export async function recordPaidCancellation(tx:Prisma.TransactionClient, booking:Booking, hostId:string,
  actorId:string, actorType:'GUEST'|'HOST', reason:string, refund:ReturnType<typeof calculateCancellationRefund>) {
  const sourceId=await verifiedPaymentSource(tx,booking,hostId);
  const other=await tx.$queryRaw<{id:string}[]>`SELECT id FROM finance_journals
    WHERE booking_id=${booking.id}::uuid AND kind<>'PAYMENT' LIMIT 1`;
  if(other.length) throw new ConflictException({errorCode:'FINANCIAL_REVIEW_REQUIRED',message:'Giao dịch cần đối soát trước khi hủy. Vui lòng liên hệ hỗ trợ.'});
  let journalId:string|null=null;
  if(refund.refundTotal.gt(0)) {
    const debits=[['HOST_PAYABLE',refund.hostPayoutReduction],['PLATFORM_COMMISSION',refund.commissionReversal],
      ['PLATFORM_SERVICE',refund.refundServiceFee],['TAX_PAYABLE',refund.refundTaxAmount]] as const;
    const lines:FinancialJournalInput['lines']=debits.filter(([,amount])=>amount.gt(0)).map(([account,amount])=>({account,side:'DEBIT',amount}));
    lines.push({account:'REFUND_PAYABLE',side:'CREDIT',amount:refund.refundTotal});
    journalId=(await appendFinancialJournal(tx,{eventKey:`cancellation:${booking.id}`,kind:'REFUND',bookingId:booking.id,hostId,actorId,reason,lines})).journalId;
  }
  const calculation=JSON.stringify(Object.fromEntries(Object.entries(refund).map(([k,v])=>[k,v instanceof Date?v.toISOString():String(v)])));
  const [audit]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_cancellations
    (booking_id,actor_id,actor_type,reason,refund_amount,calculation,source_journal_id,reversal_journal_id)
    VALUES (${booking.id}::uuid,${actorId}::uuid,${actorType},${reason},${refund.refundTotal.toFixed(0)}::numeric,
      ${calculation}::jsonb,${sourceId}::uuid,${journalId}::uuid) RETURNING id`;
  if(refund.refundTotal.isZero()) return {id:null,amount:0,status:'NOT_REQUIRED'};
  const [obligation]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_refunds (cancellation_id,amount)
    VALUES (${audit.id}::uuid,${refund.refundTotal.toFixed(0)}::numeric) RETURNING id`;
  return {id:obligation.id,amount:refund.refundTotal.toNumber(),status:'PENDING'};
}
