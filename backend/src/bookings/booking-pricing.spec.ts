import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { calculateNightlySubtotal, calculateStayPrice } from './booking-pricing.js';

describe('server nightly subtotal — no unapproved fee/commission defaults', () => {
  it('uses custom price, then Friday/Saturday rate, then base; excludes checkout', () => {
    const result = calculateNightlySubtotal('2026-10-22', '2026-10-26', {
      basePricePerNight: '600000', weekendPricePerNight: '750000',
      customPrices: new Map([['2026-10-23', '900000'], ['2026-10-26', '1000000']]),
    });
    expect(result.totalNights).toBe(4);
    expect(result.nightlyPrices.map(({ date, price }) => [date, price.toString()])).toEqual([
      ['2026-10-22', '600000'], ['2026-10-23', '900000'],
      ['2026-10-24', '750000'], ['2026-10-25', '600000'],
    ]);
    expect(result.baseAmount.toString()).toBe('2850000');
    expect(result).not.toHaveProperty('serviceFee');
    expect(result).not.toHaveProperty('commissionRate');
  });

  it('falls back to base only when weekend rate is null, and preserves explicit zero', () => {
    const pricing = { basePricePerNight: '100', weekendPricePerNight: null, customPrices: new Map([['2026-10-23', '0']]) };
    expect(calculateNightlySubtotal('2026-10-23', '2026-10-25', pricing).baseAmount.toString()).toBe('100');
    expect(calculateNightlySubtotal('2026-10-23', '2026-10-25', { ...pricing, weekendPricePerNight: '0' }).baseAmount.toString()).toBe('0');
  });

  it('rounds each nightly amount before summing, including half-up at 0.5', () => {
    const result = calculateNightlySubtotal('2026-10-19', '2026-10-22', {
      basePricePerNight: '100.49', weekendPricePerNight: null, customPrices: new Map([['2026-10-20', '100.50']]),
    });
    expect(result.nightlyPrices.map(night => night.price.toString())).toEqual(['100','101','100']);
    expect(result.baseAmount.toString()).toBe('301');
  });

  it.each(['-1', 'NaN', 'Infinity', 'bad', '0.001', '10000000000000'])('rejects invalid price %s', (value) => {
    const pricing = { basePricePerNight: '100', weekendPricePerNight: null, customPrices: new Map<string, string>() };
    expect(() => calculateNightlySubtotal('2026-10-23', '2026-10-24', { ...pricing, basePricePerNight: value })).toThrow(BadRequestException);
    expect(() => calculateNightlySubtotal('2026-10-23', '2026-10-24', { ...pricing, weekendPricePerNight: value })).toThrow(BadRequestException);
    expect(() => calculateNightlySubtotal('2026-10-23', '2026-10-24', { ...pricing, customPrices: new Map([['2026-10-23', value]]) })).toThrow(BadRequestException);
  });

  it('rejects subtotal overflow even when each nightly price fits the storage boundary', () => {
    expect(() => calculateNightlySubtotal('2026-10-19', '2026-10-21', {
      basePricePerNight: '9999999999999.99', weekendPricePerNight: null, customPrices: new Map(),
    })).toThrow(BadRequestException);
  });

  it('rejects impossible dates before returning a quote', () => {
    expect(() => calculateNightlySubtotal('2027-02-29', '2027-03-02', {
      basePricePerNight: '100', weekendPricePerNight: null, customPrices: new Map(),
    })).toThrow(BadRequestException);
  });
});

describe('shared stay quote with rounded charges and Host commission', () => {
  const pricing = { basePricePerNight: '100.50', weekendPricePerNight: null, customPrices: new Map<string, string>(),
    cleaningFee: '4.50', serviceFeeRate: '0', taxRate: '0', commissionRate: '10' };
  it('rounds nights/cleaning/commission and derives payout without losing a dong', () => {
    const quote = calculateStayPrice('2026-10-19','2026-10-21',pricing);
    expect(quote.baseAmount.toString()).toBe('202');
    expect(quote.cleaningFee.toString()).toBe('5');
    expect(quote.serviceFee.toString()).toBe('0');
    expect(quote.taxAmount.toString()).toBe('0');
    expect(quote.totalAmount.toString()).toBe('207');
    expect(quote.commissionAmount.toString()).toBe('21');
    expect(quote.hostPayoutAmount.toString()).toBe('186');
    expect(quote.commissionAmount.plus(quote.hostPayoutAmount).equals(quote.baseAmount.plus(quote.cleaningFee))).toBe(true);
    expect(quote.rates.commissionRate.toString()).toBe('10');
  });
  it.each(['8','12'])('uses configured commission %s within the approved range', commissionRate => {
    const quote = calculateStayPrice('2026-10-19','2026-10-20',{ ...pricing, commissionRate });
    expect(quote.rates.commissionRate.toString()).toBe(commissionRate);
    expect(quote.totalAmount.toString()).toBe('106');
  });
  it.each(['7.99','12.01','NaN','-1'])('rejects commission outside approved bounds %s', commissionRate => {
    expect(() => calculateStayPrice('2026-10-19','2026-10-20',{ ...pricing, commissionRate })).toThrow(BadRequestException);
  });
  it('rounds service before tax, excludes both from commission and payout, and snapshots the rates', () => {
    const quote = calculateStayPrice('2026-10-19','2026-10-20',{ ...pricing, serviceFeeRate:'5', taxRate:'8' });
    // night101 + cleaning5 =106; service5.30→5; tax111*8%=8.88→9; total120.
    expect(quote.baseAmount.toString()).toBe('101');
    expect(quote.cleaningFee.toString()).toBe('5');
    expect(quote.serviceFee.toString()).toBe('5');
    expect(quote.taxAmount.toString()).toBe('9');
    expect(quote.totalAmount.toString()).toBe('120');
    expect(quote.commissionAmount.toString()).toBe('11');
    expect(quote.hostPayoutAmount.toString()).toBe('95');
    expect(quote.rates.serviceFeeRate.toString()).toBe('5');
    expect(quote.rates.taxRate.toString()).toBe('8');
    expect(quote.totalAmount.equals(quote.baseAmount.plus(quote.cleaningFee).plus(quote.serviceFee).plus(quote.taxAmount))).toBe(true);
  });
  it('rounds a fee exactly at .5 up before calculating the next fee', () => {
    const quote = calculateStayPrice('2026-10-19','2026-10-20', { ...pricing, basePricePerNight:'10', cleaningFee:'0', serviceFeeRate:'5', taxRate:'5' });
    expect(quote.serviceFee.toString()).toBe('1');
    expect(quote.taxAmount.toString()).toBe('1');
    expect(quote.totalAmount.toString()).toBe('12');
  });
  it.each(['-1','100.01','NaN','0.001'])('validates service and tax rates %s', value => {
    expect(() => calculateStayPrice('2026-10-19','2026-10-20',{ ...pricing, serviceFeeRate:value })).toThrow(BadRequestException);
    expect(() => calculateStayPrice('2026-10-19','2026-10-20',{ ...pricing, taxRate:value })).toThrow(BadRequestException);
  });
  it('rejects total overflow caused by cleaning, not just nightly subtotal', () => {
    expect(() => calculateStayPrice('2026-10-19','2026-10-20',{ ...pricing, basePricePerNight:'9999999999998', cleaningFee:'2' })).toThrow(BadRequestException);
  });
});
