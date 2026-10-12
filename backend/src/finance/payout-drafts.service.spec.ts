import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';
import { PayoutDraftsService } from './payout-drafts.service.js';

const hostId='abcdef01-0000-4000-8000-000000000001',actorId='00000000-0000-4000-8000-000000000002';
const batchId='abcdef03-0000-4000-8000-000000000003',bankId='00000000-0000-4000-8000-000000000004';
const row={bookingId:batchId,sourceJournalId:bankId,amount:'200000',eligibleAt:new Date('2026-10-01T02:00:00Z')};
const query=vi.fn(),execute=vi.fn(),userFind=vi.fn(),batchFind=vi.fn(),batchMany=vi.fn(),batchCount=vi.fn(),batchDetail=vi.fn();
const batchThrow=vi.fn();
const tx={$queryRaw:query,$executeRaw:execute,user:{findUnique:userFind},financePayoutBatch:{findUnique:batchFind,findUniqueOrThrow:batchThrow,findMany:batchMany,count:batchCount,findFirst:batchDetail}};
const run=vi.fn((_actor:unknown,_operation:unknown,_key:unknown,_body:unknown,apply:(tx:unknown)=>Promise<unknown>)=>apply(tx));
const transaction=vi.fn((apply:(tx:unknown)=>Promise<unknown>,_options?:unknown)=>apply(tx));
const service=new PayoutDraftsService({$transaction:transaction} as unknown as PrismaService,{run} as unknown as BookingIdempotencyService);
beforeEach(()=>{vi.clearAllMocks();query.mockReset();execute.mockResolvedValue(1);userFind.mockResolvedValue({id:hostId});});
function candidates(rows:unknown[]= [row], debt=false) {
  query.mockResolvedValueOnce([{debt}]).mockResolvedValueOnce([]).mockResolvedValueOnce([{now:new Date('2026-10-06T02:00:00Z')}]).mockResolvedValueOnce(rows);
}
describe('S4 draft domain (mock transaction, not proof of real eligible payout)',()=>{
  it('uses DB cutoff/source/current bank and preserves raw request for idempotency',async()=>{
    candidates();query.mockResolvedValueOnce([{id:bankId,version:2,bankCode:'FIXTURE',accountNumber:'12345678',accountName:'Synthetic'}]).mockResolvedValueOnce([{id:batchId}]);
    const dto={hostId,reason:'Synthetic'},raw={...dto,reason:' Synthetic '};
    const result=await service.create(actorId,dto,'same-key',raw);
    expect(result).toMatchObject({status:'DRAFT',amount:'200000',cutoff:'2026-10-05T02:00:00.000Z'});
    expect(run.mock.calls[0].slice(0,4)).toEqual([actorId,'ADMIN_PAYOUT_DRAFT','same-key',raw]);
    expect(JSON.stringify(result)).not.toContain('12345678');
  });
  it('canonicalizes UUID lock spellings but not the raw request hash input',async()=>{
    candidates([]);const dto={hostId:hostId.toUpperCase(),reason:'Synthetic'};
    await expect(service.create(actorId,dto,'same-key',dto)).rejects.toMatchObject({response:{errorCode:'PAYOUT_NO_ELIGIBLE_ITEMS'}});
    expect(execute.mock.calls[0]).toContain(`bank:${hostId}`);
    expect(run.mock.calls[0][3]).toBe(dto);
  });
  it('rejects unknown recipient before locks or item writes',async()=>{
    userFind.mockResolvedValueOnce(null);
    await expect(service.create(actorId,{hostId,reason:'Synthetic'},'same-key',{})).rejects.toMatchObject({status:404});
    expect(query).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
  });
  it('rejects outstanding or unsupported debt before selecting positive amounts',async()=>{
    candidates([],true);
    await expect(service.create(actorId,{hostId,reason:'Synthetic'},'same-key',{})).rejects.toMatchObject({response:{errorCode:'FINANCIAL_REVIEW_REQUIRED'}});
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each([
    {rows:[],code:'PAYOUT_NO_ELIGIBLE_ITEMS'},
    {rows:[{...row,amount:'0'}],code:'PAYOUT_NO_ELIGIBLE_ITEMS'},
    {rows:[{...row,amount:'199999'}],code:'PAYOUT_BELOW_THRESHOLD'},
    {rows:[{...row,amount:'-1'}],code:'FINANCIAL_REVIEW_REQUIRED'},
    {rows:[row,row],code:'FINANCIAL_REVIEW_REQUIRED'},
    {rows:[{...row,amount:'1000000000000000000'}],code:'PAYOUT_AMOUNT_TOO_LARGE'},
  ])('fails $code without persisting batch/audit/items',async({rows,code})=>{
    candidates(rows);
    await expect(service.create(actorId,{hostId,reason:'Synthetic'},'same-key',{})).rejects.toMatchObject({response:{errorCode:code}});
    expect(query).toHaveBeenCalledTimes(4);expect(execute).toHaveBeenCalledTimes(1);
  });
  it('allows the old sub-threshold exception in plan, still uses DB guards when persisting',async()=>{
    candidates([{...row,amount:'1',eligibleAt:new Date('2026-08-01T02:00:00Z')}]);
    query.mockResolvedValueOnce([{id:bankId,version:2,bankCode:'FIXTURE',accountNumber:'12345678',accountName:'Synthetic'}]).mockResolvedValueOnce([{id:batchId}]);
    expect(await service.create(actorId,{hostId,reason:'Synthetic'},'same-key',{})).toMatchObject({amount:'1',status:'DRAFT'});
  });
  it('hides SQL diagnostics that can include private bank data',async()=>{
    userFind.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Synthetic private SQL',{code:'P2002',clientVersion:'test'}));
    await expect(service.create(actorId,{hostId,reason:'Synthetic'},'same-key',{})).rejects.toMatchObject({status:503,response:{errorCode:'PAYOUT_RECORDING_FAILED'}});
  });
  it('locks the same Host before cancellation and scopes raw hash by target',async()=>{
    batchFind.mockResolvedValueOnce({hostId});query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{status:'DRAFT',version:1}]).mockResolvedValueOnce([]);
    const dto={expectedVersion:1,reason:'Synthetic'};
    expect(await service.cancel(actorId,batchId,dto,'same-key',dto)).toEqual({id:batchId,status:'CANCELLED',version:2});
    expect(run.mock.calls[0].slice(0,4)).toEqual([actorId,'ADMIN_PAYOUT_CANCEL','same-key',{id:batchId,body:dto}]);
    expect(execute.mock.calls[0]).toContain(`bank:${hostId}`);
  });
  it('does not write for a missing cancellation target',async()=>{
    batchFind.mockResolvedValueOnce(null);
    await expect(service.cancel(actorId,batchId,{expectedVersion:1,reason:'Synthetic'},'same-key',{})).rejects.toMatchObject({status:404});
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['cancel','approve'] as const)('%s canonicalizes the route UUID without transforming the raw body',async action=>{
    batchFind.mockResolvedValueOnce(null);
    const dto={expectedVersion:1,reason:'Synthetic'},raw={...dto,reason:' Synthetic '};
    await expect(service[action](actorId,batchId.toUpperCase(),dto,'same-key',raw)).rejects.toMatchObject({status:404});
    expect(run.mock.calls[0][3]).toEqual({id:batchId,body:raw});
    expect((run.mock.calls[0][3] as {body:unknown}).body).toBe(raw);
  });
  it('approval locks bank, units, bookings then batch and preserves raw idempotency scope',async()=>{
    batchFind.mockResolvedValueOnce({hostId});
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{status:'DRAFT',version:1}]).mockResolvedValueOnce([{ready:true}]);
    const dto={expectedVersion:1,reason:'Synthetic approval'};
    expect(await service.approve(actorId,batchId,dto,'approve-key',dto)).toEqual({id:batchId,status:'APPROVED',version:2});
    expect(run.mock.calls[0].slice(0,4)).toEqual([actorId,'ADMIN_PAYOUT_APPROVE','approve-key',{id:batchId,body:dto}]);
    expect(execute.mock.calls[0]).toContain(`bank:${hostId}`);
    expect(query.mock.calls[0][0].join('')).toContain('FOR UPDATE OF u');
    expect(query.mock.calls[1][0].join('')).toContain('FOR UPDATE OF b');
    expect(query.mock.calls[2][0].join('')).toContain('FOR UPDATE');
  });
  it('approval missing batch returns 404 without locks/audit',async()=>{
    batchFind.mockResolvedValueOnce(null);
    await expect(service.approve(actorId,batchId,{expectedVersion:1,reason:'Synthetic'},'approve-key',{})).rejects.toMatchObject({status:404});
    expect(execute).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
  });
  it('masks bank lists, keeps page meta outside data, and scopes Host reads',async()=>{
    batchMany.mockResolvedValueOnce([{id:batchId,hostId,amount:new Prisma.Decimal('9007199254740993'),accountNumber:'12345678',cutoff:row.eligibleAt,createdAt:row.eligibleAt}]);
    batchCount.mockResolvedValueOnce(1);
    const result=await service.list(hostId,1,20);
    expect(result.data[0]).toMatchObject({amount:'9007199254740993',accountNumber:'****5678'});
    expect(result.meta).toMatchObject({page:1,limit:20,total:1});
    expect(batchMany.mock.calls[0][0].where).toEqual({hostId});
  });
  it('returns full private snapshot to Admin but strips bank name and audit actor/reason from Host',async()=>{
    const data={id:batchId,hostId,amount:new Prisma.Decimal('200000'),status:'CANCELLED',version:2,cutoff:row.eligibleAt,createdAt:row.eligibleAt,
      bankCode:'FIXTURE',accountNumber:'12345678',accountName:'Synthetic',bankAccountId:bankId,bankVersion:2,items:[],events:[{action:'CREATED',createdAt:row.eligibleAt,actorId,reason:'Private synthetic evidence'}],
      confirmation:{createdAt:row.eligibleAt,actorId,bankReference:'FIXTURE-reference',evidenceNote:'Private proof',reason:'Private reason'}};
    batchDetail.mockResolvedValue(data);
    const own=await service.read(batchId,hostId),admin=await service.read(batchId,null);
    expect(own.accountNumber).toBe('****5678');expect(own).not.toHaveProperty('accountName');expect(own.events[0]).not.toHaveProperty('reason');
    expect(admin.accountNumber).toBe('12345678');expect(admin.events[0]).toHaveProperty('actorId',actorId);
    expect(own.confirmation).toEqual({confirmedAt:row.eligibleAt.toISOString()});
    expect(own).not.toHaveProperty('operations');
    expect(admin.operations).toEqual({canApprove:false,canExport:false,canConfirmPaid:false,canCancel:false,reviewRequired:false});
    expect(admin.confirmation).toMatchObject({bankReference:'FIXTURE-reference',evidenceNote:'Private proof',actorId});
    expect(batchDetail.mock.calls[0][0].where).toEqual({id:batchId,hostId});
  });
  it('rejects an unreadable/missing batch with 404',async()=>{
    batchDetail.mockResolvedValueOnce(null);await expect(service.read(batchId,hostId)).rejects.toMatchObject({status:404});
  });
  it.each([
    {status:'DRAFT',ready:true,approve:true,export:false,confirm:false,cancel:true,review:false},
    {status:'APPROVED',ready:true,approve:false,export:true,confirm:true,cancel:true,review:false},
    {status:'DRAFT',ready:false,approve:false,export:false,confirm:false,cancel:true,review:true},
    {status:'APPROVED',ready:false,approve:false,export:false,confirm:false,cancel:true,review:true},
    {status:'PAID',ready:false,approve:false,export:false,confirm:false,cancel:false,review:false},
    {status:'CANCELLED',ready:false,approve:false,export:false,confirm:false,cancel:false,review:false},
  ])('Admin detail observes $status ready=$ready without changing the batch',async state=>{
    batchDetail.mockResolvedValueOnce({id:batchId,hostId,amount:new Prisma.Decimal('200000'),status:state.status,version:2,
      cutoff:row.eligibleAt,createdAt:row.eligibleAt,items:[],events:[],confirmation:null});
    query.mockResolvedValueOnce([{ready:state.ready}]);
    const result=await service.read(batchId,null);
    expect(result.operations).toEqual({canApprove:state.approve,canExport:state.export,canConfirmPaid:state.confirm,canCancel:state.cancel,reviewRequired:state.review});
    expect(query).toHaveBeenCalledTimes(['DRAFT','APPROVED'].includes(state.status)?1:0);
    expect(execute).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();
    expect(transaction.mock.calls[0][1]).toEqual({isolationLevel:'RepeatableRead'});
  });
  it('readiness never enables a version-incrementing write when the version is exhausted',async()=>{
    batchDetail.mockResolvedValueOnce({id:batchId,hostId,amount:new Prisma.Decimal('200000'),status:'APPROVED',version:2147483647,
      cutoff:row.eligibleAt,createdAt:row.eligibleAt,items:[],events:[],confirmation:null});
    query.mockResolvedValueOnce([{ready:true}]);
    expect((await service.read(batchId,null)).operations).toEqual({canApprove:false,canExport:true,canConfirmPaid:false,canCancel:false,reviewRequired:false});
  });
  it('exports an approved current snapshot read-only with locks and without a transfer/audit write',async()=>{
    query.mockResolvedValueOnce([{role:'ADMIN',status:'ACTIVE'}]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ready:true}]);
    batchFind.mockResolvedValueOnce({hostId});
    batchThrow.mockResolvedValueOnce({id:batchId,hostId,status:'APPROVED',version:2,cutoff:row.eligibleAt,
      bankCode:'FIXTURE',accountNumber:'001234',accountName:'=Synthetic',amount:new Prisma.Decimal('200000'),items:[{bookingId:bankId}]});
    const result=await service.exportCsv(actorId,batchId);
    expect(result).toMatchObject({encoding:'UTF-8',filename:`payout-${batchId}-v2.csv`});
    expect(result.csv).toContain('"\'001234"');expect(result.csv).toContain('"\'=Synthetic"');
    expect(execute).toHaveBeenCalledTimes(1); // advisory lock only, no journal/audit/status write
    expect(query.mock.calls[0][0].join('')).toContain('FOR SHARE');
    expect(query.mock.calls[3][0].join('')).toContain('FOR UPDATE');
  });
  it.each([{role:'HOST',status:'ACTIVE'},{role:'ADMIN',status:'BANNED'}])('denies export for $role/$status inside transaction',async actor=>{
    query.mockResolvedValueOnce([actor]);
    await expect(service.exportCsv(actorId,batchId)).rejects.toMatchObject({status:403});
    expect(execute).not.toHaveBeenCalled();
  });
  it('export hides private SQL diagnostics and does not ask for an idempotency key on a GET',async()=>{
    query.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Synthetic private SQL',{code:'P2002',clientVersion:'test'}));
    await expect(service.exportCsv(actorId,batchId)).rejects.toMatchObject({status:503,response:{errorCode:'PAYOUT_EXPORT_FAILED',message:'Chưa thể xuất lô. Vui lòng thử lại.'}});
  });
  it('confirmation preserves raw idempotency body and masks private failures without suggesting another transfer',async()=>{
    query.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Private fixture SQL',{code:'P2002',clientVersion:'test'}));
    const dto={expectedVersion:2,bankReference:'FIXTURE',evidenceNote:'Synthetic',reason:'Synthetic'},raw={...dto,reason:' Synthetic '};
    await expect(service.confirmPaid(actorId,batchId.toUpperCase(),dto,'same-key',raw)).rejects.toMatchObject({status:503,response:{errorCode:'PAYOUT_RECORDING_FAILED',message:expect.stringContaining('không chuyển tiền ngân hàng lần nữa')}});
    expect(run.mock.calls[0].slice(0,4)).toEqual([actorId,'ADMIN_PAYOUT_PAID','same-key',{id:batchId,body:raw}]);
  });
});
