import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';

const accounts = ['CASH_CLEARING','HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE','REFUND_PAYABLE','HOST_DEBT'] as const;
export type FinancialJournalInput = {
  eventKey: string; kind: 'PAYMENT' | 'REFUND' | 'PAYOUT' | 'ADJUSTMENT';
  bookingId: string | null; hostId: string; actorId: string | null; reason: string;
  lines: { account: typeof accounts[number]; side: 'DEBIT' | 'CREDIT'; amount: string | Prisma.Decimal }[];
};
function invalid(): never {
  throw new InternalServerErrorException({ errorCode: 'INVALID_FINANCIAL_JOURNAL', message: 'Không thể ghi sổ giao dịch. Vui lòng liên hệ hỗ trợ.' });
}

// Internal only; domain callers enforce role/ownership, source verification and refund/allocation caps.
// The caller transaction owns journal, obligation/status and audit changes; never call after commit.
export async function appendFinancialJournal(tx: Prisma.TransactionClient, input: FinancialJournalInput) {
  if (!/^[!-~]{1,256}$/.test(input.eventKey) || !['PAYMENT','REFUND','PAYOUT','ADJUSTMENT'].includes(input.kind)
    || typeof input.reason !== 'string' || input.reason.trim().length < 1 || input.reason.trim().length > 500
    || input.lines.length < 2 || input.lines.length > 20) return invalid();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.hostId) || (input.bookingId !== null && !uuid.test(input.bookingId))
    || (input.actorId !== null && !uuid.test(input.actorId))) return invalid();
  let debit = new Prisma.Decimal(0), credit = new Prisma.Decimal(0);
  const lines = input.lines.map(line => {
    if (!accounts.includes(line.account) || !['DEBIT','CREDIT'].includes(line.side)) return invalid();
    let amount: Prisma.Decimal;
    try { amount = new Prisma.Decimal(line.amount); } catch { return invalid(); }
    if (!amount.isFinite() || !amount.isInteger() || amount.lte(0) || amount.gte('1000000000000000000')) return invalid();
    if (line.side === 'DEBIT') debit = debit.plus(amount); else credit = credit.plus(amount);
    return { account: line.account, side: line.side, amount: amount.toFixed(0) };
  });
  if (!debit.eq(credit)) return invalid();
  const reason = input.reason.trim();
  const requestHash = createHash('sha256').update(JSON.stringify({ kind: input.kind, bookingId: input.bookingId,
    hostId: input.hostId, actorId: input.actorId, reason, currency: 'VND', lines })).digest('hex');
  // Match payout's Host -> event order. The DB repeats this lock for raw SQL;
  // taking the event first could deadlock with an executor already holding Host.
  // Refund callers lock inventory first, so do not introduce this order to them.
  if (input.kind === 'ADJUSTMENT')
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${input.hostId.toLowerCase()}`},0))`;
  // Permanent event identity, not the expiring 7-day HTTP idempotency record.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`finance:${input.eventKey}`},0))`;
  const [existing] = await tx.$queryRaw<{ id: string; requestHash: string }[]>`
    SELECT id,request_hash AS "requestHash" FROM finance_journals WHERE event_key=${input.eventKey}`;
  if (existing) {
    if (existing.requestHash !== requestHash) throw new ConflictException({ errorCode: 'FINANCIAL_EVENT_CONFLICT', message: 'Mã giao dịch đã được ghi nhận với nội dung khác.' });
    return { journalId: existing.id, replayed: true };
  }
  const [journal] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO finance_journals
    (event_key,request_hash,kind,booking_id,host_id,actor_id,reason)
    VALUES (${input.eventKey},${requestHash},${input.kind},${input.bookingId}::uuid,${input.hostId}::uuid,${input.actorId}::uuid,${reason}) RETURNING id`;
  await tx.$executeRaw(Prisma.sql`INSERT INTO finance_entries (journal_id,line_number,account,side,amount) VALUES ${Prisma.join(
    lines.map((line, index) => Prisma.sql`(${journal.id}::uuid,${index + 1},${line.account},${line.side},${line.amount}::numeric)`),
  )}`);
  return { journalId: journal.id, replayed: false };
}
