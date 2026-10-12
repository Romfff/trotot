import { ConflictException } from '@nestjs/common';
import { Prisma,type Booking } from '../generated/prisma/client.js';
import { verifiedPaymentSource } from '../finance/payment-source.js';

export type VnpayPaymentProof={provider:'VNPAY_SANDBOX';verified:true;sessionId:string;amountVnd:string;paidAt:string};
// Stored flags, redirect query and a generic payment journal are not provider proof.
export async function readVnpayPaymentProof(tx:Prisma.TransactionClient,booking:Booking):Promise<VnpayPaymentProof|null> {
  if(!['PAID','REFUNDED'].includes(booking.paymentStatus))return null;
  const rows=await tx.$queryRaw<{sessionId:string;journalId:string;hostId:string;amount:string;paidAt:Date}[]>`
    SELECT s.id AS "sessionId",r.journal_id AS "journalId",p.host_id AS "hostId",r.amount_vnd::text AS amount,r.pay_date AS "paidAt"
    FROM vnpay_ipn_receipts r JOIN payment_sessions s ON s.id=r.session_id
      JOIN finance_journals j ON j.id=r.journal_id JOIN bookings b ON b.id=s.booking_id
      JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id
    WHERE b.id=${booking.id}::uuid AND s.guest_id=b.guest_id AND s.provider='VNPAY_SANDBOX'
      AND r.outcome='APPLIED' AND r.reason_code='MATCHED' AND r.pay_date IS NOT NULL
      AND s.merchant_code=r.merchant_code AND s.amount_vnd=r.amount_vnd AND r.amount_vnd=b.total_amount
      AND j.booking_id=b.id AND j.host_id=p.host_id AND j.kind='PAYMENT' AND j.actor_id IS NULL
      AND j.created_txid=r.created_txid AND j.event_key='vnpay-paid:'||r.merchant_code||':'||r.transaction_no`;
  if(rows.length!==1)return null;
  const row=rows[0];
  try {if(await verifiedPaymentSource(tx,booking,row.hostId)!==row.journalId)return null;}
  catch(error){if(error instanceof ConflictException)return null;throw error;}
  return {provider:'VNPAY_SANDBOX',verified:true,sessionId:row.sessionId,amountVnd:new Prisma.Decimal(row.amount).toFixed(0),paidAt:row.paidAt.toISOString()};
}
