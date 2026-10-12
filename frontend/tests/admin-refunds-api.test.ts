import {beforeEach,expect,it,vi} from "vitest";
import {managementRequest} from "@/lib/api/client";
import {adminRefundsApi} from "@/lib/api/admin-refunds";
vi.mock("@/lib/api/client",()=>({managementRequest:vi.fn()}));
const id="00000000-0000-4000-8000-000000000001",at="2026-10-06T00:00:00.000Z",amount="999999999999999999";
const row={id,bookingId:id,amount,status:"PENDING",version:1,createdAt:at};
const detail={...row,cancelledBy:"GUEST",reason:"Fixture",updatedAt:at,confirmation:null};
const body={expectedVersion:1,reason:" Fixture ",bankReference:" FIXTURE ",evidenceNote:" Synthetic only "};
beforeEach(()=>vi.clearAllMocks());
it("reads exact amounts and forwards AbortSignal on list/detail",async()=>{
  const signal=new AbortController().signal,envelope={success:true,message:"OK",data:[row],meta:{page:1,limit:20,total:1,totalPages:1}};
  vi.mocked(managementRequest).mockResolvedValueOnce(envelope).mockResolvedValueOnce({success:true,message:"OK",data:detail});
  expect(await adminRefundsApi.list(1,signal)).toBe(envelope);expect(await adminRefundsApi.detail(id,signal)).toBe(detail);
  expect(managementRequest).toHaveBeenNthCalledWith(1,"/admin/finance/refunds",{params:{page:1,limit:20},signal});
  expect(managementRequest).toHaveBeenNthCalledWith(2,`/admin/finance/refunds/${id}`,{signal});
});
it.each([{amount:10},{amount:"0"},{amount:"1.5"},{id:"bad"},{bookingId:"bad"},{version:0},{status:"APPROVED"},{createdAt:"bad"},{cancelledBy:"SYSTEM"},{updatedAt:"bad"},{status:"PAID"},{confirmation:{}}])("rejects invalid detail %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:{...detail,...patch}});
  await expect(adminRefundsApi.detail(id)).rejects.toMatchObject({errorCode:"INVALID_REFUND_RESPONSE"});
});
it("reads Admin complaint refund as pending, not as proof of bank return",async()=>{
  vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:{...detail,cancelledBy:"ADMIN"}});
  expect(await adminRefundsApi.detail(id)).toMatchObject({cancelledBy:"ADMIN",status:"PENDING",confirmation:null});
});
it.each([{page:2},{limit:50},{total:-1},{totalPages:2}])("rejects invalid list metadata %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:[row],meta:{page:1,limit:20,total:1,totalPages:1,...patch}});
  await expect(adminRefundsApi.list(1)).rejects.toMatchObject({errorCode:"INVALID_REFUND_RESPONSE"});
});
it("preserves valid manual paid proof, payload/key and exact money",async()=>{
  const result={id,bookingId:id,amount,status:"PAID",version:2,journalId:id,message:"Manual only"};
  vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:result});
  expect(await adminRefundsApi.confirm(id,body,"same-key")).toBe(result);await adminRefundsApi.confirm(id,body,"same-key");
  for(const call of vi.mocked(managementRequest).mock.calls)expect(call).toEqual([`/admin/finance/refunds/${id}/confirm-paid`,{method:"POST",data:body,headers:{"Idempotency-Key":"same-key"}}]);
});
it.each([{id:"wrong"},{status:"PENDING"},{version:1},{version:3},{journalId:"bad"},{amount:100},{message:""}])("does not manufacture success from malformed mutation %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:{id,bookingId:id,amount,status:"PAID",version:2,journalId:id,message:"Manual",...patch}});
  await expect(adminRefundsApi.confirm(id,body,"same-key")).rejects.toMatchObject({errorCode:"INVALID_REFUND_RESPONSE"});expect(managementRequest).toHaveBeenCalledTimes(1);
});
it("validates paid evidence and refuses missing journal proof",async()=>{
  const confirmation={id,journalId:id,actorId:id,createdAt:at,reason:"Fixture",bankReference:"FIXTURE",evidenceNote:"Synthetic only"};
  const data={...detail,status:"PAID",version:2,confirmation};
  vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:"OK",data}).mockResolvedValueOnce({success:true,message:"OK",data:{...data,confirmation:{...confirmation,journalId:"bad"}}});
  expect(await adminRefundsApi.detail(id)).toBe(data);await expect(adminRefundsApi.detail(id)).rejects.toMatchObject({errorCode:"INVALID_REFUND_RESPONSE"});
});
