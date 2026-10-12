import { Prisma } from '../generated/prisma/client.js';

export const FINANCE_HOLD_MS = 72 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function validDate(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new RangeError('Invalid payout timestamp');
}

export function partialStayHoldStart(checkout:Date,resolvedAt:Date):Date {
  validDate(checkout);validDate(resolvedAt);
  return new Date(Math.max(checkout.getTime(),resolvedAt.getTime()));
}

// Asia/Ho_Chi_Minh has a fixed UTC+7 offset. No machine-local timezone reads.
export function weeklyPayoutCutoff(now: Date): Date {
  validDate(now);
  const local = new Date(now.getTime() + VN_OFFSET_MS);
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 9)
    - ((local.getUTCDay() + 6) % 7) * DAY_MS - VN_OFFSET_MS;
  return new Date(monday > now.getTime() ? monday - 7 * DAY_MS : monday);
}

// Threshold gate only. Never use this as bank/dispute/source/debt/allocation authorization.
// Caller supplies the remaining ledger-backed amount after same-Host FIFO debt deductions.
export function meetsPayoutThreshold(amount: string, firstEligibleAt: Date, cutoff: Date): boolean {
  validDate(firstEligibleAt);
  validDate(cutoff);
  if (!/^\d{1,18}$/.test(amount)) throw new RangeError('Invalid integer VND amount');
  const net = new Prisma.Decimal(amount);
  if (net.gte('1000000000000000000')) throw new RangeError('VND amount exceeds ledger limit');
  return net.gt(0) && firstEligibleAt.getTime() <= cutoff.getTime()
    && (net.gte('200000') || cutoff.getTime() - firstEligibleAt.getTime() >= 60 * DAY_MS);
}
