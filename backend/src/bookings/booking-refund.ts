import { BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { dateEpoch } from './booking-dates.js';
import { roomTimestamp } from './booking-lifecycle.js';
import type { Booking } from '../generated/prisma/client.js';

type Money = Prisma.Decimal | string | number;
export type CancellationSnapshot = {
  checkInDate: string; checkInTime: string; cancellationPolicy: string;
  baseAmount: Money; cleaningFee: Money; serviceFee: Money; taxAmount: Money;
  totalAmount: Money; commissionRate: Money; commissionAmount: Money; hostPayoutAmount: Money;
};

export function cancellationSnapshot(booking: Booking): CancellationSnapshot {
  const policy=booking.policySnapshot;
  if(!policy || typeof policy!=='object' || Array.isArray(policy)) return invalidSnapshot();
  return {checkInDate:booking.checkInDate.toISOString().slice(0,10),checkInTime:String(policy.checkInTime),
    cancellationPolicy:String(policy.cancellationPolicy),baseAmount:booking.baseAmount,cleaningFee:booking.cleaningFee,
    serviceFee:booking.serviceFee,taxAmount:booking.taxAmount,totalAmount:booking.totalAmount,
    commissionRate:booking.commissionRate,commissionAmount:booking.commissionAmount,hostPayoutAmount:booking.hostPayoutAmount};
}

function invalidSnapshot(): never {
  throw new InternalServerErrorException({ errorCode: 'INVALID_REFUND_SNAPSHOT', message: 'Không thể tính hoàn tiền từ dữ liệu đơn. Vui lòng liên hệ hỗ trợ.' });
}
function money(value: Money): Prisma.Decimal {
  try {
    const amount = new Prisma.Decimal(value);
    if (amount.isFinite() && amount.isInteger() && amount.gte(0) && amount.lte('9999999999999')) return amount;
  } catch { /* No parser details or financial data in the public error. */ }
  return invalidSnapshot();
}
const rounded = (amount: Prisma.Decimal) => amount.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

function snapshotAmounts(snapshot: CancellationSnapshot) {
  const baseAmount = money(snapshot.baseAmount), cleaningFee = money(snapshot.cleaningFee);
  const serviceFee = money(snapshot.serviceFee), taxAmount = money(snapshot.taxAmount);
  const totalAmount = money(snapshot.totalAmount), commissionAmount = money(snapshot.commissionAmount);
  const hostPayoutAmount = money(snapshot.hostPayoutAmount);
  let commissionRate: Prisma.Decimal;
  try { commissionRate = new Prisma.Decimal(snapshot.commissionRate); } catch { return invalidSnapshot(); }
  if (!commissionRate.isFinite() || commissionRate.lt(8) || commissionRate.gt(12) || commissionRate.decimalPlaces() > 2
    || !totalAmount.eq(baseAmount.plus(cleaningFee).plus(serviceFee).plus(taxAmount))
    || !commissionAmount.eq(rounded(baseAmount.plus(cleaningFee).times(commissionRate).dividedBy(100)))
    || !hostPayoutAmount.eq(baseAmount.plus(cleaningFee).minus(commissionAmount))) return invalidSnapshot();
  return {baseAmount,cleaningFee,serviceFee,taxAmount,totalAmount,commissionAmount,hostPayoutAmount,commissionRate};
}
export type AdminRefundAllocation = {baseAmount:string;cleaningFee:string;serviceFee:string;taxAmount:string};

// Admin supplies exact individual amounts, never an inferred percentage or current unit prices.
export function calculateAdminRefund(snapshot:CancellationSnapshot,allocation:AdminRefundAllocation,decision:'FULL_REFUND'|'PARTIAL_REFUND',previous:AdminRefundAllocation={baseAmount:'0',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}) {
  const amounts=snapshotAmounts(snapshot);
  const invalid=()=>new BadRequestException({errorCode:'INVALID_REFUND_ALLOCATION',message:'Các khoản hoàn phải là VND nguyên, đúng trần và quyết định hoàn.'});
  if(!allocation || !['FULL_REFUND','PARTIAL_REFUND'].includes(decision)) throw invalid();
  const read=(values:AdminRefundAllocation,key:keyof AdminRefundAllocation)=>{
    const value=values[key];
    if(typeof value!=='string' || !/^(0|[1-9]\d{0,12})$/.test(value)) throw invalid();
    const amount=new Prisma.Decimal(value);if(amount.gt(amounts[key])) throw invalid();return amount;
  };
  const priorBase=read(previous,'baseAmount'),priorCleaning=read(previous,'cleaningFee'),priorService=read(previous,'serviceFee'),priorTax=read(previous,'taxAmount');
  const refundBaseAmount=read(allocation,'baseAmount'),refundCleaningFee=read(allocation,'cleaningFee'),refundServiceFee=read(allocation,'serviceFee'),refundTaxAmount=read(allocation,'taxAmount');
  const refundTotal=refundBaseAmount.plus(refundCleaningFee).plus(refundServiceFee).plus(refundTaxAmount);
  const priorTotal=priorBase.plus(priorCleaning).plus(priorService).plus(priorTax);
  if(refundBaseAmount.plus(priorBase).gt(amounts.baseAmount)||refundCleaningFee.plus(priorCleaning).gt(amounts.cleaningFee)
    ||refundServiceFee.plus(priorService).gt(amounts.serviceFee)||refundTaxAmount.plus(priorTax).gt(amounts.taxAmount)
    ||refundTotal.lte(0) || (decision==='FULL_REFUND'?!refundTotal.plus(priorTotal).eq(amounts.totalAmount):refundTotal.plus(priorTotal).gte(amounts.totalAmount)||!refundServiceFee.isZero())) throw invalid();
  const previousGross=amounts.baseAmount.minus(priorBase).plus(amounts.cleaningFee.minus(priorCleaning));
  const previousCommission=rounded(previousGross.times(amounts.commissionRate).dividedBy(100));
  const retainedGross=previousGross.minus(refundBaseAmount).minus(refundCleaningFee);
  const retainedCommission=rounded(retainedGross.times(amounts.commissionRate).dividedBy(100));
  const retainedHostPayout=retainedGross.minus(retainedCommission);
  return {refundBaseAmount,refundCleaningFee,refundServiceFee,refundTaxAmount,refundTotal,retainedCommission,retainedHostPayout,
    commissionReversal:previousCommission.minus(retainedCommission),hostPayoutReduction:previousGross.minus(previousCommission).minus(retainedHostPayout)};
}

// APPROVED-14 (06/10/2026): pure server calculation, not authorization or payment execution.
// Caller supplies immutable DB snapshot and DB time, never client totals or current unit pricing.
export function calculateCancellationRefund(snapshot: CancellationSnapshot, actor: 'GUEST' | 'HOST', now: Date) {
  if (!['GUEST', 'HOST'].includes(actor) || !Number.isFinite(now.getTime())) return invalidSnapshot();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(snapshot.checkInTime)) return invalidSnapshot();
  try { dateEpoch(snapshot.checkInDate); } catch { return invalidSnapshot(); }
  const checkInAt = roomTimestamp(snapshot.checkInDate, snapshot.checkInTime);
  const hours = (checkInAt.getTime() - now.getTime()) / 3_600_000;
  const policy = snapshot.cancellationPolicy;
  if (!['FLEXIBLE', 'MODERATE', 'STRICT'].includes(policy)) return invalidSnapshot();
  if (hours <= 0) throw new ConflictException({ errorCode: 'MANUAL_REFUND_REVIEW_REQUIRED', message: 'Đã tới giờ nhận phòng. Vui lòng gửi yêu cầu hỗ trợ xử lý.' });
  const percent = actor === 'HOST' ? 100 : policy === 'FLEXIBLE' ? (hours >= 24 ? 100 : 0)
    : policy === 'MODERATE' ? (hours >= 120 ? 100 : hours >= 24 ? 50 : 0) : (hours >= 168 ? 50 : 0);
  const {baseAmount,cleaningFee,serviceFee,taxAmount,commissionRate,commissionAmount,hostPayoutAmount}=snapshotAmounts(snapshot);
  const refundBaseAmount = rounded(baseAmount.times(percent).dividedBy(100));
  const refundCleaningFee = rounded(cleaningFee.times(percent).dividedBy(100));
  const refundServiceFee = percent === 100 ? serviceFee : new Prisma.Decimal(0);
  const refundTaxAmount = rounded(taxAmount.times(percent).dividedBy(100));
  const refundTotal = refundBaseAmount.plus(refundCleaningFee).plus(refundServiceFee).plus(refundTaxAmount);
  const retainedHostGross = baseAmount.minus(refundBaseAmount).plus(cleaningFee.minus(refundCleaningFee));
  const retainedCommission = rounded(retainedHostGross.times(commissionRate).dividedBy(100));
  const retainedHostPayout = retainedHostGross.minus(retainedCommission);
  return { policy, percent, checkInAt, refundBaseAmount, refundCleaningFee, refundServiceFee, refundTaxAmount,
    refundTotal, retainedCommission, commissionReversal: commissionAmount.minus(retainedCommission),
    retainedHostPayout, hostPayoutReduction: hostPayoutAmount.minus(retainedHostPayout) };
}
