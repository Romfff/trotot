import { beforeEach, describe, expect, it, vi } from "vitest";
import { managementRequest } from "@/lib/api/client";
import { adminPayoutsApi, hostPayoutsApi } from "@/lib/api/payouts";
vi.mock("@/lib/api/client",()=>({managementRequest:vi.fn()}));
beforeEach(()=>vi.clearAllMocks());
const id="00000000-0000-4000-8000-000000000001";
describe("payout typed client",()=>{
  it.each([hostPayoutsApi,adminPayoutsApi].flatMap(api=>["DRAFT","APPROVED","CANCELLED","PAID"].map(status=>({api,status}))))("rejects array status instead of coercing it to $status",async({api,status})=>{
    const at="2026-10-06T00:00:00.000Z";
    const data={id,hostId:id,amount:"100",status:[status],version:1,cutoff:at,createdAt:at,bankCode:"FIXTURE",accountNumber:"****1234"};
    vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:"OK",data:[data],meta:{page:1,limit:20,total:1,totalPages:1}});
    await expect(api.list(1)).rejects.toMatchObject({errorCode:"INVALID_PAYOUT_RESPONSE"});
  });
  it.each([{api:hostPayoutsApi,path:"/host/payouts"},{api:adminPayoutsApi,path:"/admin/finance/payouts"}])("preserves list meta and abort $path",async({api,path})=>{
    const signal=new AbortController().signal, envelope={success:true,message:"OK",data:[],meta:{page:2,limit:20,total:0,totalPages:0}};
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope);
    expect(await api.list(2,signal)).toBe(envelope);expect(managementRequest).toHaveBeenCalledWith(path,{params:{page:2,limit:20},signal});
  });
  it.each([{api:adminPayoutsApi,path:"/admin/finance/payouts"}])("reads exact money without recomputing status $path",async({api,path})=>{
    const signal=new AbortController().signal,id="00000000-0000-4000-8000-000000000001",at="2026-10-06T00:00:00.000Z";
    const data={id,hostId:id,amount:"999999999999999999",status:"APPROVED",version:2,cutoff:at,createdAt:at,bankCode:"FIXTURE",accountNumber:"0012AB",accountName:"Synthetic",bankAccountId:id,bankVersion:1,
      operations:{canApprove:false,canExport:true,canConfirmPaid:true,canCancel:true,reviewRequired:false},items:[{bookingId:id,amount:"999999999999999999",eligibleAt:at,status:"ACTIVE"}],events:[{action:"CREATED",createdAt:at,actorId:id,reason:"Fixture"},{action:"APPROVED",createdAt:at,actorId:id,reason:"Fixture"}],confirmation:null};
    vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:"OK",data});
    expect(await api.detail(id,signal)).toBe(data);expect(managementRequest).toHaveBeenCalledWith(`${path}/${id}`,{signal});
  });
  it("forwards creation reason unchanged and uses caller retry key",async()=>{
    const input={hostId:id,reason:" Review "},data={id,hostId:id,amount:"100",cutoff:"2026-10-06T00:00:00.000Z",status:"DRAFT",version:1};
    vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data});
    expect(await adminPayoutsApi.create(input,"same-key")).toBe(data);
    expect(managementRequest).toHaveBeenCalledWith("/admin/finance/payouts",{method:"POST",data:input,headers:{"Idempotency-Key":"same-key"}});
  });
  it.each(["approve","cancel"] as const)("forwards %s version and stable retry payload",async action=>{
    const input={expectedVersion:2,reason:" Review "},data={id,status:action==="approve"?"APPROVED":"CANCELLED",version:3};
    vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data});
    expect(await adminPayoutsApi[action](id,input,"same-key")).toBe(data);
    expect(managementRequest).toHaveBeenCalledWith(`/admin/finance/payouts/${id}/${action}`,{method:"POST",data:input,headers:{"Idempotency-Key":"same-key"}});
  });
  it("preserves server CSV literal, filename and abort",async()=>{
    const signal=new AbortController().signal,data={filename:`payout-${id}-v2.csv`,encoding:"UTF-8",csv:'\uFEFF"payout_id","host_id","account","amount"\r\n"\'00123","100"\r\n'};
    vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:"OK",data});
    expect(await adminPayoutsApi.exportCsv(id,signal)).toBe(data);expect(managementRequest).toHaveBeenCalledWith(`/admin/finance/payouts/${id}/export`,{signal});
  });
  it("confirmation forwards unchanged evidence and the same caller key without rounding money or manufacturing PAID",async()=>{
    const input={expectedVersion:2,bankReference:" FIXTURE ",evidenceNote:" Synthetic only ",reason:" Review "};
    const result={id,status:"PAID",version:3,amount:"999999999999999999",message:"Admin evidence only"};
    vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:result});
    expect(await adminPayoutsApi.confirmPaid(id,input,"same-key")).toBe(result);
    await adminPayoutsApi.confirmPaid(id,input,"same-key");
    for(const call of vi.mocked(managementRequest).mock.calls) expect(call).toEqual([`/admin/finance/payouts/${id}/confirm-paid`,{method:"POST",data:input,headers:{"Idempotency-Key":"same-key"}}]);
  });
  it("confirmation failures remain failures and never change the key or automatically retry",async()=>{
    const error={status:503,errorCode:"PAYOUT_RECORDING_FAILED",message:"Do not transfer again"};
    vi.mocked(managementRequest).mockRejectedValueOnce(error);
    await expect(adminPayoutsApi.confirmPaid("id",{expectedVersion:2,bankReference:"FIXTURE",evidenceNote:"Synthetic",reason:"Review"},"same-key")).rejects.toBe(error);
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it.each([{status:409,errorCode:"STALE_PAYOUT_VERSION"},{status:503,errorCode:"PAYOUT_RECORDING_FAILED"},new DOMException("Aborted","AbortError")])("does not retry or fabricate success %j",async error=>{
    vi.mocked(managementRequest).mockRejectedValueOnce(error);
    await expect(adminPayoutsApi.approve("id",{expectedVersion:1,reason:"Fixture"},"key")).rejects.toBe(error);
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
});
