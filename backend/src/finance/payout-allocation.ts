import { Prisma } from '../generated/prisma/client.js';
import { meetsPayoutThreshold } from './payout-policy.js';

type Earning = { id: string; hostId: string; amount: string; eligibleAt: Date };
type Debt = { id: string; hostId: string; amount: string; createdAt: Date };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ledgerLimit = new Prisma.Decimal('1000000000000000000');
const sum = (rows: { remaining: Prisma.Decimal }[]) => rows.reduce((n, r) => n.plus(r.remaining), new Prisma.Decimal(0));

function validDate(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new RangeError('Invalid allocation timestamp');
}
function money(value: string) {
  if (typeof value !== 'string' || !/^\d{1,18}$/.test(value)) throw new RangeError('Invalid integer VND allocation');
  return new Prisma.Decimal(value);
}

// Pure plan, never a transfer or settlement. Inputs must already be ledger-backed,
// unreserved and eligible after DB ownership/source/dispute checks. The executor
// must lock/revalidate and persist this entire plan atomically with its audit.
export function planHostPayout(hostId: string, cutoff: Date, earnings: readonly Earning[], debts: readonly Debt[]) {
  if (!uuid.test(hostId)) throw new RangeError('Invalid allocation Host');
  validDate(cutoff);
  function prepare<T extends { id: string; hostId: string; amount: string }>(rows: readonly T[], date: (row: T) => Date) {
    const ids = new Set<string>();
    const prepared = rows.map(row => {
      if (!uuid.test(row.id) || row.hostId !== hostId || ids.has(row.id)) throw new RangeError('Invalid allocation ownership or duplicate source');
      ids.add(row.id);
      const at = date(row); validDate(at);
      return { id: row.id, at, remaining: money(row.amount) };
    });
    if (sum(prepared).gte(ledgerLimit)) throw new RangeError('Allocation total exceeds ledger limit');
    return prepared.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const available = prepare(earnings, r => r.eligibleAt);
  const outstanding = prepare(debts, r => r.createdAt);
  const currentEarnings = available.filter(r => r.at <= cutoff);
  const gross = sum(currentEarnings);
  const offsets: { earningId: string; debtId: string; amount: string }[] = [];
  let index = 0;
  // The weekly cutoff gates earnings, not liabilities. New debt discovered after
  // cutoff must still reduce this batch when it is built/approved/paid.
  for (const debt of outstanding) {
    while (debt.remaining.gt(0) && index < currentEarnings.length) {
      const earning = currentEarnings[index];
      if (earning.remaining.isZero()) { index++; continue; }
      const amount = Prisma.Decimal.min(debt.remaining, earning.remaining);
      offsets.push({ earningId: earning.id, debtId: debt.id, amount: amount.toFixed(0) });
      debt.remaining = debt.remaining.minus(amount);
      earning.remaining = earning.remaining.minus(amount);
    }
  }
  const net = sum(currentEarnings);
  const first = currentEarnings.find(r => r.remaining.gt(0))?.at ?? null;
  return {
    hostId, cutoff: cutoff.toISOString(), grossEligible: gross.toFixed(0), debtOffset: gross.minus(net).toFixed(0),
    netPayout: net.toFixed(0), offsets,
    remainingEarnings: available.map(r => ({ id: r.id, amount: r.remaining.toFixed(0) })),
    remainingDebts: outstanding.map(r => ({ id: r.id, amount: r.remaining.toFixed(0) })),
    firstUnpaidEligibleAt: first?.toISOString() ?? null,
    meetsThreshold: first !== null && meetsPayoutThreshold(net.toFixed(0), first, cutoff),
  };
}
