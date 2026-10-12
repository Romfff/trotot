import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { persistPayoutDraft, cancelPayoutDraft, approvePayoutDraft } from './payout-drafts.js';

const hostId='00000000-0000-4000-8000-000000000001',actorId='00000000-0000-4000-8000-000000000002';
const bankId='00000000-0000-4000-8000-000000000003',batchId='00000000-0000-4000-8000-000000000004';
const cutoff=new Date('2026-10-05T02:00:00Z');
const item={bookingId:hostId,sourceJournalId:actorId,amount:'200000',eligibleAt:new Date('2026-09-01T00:00:00Z')};
const query=vi.fn(),execute=vi.fn();
const tx={$queryRaw:query,$executeRaw:execute} as unknown as Prisma.TransactionClient;
beforeEach(()=>{query.mockReset();execute.mockReset();execute.mockResolvedValue(1);});

describe('S4 internal draft transaction primitives (mock SQL calls; not eligibility evidence)',()=>{
  it('uses current bank snapshot and writes audit/items inside the supplied transaction without exposing bank details',async()=>{
    query.mockResolvedValueOnce([{id:bankId,version:2,bankCode:'FIXTURE',accountNumber:'12345678',accountName:'Synthetic only'}])
      .mockResolvedValueOnce([{id:batchId}]);
    const result=await persistPayoutDraft(tx,hostId,actorId,cutoff,' Synthetic reason ',[item]);
    expect(result).toEqual({id:batchId,hostId,cutoff:cutoff.toISOString(),amount:'200000',status:'DRAFT',version:1});
    expect(query.mock.calls[1]).toContain('200000');
    expect(execute).toHaveBeenCalledTimes(3); // bank lock, creation audit, one item
    expect(execute.mock.calls[1]).toContain('Synthetic reason');
    expect(JSON.stringify(result)).not.toContain('12345678');
  });
  it('does not lose precision when summing large values or change caller inputs',async()=>{
    query.mockResolvedValueOnce([{id:bankId,version:2,bankCode:'FIXTURE',accountNumber:'12345678',accountName:'Synthetic only'}])
      .mockResolvedValueOnce([{id:batchId}]);
    const first=Object.freeze({...item,amount:'9007199254740993'}),second=Object.freeze({...item,bookingId:bankId,amount:'1'});
    expect((await persistPayoutDraft(tx,hostId,actorId,cutoff,'Synthetic',[first,second])).amount).toBe('9007199254740994');
    expect(first.amount).toBe('9007199254740993');
  });
  it('fails before batch insertion if current bank is unverified',async()=>{
    query.mockResolvedValueOnce([]);
    await expect(persistPayoutDraft(tx,hostId,actorId,cutoff,'Synthetic',[item])).rejects.toMatchObject({response:{errorCode:'PAYOUT_BANK_NOT_VERIFIED'}});
    expect(query).toHaveBeenCalledTimes(1);expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each(['',' ','x'.repeat(501)])('rejects invalid reason before SQL',async reason=>{
    await expect(persistPayoutDraft(tx,hostId,actorId,cutoff,reason,[item])).rejects.toMatchObject({status:400});
    await expect(cancelPayoutDraft(tx,actorId,batchId,1,reason)).rejects.toMatchObject({status:400});
    expect(query).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
  });
  it.each(['0','-1','0.5','NaN','1e5','1000000000000000000'])('rejects invalid amount %s before SQL',async amount=>{
    await expect(persistPayoutDraft(tx,hostId,actorId,cutoff,'Synthetic',[{...item,amount}])).rejects.toMatchObject({status:400});
    expect(query).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
  });
  it('rejects empty/duplicate/invalid IDs/timestamps and oversized aggregates before SQL',async()=>{
    for(const items of [[],[item,item],[{...item,bookingId:'invalid'}],[{...item,sourceJournalId:'invalid'}],
      [{...item,eligibleAt:new Date(NaN)}],[{...item,amount:'999999999999999999'},{...item,bookingId:bankId,amount:'1'}]]) {
      await expect(persistPayoutDraft(tx,hostId,actorId,cutoff,'Synthetic',items)).rejects.toMatchObject({status:400});
    }
    await expect(persistPayoutDraft(tx,'invalid',actorId,cutoff,'Synthetic',[item])).rejects.toMatchObject({status:400});
    await expect(persistPayoutDraft(tx,hostId,actorId,new Date(NaN),'Synthetic',[item])).rejects.toMatchObject({status:400});
    expect(query).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
  });
  it('cancels with locked current version and releases all items in the same transaction',async()=>{
    query.mockResolvedValueOnce([{status:'DRAFT',version:1}]).mockResolvedValueOnce([]);
    expect(await cancelPayoutDraft(tx,actorId,batchId,1,'Synthetic')).toEqual({id:batchId,status:'CANCELLED',version:2});
    expect(query.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[1][0].join('')).toContain("AND status IN('DRAFT','APPROVED')");
    expect(execute.mock.calls[2][0].join('')).toContain("status='RELEASED'");
  });
  it.each([
    {rows:[],code:'PAYOUT_NOT_FOUND'}, {rows:[{status:'DRAFT',version:2}],code:'STALE_PAYOUT_VERSION'},
    {rows:[{status:'CANCELLED',version:1}],code:'PAYOUT_NOT_DRAFT'},
  ])('fails $code without new audit/status writes',async({rows,code})=>{
    query.mockResolvedValueOnce(rows);
    await expect(cancelPayoutDraft(tx,actorId,batchId,1,'Synthetic')).rejects.toMatchObject({response:{errorCode:code}});
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([0,-1,1.5,2147483647,NaN])('rejects unsafe expectedVersion %s before SQL',async version=>{
    await expect(cancelPayoutDraft(tx,actorId,batchId,version,'Synthetic')).rejects.toMatchObject({status:400});
    expect(query).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
  });
  it('approves only after DB readiness and writes audit before conditional version transition, without a journal/transfer',async()=>{
    query.mockResolvedValueOnce([{status:'DRAFT',version:1}]).mockResolvedValueOnce([{ready:true}]);
    expect(await approvePayoutDraft(tx,actorId,batchId,1,' Synthetic ')).toEqual({id:batchId,status:'APPROVED',version:2});
    expect(query.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(query.mock.calls[1][0].join('')).toContain('finance_payout_ready');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0].join('')).toContain("'APPROVED'");
    expect(execute.mock.calls[0]).toContain('Synthetic');
    expect(execute.mock.calls[1][0].join('')).toContain("AND status='DRAFT'");
  });
  it.each([
    {rows:[],code:'PAYOUT_NOT_FOUND'}, {rows:[{status:'DRAFT',version:2}],code:'STALE_PAYOUT_VERSION'},
    {rows:[{status:'APPROVED',version:1}],code:'PAYOUT_NOT_DRAFT'}, {rows:[{status:'CANCELLED',version:1}],code:'PAYOUT_NOT_DRAFT'},
  ])('approval fails $code without writes',async({rows,code})=>{
    query.mockResolvedValueOnce(rows);
    await expect(approvePayoutDraft(tx,actorId,batchId,1,'Synthetic')).rejects.toMatchObject({response:{errorCode:code}});
    expect(execute).not.toHaveBeenCalled();
  });
  it('refuses changed financial gates instead of approving stale source/bank',async()=>{
    query.mockResolvedValueOnce([{status:'DRAFT',version:1}]).mockResolvedValueOnce([{ready:false}]);
    await expect(approvePayoutDraft(tx,actorId,batchId,1,'Synthetic')).rejects.toMatchObject({response:{errorCode:'PAYOUT_REVIEW_REQUIRED'}});
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects malformed approval IDs, unsafe version and missing reason before SQL',async()=>{
    for (const values of [[actorId,batchId,0,'Synthetic'],['bad',batchId,1,'Synthetic'],[actorId,batchId,1,' ']] as const)
      await expect(approvePayoutDraft(tx,...values)).rejects.toMatchObject({status:400});
    expect(query).not.toHaveBeenCalled();
  });
  it('can cancel an approved but unpaid allocation and release its items',async()=>{
    query.mockResolvedValueOnce([{status:'APPROVED',version:2}]).mockResolvedValueOnce([]);
    expect(await cancelPayoutDraft(tx,actorId,batchId,2,'Synthetic')).toMatchObject({status:'CANCELLED',version:3});
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
