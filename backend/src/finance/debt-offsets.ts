import { Prisma } from '../generated/prisma/client.js';
import { appendFinancialJournal } from './finance-journal.js';

// Caller owns Host/unit/booking locks. Append reversals, never mutate offsets/history.
export async function reverseDebtOffsets(tx:Prisma.TransactionClient,actorId:string,reason:string,scope:{batchId:string}|{settlementId:string}) {
  const rows=await tx.$queryRaw<{id:string;bookingId:string;hostId:string;amount:string}[]>(Prisma.sql`
    SELECT o.id,o.booking_id AS "bookingId",s.host_id AS "hostId",o.amount::text AS amount FROM finance_debt_offsets o
    JOIN finance_debt_settlements s ON s.id=o.settlement_id
    WHERE ${'batchId' in scope?Prisma.sql`s.batch_id=${scope.batchId}::uuid`:Prisma.sql`s.id=${scope.settlementId}::uuid`}
    AND NOT EXISTS(SELECT 1 FROM finance_debt_offset_reversals r WHERE r.offset_id=o.id) ORDER BY o.created_at,o.id`);
  for(const row of rows) {
    const j=await appendFinancialJournal(tx,{eventKey:`debt-offset-reversal:${row.id}`,kind:'ADJUSTMENT',bookingId:row.bookingId,
      hostId:row.hostId,actorId,reason,lines:[{account:'HOST_DEBT',side:'DEBIT',amount:row.amount},{account:'HOST_PAYABLE',side:'CREDIT',amount:row.amount}]});
    await tx.$executeRaw`INSERT INTO finance_debt_offset_reversals(offset_id,journal_id,actor_id,reason)
      VALUES (${row.id}::uuid,${j.journalId}::uuid,${actorId}::uuid,${reason.trim()})`;
  }
  return rows.length;
}
