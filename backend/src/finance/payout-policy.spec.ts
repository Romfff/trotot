import { describe, expect, it } from 'vitest';
import { meetsPayoutThreshold, weeklyPayoutCutoff } from './payout-policy.js';

describe('S4 weekly payout policy (no transfer authorization)', () => {
  it.each([
    ['2026-10-05T01:59:59.999Z', '2026-09-28T02:00:00.000Z'],
    ['2026-10-05T02:00:00.000Z', '2026-10-05T02:00:00.000Z'],
    ['2026-10-05T02:00:00.001Z', '2026-10-05T02:00:00.000Z'],
    ['2026-10-06T08:00:00.000Z', '2026-10-05T02:00:00.000Z'],
    ['2026-10-11T23:59:59.999Z', '2026-10-05T02:00:00.000Z'],
    ['2026-10-12T02:00:00.000Z', '2026-10-12T02:00:00.000Z'],
    ['2026-01-01T00:00:00.000Z', '2025-12-29T02:00:00.000Z'],
    ['2024-03-01T00:00:00.000Z', '2024-02-26T02:00:00.000Z'],
  ])('uses Monday 09:00 Vietnam cutoff for %s', (now, expected) => {
    expect(weeklyPayoutCutoff(new Date(now)).toISOString()).toBe(expected);
  });
  const cutoff = new Date('2026-10-05T02:00:00Z');
  const sixtyDays = 60 * 24 * 60 * 60 * 1000;
  const first = new Date(cutoff.getTime() - sixtyDays);
  it('applies the threshold to positive net amounts, not gross revenue', () => {
    expect(meetsPayoutThreshold('200000', cutoff, cutoff)).toBe(true);
    expect(meetsPayoutThreshold('199999', cutoff, cutoff)).toBe(false);
    expect(meetsPayoutThreshold('0', first, cutoff)).toBe(false);
    expect(meetsPayoutThreshold('999999999999999999', cutoff, cutoff)).toBe(true);
  });
  it('allows a positive sub-threshold amount exactly after 60 days, never earlier', () => {
    expect(meetsPayoutThreshold('1', first, cutoff)).toBe(true);
    expect(meetsPayoutThreshold('199999', new Date(first.getTime()+1), cutoff)).toBe(false);
    expect(meetsPayoutThreshold('199999', new Date(first.getTime()-1), cutoff)).toBe(true);
  });
  it('does not collect a newly eligible item after the weekly cutoff on restart', () => {
    expect(meetsPayoutThreshold('200000', new Date(cutoff.getTime()+1), cutoff)).toBe(false);
  });
  it('waits for the next weekly cutoff when the 60-day exception falls midweek', () => {
    const eligible = new Date('2026-08-08T02:00:00Z'); // reaches 60 days on Wednesday Oct 7
    expect(meetsPayoutThreshold('100', eligible, weeklyPayoutCutoff(new Date('2026-10-08T02:00:00Z')))).toBe(false);
    expect(meetsPayoutThreshold('100', eligible, weeklyPayoutCutoff(new Date('2026-10-12T02:00:00Z')))).toBe(true);
  });
  it.each(['-1', '0.5', 'NaN', 'Infinity', '1e6', ' 200000', '1000000000000000000'])('rejects malformed/out-of-range VND %s', amount => {
    expect(() => meetsPayoutThreshold(amount, first, cutoff)).toThrow(RangeError);
  });
  it('rejects invalid timestamps rather than silently allowing payment', () => {
    expect(() => weeklyPayoutCutoff(new Date(NaN))).toThrow(RangeError);
    expect(() => meetsPayoutThreshold('200000', new Date(NaN), cutoff)).toThrow(RangeError);
    expect(() => meetsPayoutThreshold('200000', first, new Date(NaN))).toThrow(RangeError);
  });
});
