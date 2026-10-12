import {beforeEach,expect,it,vi} from 'vitest';
import {managementRequest} from '@/lib/api/client';
import {debtSettlementsApi} from '@/lib/api/debt-settlements';
vi.mock('@/lib/api/client',()=>({managementRequest:vi.fn()}));
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',date='2026-10-05T02:00:00.000Z';
const result={id,hostId:id,cutoff:date,grossEligible:'100',debtOffset:'100',netPayout:'0',batchId:null};
beforeEach(()=>vi.clearAllMocks());
it('accepts offset-only result, exact key and no client transfer',async()=>{
 vi.mocked(managementRequest).mockResolvedValue({success:true,message:'OK',data:result});
 expect(await debtSettlementsApi.create({hostId:id,reason:'Fixture'},'same')).toEqual(result);
 expect(managementRequest).toHaveBeenCalledWith('/admin/finance/settlements',expect.objectContaining({headers:{'Idempotency-Key':'same'}}));
});
it.each([{hostId:other},{grossEligible:'101'},{netPayout:'1'},{batchId:id},{debtOffset:'1.5'},{cutoff:'invalid'},{id:'bad'}])('rejects untrusted monetary outcome %j',async patch=>{
 vi.mocked(managementRequest).mockResolvedValue({success:true,message:'OK',data:{...result,...patch}});
 await expect(debtSettlementsApi.create({hostId:id,reason:'Fixture'},'same')).rejects.toMatchObject({errorCode:'INVALID_SETTLEMENT_RESPONSE'});
});
it('keeps Host debt separate from settlement/payout and validates remaining cap',async()=>{
 const row={id,bookingId:id,amount:'100',remainingAmount:'101',createdAt:date};
 vi.mocked(managementRequest).mockResolvedValue({success:true,message:'OK',data:[row],meta:{page:1,limit:20,total:1,totalPages:1}});
 await expect(debtSettlementsApi.debts(1)).rejects.toMatchObject({errorCode:'INVALID_SETTLEMENT_RESPONSE'});
});
it.each(['OFFSET','ALLOCATED','REVERSED'])('renders trusted settlement status %s without inferring paid',async status=>{
 const row={...result,status,createdAt:date};
 vi.mocked(managementRequest).mockResolvedValue({success:true,message:'OK',data:[row],meta:{page:1,limit:20,total:1,totalPages:1}});
 expect((await debtSettlementsApi.settlements(1)).data[0].status).toBe(status);
});
it('reversal keeps same key and rejects mismatched target',async()=>{
 vi.mocked(managementRequest).mockResolvedValue({success:true,message:'OK',data:{id:other,status:'REVERSED',reversedOffsets:1}});
 await expect(debtSettlementsApi.reverse(id,'Fixture','same')).rejects.toMatchObject({errorCode:'INVALID_SETTLEMENT_RESPONSE'});
});
