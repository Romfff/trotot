import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { calculateCancellationRefund, type CancellationSnapshot } from './booking-refund.js';

const snapshot: CancellationSnapshot = { checkInDate: '2026-10-20', checkInTime: '14:00:00', cancellationPolicy: 'MODERATE',
  baseAmount: '101', cleaningFee: '5', serviceFee: '5', taxAmount: '9', totalAmount: '120',
  commissionRate: '10', commissionAmount: '11', hostPayoutAmount: '95' };
const checkIn = new Date('2026-10-20T14:00:00+07:00');
const atHours = (hours: number) => new Date(checkIn.getTime() - hours * 3_600_000);

describe('S4 immutable cancellation policy — APPROVED-14, no provider/payment mutation', () => {
  it.each([
    ['FLEXIBLE', 24 + 1 / 3_600_000, 100], ['FLEXIBLE', 24, 100], ['FLEXIBLE', 24 - 1 / 3_600_000, 0],
    ['MODERATE', 120 + 1 / 3_600_000, 100], ['MODERATE', 120, 100], ['MODERATE', 120 - 1 / 3_600_000, 50],
    ['MODERATE', 24, 50], ['MODERATE', 24 - 1 / 3_600_000, 0],
    ['STRICT', 168 + 1 / 3_600_000, 50], ['STRICT', 168, 50], ['STRICT', 168 - 1 / 3_600_000, 0],
  ])('%s at %sh before VN check-in refunds %s%%', (cancellationPolicy, hours, expected) => {
    expect(calculateCancellationRefund({ ...snapshot, cancellationPolicy }, 'GUEST', atHours(Number(hours))).percent).toBe(expected);
  });
  it.each(['FLEXIBLE', 'MODERATE', 'STRICT'])('Host cancel %s refunds all charges even inside 24h', cancellationPolicy => {
    const result = calculateCancellationRefund({ ...snapshot, cancellationPolicy }, 'HOST', atHours(1));
    expect(result.percent).toBe(100); expect(result.refundTotal.toString()).toBe('120');
    expect(result.retainedCommission.isZero()).toBe(true); expect(result.retainedHostPayout.isZero()).toBe(true);
    expect(result.commissionReversal.toString()).toBe('11');
  });
  it('partial refund rounds each charge HALF_UP, retains platform service, and derives commission from retained basis', () => {
    const result = calculateCancellationRefund(snapshot, 'GUEST', atHours(48));
    expect([result.refundBaseAmount, result.refundCleaningFee, result.refundServiceFee, result.refundTaxAmount].map(n => n.toString())).toEqual(['51', '3', '0', '5']);
    expect(result.refundTotal.toString()).toBe('59');
    expect(result.retainedCommission.toString()).toBe('5');
    expect(result.commissionReversal.toString()).toBe('6');
    expect(result.retainedHostPayout.toString()).toBe('47');
    expect(result.hostPayoutReduction.plus(result.commissionReversal).eq(result.refundBaseAmount.plus(result.refundCleaningFee))).toBe(true);
    expect(result.retainedCommission.plus(result.retainedHostPayout).plus(result.refundBaseAmount).plus(result.refundCleaningFee).eq('106')).toBe(true);
  });
  it('full Guest refund includes platform service; zero refund leaves every retained amount unchanged', () => {
    expect(calculateCancellationRefund(snapshot, 'GUEST', atHours(120)).refundTotal.eq(snapshot.totalAmount)).toBe(true);
    const none = calculateCancellationRefund(snapshot, 'GUEST', atHours(1));
    expect(none.refundTotal.isZero()).toBe(true); expect(none.commissionReversal.isZero()).toBe(true);
    expect(none.retainedHostPayout.eq(snapshot.hostPayoutAmount)).toBe(true);
  });
  it('uses check-in clock, not midnight or the machine timezone', () => {
    expect(calculateCancellationRefund({ ...snapshot, cancellationPolicy: 'FLEXIBLE' }, 'GUEST', new Date('2026-10-19T07:00:00Z')).percent).toBe(100);
    expect(calculateCancellationRefund({ ...snapshot, cancellationPolicy: 'FLEXIBLE' }, 'GUEST', new Date('2026-10-19T07:00:00.001Z')).percent).toBe(0);
  });
  it.each(['2026-10-20T07:00:00Z', '2026-10-21T07:00:00Z'])('requires manual review at or after check-in %s for both actors', date => {
    for (const actor of ['GUEST', 'HOST'] as const) expect(() => calculateCancellationRefund(snapshot, actor, new Date(date))).toThrow(ConflictException);
  });
  it('does not mutate snapshot, Decimal instances or time', () => {
    const input = Object.freeze({ ...snapshot, baseAmount: new Prisma.Decimal('101') });
    const now = atHours(48), before = now.getTime();
    calculateCancellationRefund(input, 'GUEST', now);
    expect(input.baseAmount.toString()).toBe('101'); expect(input.commissionAmount).toBe('11'); expect(now.getTime()).toBe(before);
  });
  it.each(['NaN', 'Infinity', '-1', '0.5', '10000000000000', 'invalid'])('rejects invalid immutable money %s without leaking parser data', value => {
    expect(() => calculateCancellationRefund({ ...snapshot, baseAmount: value }, 'GUEST', atHours(48))).toThrow(InternalServerErrorException);
  });
  it.each([
    { checkInDate: '2027-02-29' }, { checkInTime: '25:00:00' }, { cancellationPolicy: 'UNKNOWN' },
    { totalAmount: '121' }, { commissionAmount: '10' }, { hostPayoutAmount: '96' },
    { commissionRate: '7.99' }, { commissionRate: '12.01' }, { commissionRate: '10.001' }, { commissionRate: 'NaN' },
  ])('fails closed on corrupt snapshot %j', change => {
    expect(() => calculateCancellationRefund({ ...snapshot, ...change }, 'GUEST', atHours(48))).toThrow(InternalServerErrorException);
  });
  it('rejects invalid server time', () => {
    expect(() => calculateCancellationRefund(snapshot, 'GUEST', new Date('invalid'))).toThrow(InternalServerErrorException);
  });
  it('balances rounded partial reversal across small amounts and all approved commission rates', () => {
    for (let base = 0; base < 20; base++) for (let clean = 0; clean < 10; clean++) for (const rate of ['8', '10', '12']) {
      const gross = new Prisma.Decimal(base + clean), commission = gross.times(rate).dividedBy(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
      const s = { ...snapshot, baseAmount: String(base), cleaningFee: String(clean), serviceFee: '3', taxAmount: '1',
        totalAmount: String(base + clean + 4), commissionRate: rate, commissionAmount: commission, hostPayoutAmount: gross.minus(commission) };
      const result = calculateCancellationRefund(s, 'GUEST', atHours(48));
      expect(result.refundTotal.lte(s.totalAmount)).toBe(true);
      expect(result.commissionReversal.gte(0)).toBe(true);
      expect(result.hostPayoutReduction.plus(result.commissionReversal).eq(result.refundBaseAmount.plus(result.refundCleaningFee))).toBe(true);
    }
  });
});
