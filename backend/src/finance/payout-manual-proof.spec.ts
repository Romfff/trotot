import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { recordManualPayout } from './payout-manual-proof.js';
const id='00000000-0000-4000-8000-000000000001';
const valid={expectedVersion:2,bankReference:'FIXTURE',evidenceNote:'Synthetic only',reason:'Synthetic'};
describe('manual payout evidence input (SQL mocks only)',()=>{
  it.each([
    {...valid,expectedVersion:1},{...valid,expectedVersion:2.5},{...valid,expectedVersion:2147483647},
    {...valid,bankReference:''},{...valid,bankReference:'x'.repeat(201)},
    {...valid,evidenceNote:' '},{...valid,evidenceNote:'x'.repeat(501)},
    {...valid,reason:' '},{...valid,reason:'x'.repeat(501)},
  ])('rejects malformed proof before any SQL %j',async input=>{
    const query=vi.fn(),execute=vi.fn(),tx={$queryRaw:query,$executeRaw:execute} as unknown as Prisma.TransactionClient;
    await expect(recordManualPayout(tx,id,id,input)).rejects.toMatchObject({response:{errorCode:'INVALID_PAYOUT_EVIDENCE'}});
    expect(query).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
  });
  it.each([{role:'HOST',status:'ACTIVE'},{role:'ADMIN',status:'BANNED'}])('rejects unauthorized actor before bank/ledger writes %j',async actor=>{
    const query=vi.fn().mockResolvedValue([actor]),execute=vi.fn();
    await expect(recordManualPayout({$queryRaw:query,$executeRaw:execute} as unknown as Prisma.TransactionClient,id,id,valid)).rejects.toMatchObject({status:403});
    expect(query).toHaveBeenCalledTimes(1);expect(execute).not.toHaveBeenCalled();
  });
});
