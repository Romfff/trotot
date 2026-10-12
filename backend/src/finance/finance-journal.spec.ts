import { beforeEach,describe,expect,it,vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { appendFinancialJournal,type FinancialJournalInput } from './finance-journal.js';

const hostId='abcdef01-0000-4000-8000-000000000001',actorId='00000000-0000-4000-8000-000000000002';
const journalId='00000000-0000-4000-8000-000000000003';
const execute=vi.fn(),query=vi.fn();
const tx={$executeRaw:execute,$queryRaw:query} as unknown as Prisma.TransactionClient;
const input=():FinancialJournalInput=>({eventKey:'fixture:adjustment-lock',kind:'ADJUSTMENT',bookingId:null,hostId,actorId,
  reason:'Synthetic lock order only',lines:[{account:'HOST_DEBT',side:'DEBIT',amount:'1'},{account:'CASH_CLEARING',side:'CREDIT',amount:'1'}]});
beforeEach(()=>{execute.mockReset();execute.mockResolvedValue(1);query.mockReset();query.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:journalId}]);});

describe('S4 adjustment journal application lock order (mock SQL, not debt authorization)',()=>{
  it('takes canonical Host lock before event lock and before any journal writes',async()=>{
    expect(await appendFinancialJournal(tx,{...input(),hostId:hostId.toUpperCase()})).toEqual({journalId,replayed:false});
    expect(execute.mock.calls[0]).toContain(`bank:${hostId}`);
    expect(execute.mock.calls[1]).toContain('finance:fixture:adjustment-lock');
    expect(execute.mock.invocationCallOrder[1]).toBeLessThan(query.mock.invocationCallOrder[0]);
  });
  it.each(['PAYMENT','REFUND','PAYOUT'] as const)('does not change the existing %s inventory/event locking order',async kind=>{
    await appendFinancialJournal(tx,{...input(),kind});
    expect(execute.mock.calls[0]).toContain('finance:fixture:adjustment-lock');
    expect(execute.mock.calls.flat()).not.toContain(`bank:${hostId}`);
  });
  it('invalid money is rejected before taking locks or writing a journal',async()=>{
    const data=input();data.lines[0].amount='0.5';
    await expect(appendFinancialJournal(tx,data)).rejects.toMatchObject({response:{errorCode:'INVALID_FINANCIAL_JOURNAL'}});
    expect(execute).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
  });
});
