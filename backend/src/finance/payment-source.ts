import { ConflictException } from '@nestjs/common';
import { Prisma,type Booking } from '../generated/prisma/client.js';

// Identical posted-source proof for Host revenue and Admin GMV; no PAID-flag shortcut.
export function paymentSourcesSql(hostId?:string) {
  return Prisma.sql`SELECT j.id,j.booking_id,
    coalesce(b.guest_id<>p.host_id AND j.host_id=p.host_id
      AND (SELECT count(*) FROM finance_journals s WHERE s.booking_id=b.id AND s.kind='PAYMENT')=1
      AND bool_and((e.side='DEBIT' AND e.account='CASH_CLEARING') OR (e.side='CREDIT' AND e.account IN('HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE')))
      AND sum(e.amount) FILTER(WHERE e.side='DEBIT' AND e.account='CASH_CLEARING')=b.total_amount
      AND coalesce(sum(e.amount) FILTER(WHERE e.side='CREDIT' AND e.account='HOST_PAYABLE'),0)=b.host_payout_amount
      AND coalesce(sum(e.amount) FILTER(WHERE e.side='CREDIT' AND e.account='PLATFORM_COMMISSION'),0)=b.commission_amount
      AND coalesce(sum(e.amount) FILTER(WHERE e.side='CREDIT' AND e.account='PLATFORM_SERVICE'),0)=b.service_fee
      AND coalesce(sum(e.amount) FILTER(WHERE e.side='CREDIT' AND e.account='TAX_PAYABLE'),0)=b.tax_amount,false) AS verified
    FROM finance_journals j JOIN bookings b ON b.id=j.booking_id
      JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id
      JOIN finance_entries e ON e.journal_id=j.id
    WHERE j.kind='PAYMENT' ${hostId?Prisma.sql`AND j.host_id=${hostId}::uuid`:Prisma.empty}
    GROUP BY j.id,b.id,p.host_id`;
}

// Shared by refund and payout. A PAID flag alone is not evidence of received money.
export async function verifiedPaymentSource(tx:Prisma.TransactionClient,booking:Booking,hostId:string) {
  const review=()=>new ConflictException({errorCode:'FINANCIAL_REVIEW_REQUIRED',message:'Giao dịch cần đối soát trước khi xử lý tài chính.'});
  const sources=await tx.$queryRaw<{id:string;hostId:string}[]>`SELECT id,host_id AS "hostId" FROM finance_journals
    WHERE booking_id=${booking.id}::uuid AND kind='PAYMENT'`;
  if(sources.length!==1 || sources[0].hostId!==hostId) throw review();
  const entries=await tx.$queryRaw<{account:string;side:string;amount:string}[]>`
    SELECT account,side,amount::text FROM finance_entries WHERE journal_id=${sources[0].id}::uuid`;
  const expected=new Map<string,Prisma.Decimal>([['DEBIT:CASH_CLEARING',booking.totalAmount],['CREDIT:HOST_PAYABLE',booking.hostPayoutAmount],
    ['CREDIT:PLATFORM_COMMISSION',booking.commissionAmount],['CREDIT:PLATFORM_SERVICE',booking.serviceFee],['CREDIT:TAX_PAYABLE',booking.taxAmount]]);
  for(const entry of entries) {
    const k=`${entry.side}:${entry.account}`,remaining=expected.get(k);
    if(!remaining) throw review();
    expected.set(k,remaining.minus(entry.amount));
  }
  if([...expected.values()].some(a=>!a.isZero())) throw review();
  return sources[0].id;
}
