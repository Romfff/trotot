import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { calculateLongTermEstimate, configuredEstimateLimits, estimateUsageLimits, type EstimatePrices } from './long-term-estimate.js';
const prices: EstimatePrices = { monthlyPrice: '3000000', depositAmount: '3000000', electricityCost: '3500', waterCost: '20000', waterUnit: 'M3', internetCost: '100000', garbageCost: '30000', parkingFee: '120000' };
const usage = { electricityKwh: '1', waterM3: '1', vehicles: '1' };

describe('D12 approved estimate (parking unit still explicitly required)', () => {
  it.each([['0.49', 0], ['0.5', 1], ['0.51', 1]] as const)('preserves Decimal rate %s and rounds only its subtotal', (rate, amount) => {
    const result = calculateLongTermEstimate({ ...prices, electricityCost: rate }, { ...usage, electricityKwh: '1' }, 'VEHICLE');
    expect(result.lines.find(line => line.code === 'ELECTRICITY')).toMatchObject({ unitPrice: rate, amount });
  });
  it('keeps exact declared decimal rates and sums rounded lines instead of rounding the aggregate', () => {
    const result = calculateLongTermEstimate({ ...prices, electricityCost: '4.9', waterCost: '5.1', internetCost: '0.49', garbageCost: '0.51', parkingFee: '0.5', depositAmount: '10.5' }, { electricityKwh: '0.1', waterM3: '0.1', vehicles: '1' }, 'VEHICLE');
    expect(result.lines.map(line => line.amount)).toEqual([3000000, 0, 1, 0, 1, 1]);
    expect(result.totalMonthly).toBe(3000003); expect(result.deposit).toBe(11);
    expect(result.lines.find(line => line.code === 'WATER')?.unitPrice).toBe('5.1');
  });
  it('separates missing usage from undeclared costs without inventing defaults', () => {
    const result = calculateLongTermEstimate({ ...prices, internetCost: null }, {}, 'VEHICLE');
    expect(result.totalMonthly).toBe(3030000); expect(result.deposit).toBe(3000000); expect(result.isComplete).toBe(false);
    expect(result.missingInputs).toEqual(['electricityKwh', 'waterM3', 'vehicles']); expect(result.missingCosts).toEqual(['INTERNET']);
    expect(result.lines.find(line => line.code === 'INTERNET')).toMatchObject({ status: 'NOT_DECLARED', unitPrice: null, amount: null });
    expect(result.lines.find(line => line.code === 'ELECTRICITY')).toMatchObject({ status: 'NEEDS_INPUT', quantity: null, amount: null });
  });
  it('rounds each subtotal half up and sums exactly the displayed lines', () => {
    const result = calculateLongTermEstimate({ ...prices, electricityCost: '1', waterCost: '3' }, { electricityKwh: '0.5', waterM3: '0.5', vehicles: '0' }, 'VEHICLE');
    expect(result.lines.find(line => line.code === 'ELECTRICITY')?.amount).toBe(1);
    expect(result.lines.find(line => line.code === 'WATER')?.amount).toBe(2);
    expect(result.totalMonthly).toBe(result.lines.reduce((sum, line) => sum + (line.amount ?? 0), 0));
    expect(result.totalMonthly).toBe(3130003); expect(result.isComplete).toBe(true);
  });
  it('uses PERSON instead of M3 and ignores invalid irrelevant water query', () => {
    const result = calculateLongTermEstimate({ ...prices, waterUnit: 'PERSON' }, { electricityKwh: '0', occupants: '2', waterM3: '-bad', vehicles: '3' }, 'VEHICLE');
    expect(result.totalMonthly).toBe(3530000); expect(result.missingCosts).toEqual([]);
    expect(result.lines.find(line => line.code === 'WATER')).toMatchObject({ quantity: 2, unit: 'VND/PERSON/MONTH', status: 'COMPUTED' });
    expect(calculateLongTermEstimate(prices, { ...usage, occupants: ['bad'] }, 'VEHICLE').isComplete).toBe(true);
  });
  it.each(['monthlyPrice', 'electricityCost', 'waterCost', 'internetCost', 'garbageCost', 'parkingFee'] as const)('reports null %s as NOT_DECLARED, not free', key => {
    const result = calculateLongTermEstimate({ ...prices, [key]: null }, usage, 'VEHICLE');
    expect(result.missingCosts).toHaveLength(1); expect(result.isComplete).toBe(false);
    expect(result.lines.filter(line => line.status === 'NOT_DECLARED')[0].amount).toBeNull();
  });
  it('separates explicit free prices from zero usage', () => {
    const result = calculateLongTermEstimate({ ...prices, internetCost: '0', waterCost: '0', depositAmount: null }, { ...usage, electricityKwh: '0' }, 'VEHICLE');
    expect(result.lines.find(line => line.code === 'INTERNET')).toMatchObject({ status: 'FREE', amount: 0 });
    expect(result.lines.find(line => line.code === 'WATER')).toMatchObject({ status: 'FREE', amount: 0 });
    expect(result.lines.find(line => line.code === 'ELECTRICITY')).toMatchObject({ status: 'COMPUTED', amount: 0 });
    expect(result.deposit).toBeNull(); expect(result.isComplete).toBe(true);
  });
  it('requests usage for missing vehicles even when their fee is zero', () => {
    expect(calculateLongTermEstimate({ ...prices, parkingFee: '0' }, {}, 'VEHICLE').lines.at(-1)).toMatchObject({ status: 'NEEDS_INPUT', amount: null });
  });
  it.each(['-1', 'NaN', 'Infinity', '', '1e3', '1.23', '10000.1', ' 1', '1 ', '9'.repeat(33), ['1'], null, true])('rejects invalid electricity usage %j', electricityKwh => {
    expect(() => calculateLongTermEstimate(prices, { electricityKwh }, 'VEHICLE')).toThrow(BadRequestException);
  });
  it('rejects fractional/excessive counts with field-prefixed message[] for envelope errors[]', () => {
    try { calculateLongTermEstimate({ ...prices, waterUnit: 'PERSON' }, { vehicles: '1.0', occupants: '21' }, 'VEHICLE'); }
    catch (error) { expect((error as BadRequestException).getResponse()).toMatchObject({ errorCode: 'INVALID_ESTIMATE_USAGE', message: [expect.stringMatching(/^occupants /), expect.stringMatching(/^vehicles /)] }); return; }
    throw new Error('Expected validation error');
  });
  it('accepts exact configured boundaries and rejects the next tenth/count', () => {
    expect(calculateLongTermEstimate(prices, { electricityKwh: '10000', waterM3: '1000', vehicles: '10' }, 'VEHICLE').isComplete).toBe(true);
    expect(calculateLongTermEstimate({ ...prices, waterUnit: 'PERSON' }, { ...usage, occupants: '20' }, 'VEHICLE').isComplete).toBe(true);
    for (const input of [{ waterM3: '1000.1' }, { vehicles: '11' }]) expect(() => calculateLongTermEstimate(prices, input, 'VEHICLE')).toThrow();
    const limits = configuredEstimateLimits({ ESTIMATE_MAX_ELECTRICITY_KWH: '25', ESTIMATE_MAX_VEHICLES: '2' });
    expect(() => calculateLongTermEstimate(prices, { electricityKwh: '25.1' }, 'VEHICLE', limits)).toThrow();
    expect(() => calculateLongTermEstimate(prices, { vehicles: '3' }, 'VEHICLE', limits)).toThrow();
  });
  it('validates configuration without silently falling back', () => {
    expect(configuredEstimateLimits({})).toEqual(estimateUsageLimits);
    for (const value of ['0', '-1', '1.5', 'NaN', '', '9007199254740992']) expect(() => configuredEstimateLimits({ ESTIMATE_MAX_OCCUPANTS: value })).toThrow();
  });
  it('refuses unsafe integer amounts when an operator raises usage limits too far', () => {
    expect(() => calculateLongTermEstimate({ ...prices, electricityCost: '9999999999.99' }, { electricityKwh: '1000000' }, 'VEHICLE', { ...estimateUsageLimits, electricityKwh: 1000000 })).toThrow(BadRequestException);
  });
  it('has no business default for parking unit', () => {
    expect(calculateLongTermEstimate(prices, {}, 'ROOM').totalMonthly).toBe(3250000);
    expect(calculateLongTermEstimate(prices, {}, 'VEHICLE').lines.at(-1)?.status).toBe('NEEDS_INPUT');
  });
});
