import {Prisma} from '../generated/prisma/client.js';

// Read-only. A mixed-source refund stays OPEN: no debt, offset reversal or
// payout processing is authorized until a separate resolution contract exists.
export async function settlementReview(tx:Prisma.TransactionClient,bookingId:string,hostId:string) {
 const [row]=await tx.$queryRaw<{originalHostAmount:string;offsetAmount:string;paidAmount:string}[]>`SELECT
  b.host_payout_amount::text AS "originalHostAmount",
  COALESCE((SELECT sum(o.amount) FROM finance_debt_offsets o JOIN finance_debt_settlements s ON s.id=o.settlement_id
   WHERE o.booking_id=b.id AND s.host_id=${hostId}::uuid
    AND NOT EXISTS(SELECT 1 FROM finance_debt_offset_reversals r WHERE r.offset_id=o.id)),0)::text AS "offsetAmount",
  COALESCE((SELECT sum(i.amount) FROM finance_payout_items i JOIN finance_payout_batches p ON p.id=i.batch_id
   JOIN finance_payout_paid_items x ON x.item_id=i.id
   WHERE i.booking_id=b.id AND i.status='ACTIVE' AND p.status='PAID' AND p.host_id=${hostId}::uuid
    AND finance_payout_journal_verified(x.journal_id)),0)::text AS "paidAmount"
  FROM bookings b WHERE b.id=${bookingId}::uuid`;
 if(!row||new Prisma.Decimal(row.offsetAmount).lte(0)||new Prisma.Decimal(row.paidAmount).lte(0))return null;
 return {originalHostAmount:new Prisma.Decimal(row.originalHostAmount).toFixed(0),offsetAmount:new Prisma.Decimal(row.offsetAmount).toFixed(0),paidAmount:new Prisma.Decimal(row.paidAmount).toFixed(0),
  potentialExcessAmount:Prisma.Decimal.max(new Prisma.Decimal(row.originalHostAmount).minus(row.paidAmount),0).toFixed(0)};
}
