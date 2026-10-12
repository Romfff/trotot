import { describe, expect, it } from 'vitest';
import { planHostPayout } from './payout-allocation.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hostId = id(99), cutoff = new Date('2026-10-05T02:00:00Z');
const old = new Date('2026-08-01T02:00:00Z'), recent = new Date('2026-10-01T02:00:00Z');
const earning = (n: number, amount: string, eligibleAt = old) => ({ id: id(n), hostId, amount, eligibleAt });
const debt = (n: number, amount: string, createdAt = old) => ({ id: id(n), hostId, amount, createdAt });

describe('S4 same-Host FIFO payout allocation (pure plan, no money movement)', () => {
  it('offsets oldest debt first across multiple earnings with deterministic ordering', () => {
    const result = planHostPayout(hostId, cutoff, [earning(2, '200000', recent), earning(1, '100000')],
      [debt(12, '100000', recent), debt(11, '150000')]);
    expect(result).toMatchObject({ grossEligible: '300000', debtOffset: '250000', netPayout: '50000', meetsThreshold: false,
      firstUnpaidEligibleAt: recent.toISOString(),
      offsets: [{ earningId: id(1), debtId: id(11), amount: '100000' },
        { earningId: id(2), debtId: id(11), amount: '50000' }, { earningId: id(2), debtId: id(12), amount: '100000' }],
      remainingDebts: [{ id: id(11), amount: '0' }, { id: id(12), amount: '0' }],
    });
  });
  it('caps offset at eligible funds and carries debt forward without negative payout', () => {
    expect(planHostPayout(hostId, cutoff, [earning(1, '100')], [debt(11, '70'), debt(12, '80', recent)]))
      .toMatchObject({ grossEligible: '100', debtOffset: '100', netPayout: '0', meetsThreshold: false,
        firstUnpaidEligibleAt: null, remainingDebts: [{ id: id(11), amount: '0' }, { id: id(12), amount: '50' }] });
  });
  it('uses UUID tie-breakers rather than input/database order for equal timestamps', () => {
    const earnings = [earning(1, '10'), earning(2, '20')], debts = [debt(11, '15'), debt(12, '5')];
    expect(planHostPayout(hostId, cutoff, [...earnings].reverse(), [...debts].reverse()))
      .toEqual(planHostPayout(hostId, cutoff, earnings, debts));
  });
  it('never ages new money using an old earning already fully consumed by debt', () => {
    const plan = planHostPayout(hostId, cutoff, [earning(1, '100'), earning(2, '100', recent)], [debt(11, '100')]);
    expect(plan).toMatchObject({ netPayout: '100', firstUnpaidEligibleAt: recent.toISOString(), meetsThreshold: false });
  });
  it('applies the minimum to net, but allows old residual money at 60 days', () => {
    expect(planHostPayout(hostId, cutoff, [earning(1, '200000', recent)], [debt(11, '1')])).toMatchObject({ netPayout: '199999', meetsThreshold: false });
    expect(planHostPayout(hostId, cutoff, [earning(1, '200000')], [debt(11, '199999')])).toMatchObject({ netPayout: '1', meetsThreshold: true });
    expect(planHostPayout(hostId, cutoff, [earning(1, '200000', recent)], [])).toMatchObject({ netPayout: '200000', meetsThreshold: true });
  });
  it('excludes earnings after cutoff but still offsets debt discovered after cutoff', () => {
    const future = new Date(cutoff.getTime() + 1);
    expect(planHostPayout(hostId, cutoff, [earning(1, '10'), earning(2, '900', future)], [debt(11, '1000', future)]))
      .toMatchObject({ grossEligible: '10', debtOffset: '10', netPayout: '0',
        remainingEarnings: [{ id: id(1), amount: '0' }, { id: id(2), amount: '900' }], remainingDebts: [{ id: id(11), amount: '990' }] });
  });
  it('includes rows exactly at cutoff and skips zero rows without looping', () => {
    expect(planHostPayout(hostId, cutoff, [earning(1, '0'), earning(2, '10', cutoff)], [debt(11, '0'), debt(12, '5', cutoff)]))
      .toMatchObject({ grossEligible: '10', debtOffset: '5', netPayout: '5', offsets: [{ earningId: id(2), debtId: id(12), amount: '5' }] });
  });
  it('handles empty inputs or debt without funds', () => {
    expect(planHostPayout(hostId, cutoff, [], [])).toMatchObject({ netPayout: '0', offsets: [], meetsThreshold: false });
    expect(planHostPayout(hostId, cutoff, [], [debt(11, '1')])).toMatchObject({ netPayout: '0', remainingDebts: [{ id: id(11), amount: '1' }] });
  });
  it.each([
    ['99','100','0','1'],['100','100','0','0'],['101','100','1','0'],
  ])('settlement boundary funds=%s debt=%s preserves residual VND without a zero transfer', (funds,liability,net,remaining) => {
    const result=planHostPayout(hostId,cutoff,[earning(1,funds)],[debt(11,liability)]);
    expect(result.netPayout).toBe(net);expect(result.remainingDebts[0].amount).toBe(remaining);
    expect(result.remainingEarnings[0].amount).toBe(net);
    expect(result.offsets.every(row=>BigInt(row.amount)>0n)).toBe(true);
    expect(planHostPayout(hostId,cutoff,[earning(1,funds)],[debt(11,liability)])).toEqual(result);
    // This pure plan never persists a batch. Net-zero execution belongs to settlement, not transfer.
    if(net==='0')expect(result.meetsThreshold).toBe(false);
  });
  it('preserves 18-digit VND exactly and never mutates caller rows', () => {
    const earnings = [Object.freeze(earning(1, '999999999999999999'))], debts = [Object.freeze(debt(11, '9007199254740993'))];
    expect(planHostPayout(hostId, cutoff, earnings, debts)).toMatchObject({ netPayout: '990992800745259006', debtOffset: '9007199254740993' });
    expect(earnings[0].amount).toBe('999999999999999999'); expect(debts[0].amount).toBe('9007199254740993');
  });
  it.each(['-1', '0.5', '1e3', 'Infinity', 'NaN', '', ' 1', '1000000000000000000'])('rejects malformed money %s on either side', amount => {
    expect(() => planHostPayout(hostId, cutoff, [earning(1, amount)], [])).toThrow(RangeError);
    expect(() => planHostPayout(hostId, cutoff, [], [debt(11, amount)])).toThrow(RangeError);
  });
  it('fails closed on another Host, duplicate IDs, malformed IDs or dates', () => {
    expect(() => planHostPayout(hostId, cutoff, [{ ...earning(1, '1'), hostId: id(98) }], [])).toThrow(RangeError);
    expect(() => planHostPayout(hostId, cutoff, [], [{ ...debt(11, '1'), hostId: id(98) }])).toThrow(RangeError);
    expect(() => planHostPayout(hostId, cutoff, [earning(1, '1'), earning(1, '2')], [])).toThrow(RangeError);
    expect(() => planHostPayout(hostId, cutoff, [], [debt(11, '1'), debt(11, '2')])).toThrow(RangeError);
    expect(() => planHostPayout('invalid', cutoff, [], [])).toThrow(RangeError);
    expect(() => planHostPayout(hostId, cutoff, [{ ...earning(1, '1'), id: 'invalid' }], [])).toThrow(RangeError);
    expect(() => planHostPayout(hostId, new Date(NaN), [], [])).toThrow(RangeError);
    expect(() => planHostPayout(hostId, cutoff, [earning(1, '1', new Date(NaN))], [])).toThrow(RangeError);
    expect(() => planHostPayout(hostId, cutoff, [], [debt(11, '1', new Date(NaN))])).toThrow(RangeError);
  });
  it('rejects aggregated inputs exceeding journal precision even if each row fits', () => {
    expect(() => planHostPayout(hostId, cutoff, [earning(1, '999999999999999999'), earning(2, '1')], [])).toThrow(RangeError);
    expect(() => planHostPayout(hostId, cutoff, [], [debt(11, '999999999999999999'), debt(12, '1')])).toThrow(RangeError);
  });
  it('conserves every earning and debt for 100 deterministic varied plans', () => {
    for (let n = 0; n < 100; n++) {
      const earnings = [earning(1, String(n * 7919)), earning(2, String(n * 37 + 1), recent)];
      const debts = [debt(11, String(n * 1009)), debt(12, String(n * 3001), recent)];
      const result = planHostPayout(hostId, cutoff, earnings, debts);
      const offset = BigInt(result.debtOffset), net = BigInt(result.netPayout);
      expect(offset + net).toBe(earnings.reduce((sum, row) => sum + BigInt(row.amount), 0n));
      expect(result.offsets.reduce((sum, row) => sum + BigInt(row.amount), 0n)).toBe(offset);
      for (const row of earnings) {
        const used = result.offsets.filter(o => o.earningId === row.id).reduce((sum, o) => sum + BigInt(o.amount), 0n);
        expect(used + BigInt(result.remainingEarnings.find(r => r.id === row.id)!.amount)).toBe(BigInt(row.amount));
      }
      for (const row of debts) {
        const used = result.offsets.filter(o => o.debtId === row.id).reduce((sum, o) => sum + BigInt(o.amount), 0n);
        expect(used + BigInt(result.remainingDebts.find(r => r.id === row.id)!.amount)).toBe(BigInt(row.amount));
      }
    }
  });
});
