import {beforeEach,expect,it,vi} from "vitest";
import {managementRequest} from "@/lib/api/client";
import {adminPayoutsApi} from "@/lib/api/payouts";
import {payoutFieldErrors} from "@/features/admin-finance/payout-form";
vi.mock("@/lib/api/client",()=>({managementRequest:vi.fn()}));
const id="00000000-0000-4000-8000-000000000001",body={expectedVersion:2,reason:"Fixture",bankReference:"FIXTURE",evidenceNote:"Synthetic only"};
beforeEach(()=>vi.clearAllMocks());
it.each([{id:"wrong"},{status:"APPROVED"},{version:2},{version:4},{version:2147483648},{amount:100},{amount:"0"},{amount:"1.5"},{message:""}])("rejects invalid manual paid result %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:{id,status:"PAID",version:3,amount:"100",message:"Manual evidence",...patch}});
  await expect(adminPayoutsApi.confirmPaid(id,body,"stable")).rejects.toMatchObject({errorCode:"INVALID_PAYOUT_RESPONSE"});
  expect(managementRequest).toHaveBeenCalledTimes(1);
});
it.each(["approve","cancel"] as const)("rejects mismatched %s outcome",async action=>{
  vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:{id,status:"PAID",version:3}});
  await expect(adminPayoutsApi[action](id,body,"stable")).rejects.toMatchObject({errorCode:"INVALID_PAYOUT_RESPONSE"});
});
it.each([{hostId:"wrong"},{amount:"0"},{version:2},{status:"PAID"},{cutoff:"bad"}])("rejects invalid draft %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:{id,hostId:id,status:"DRAFT",version:1,amount:"100",cutoff:"2026-10-06T00:00:00.000Z",...patch}});
  await expect(adminPayoutsApi.create({hostId:id,reason:"Fixture"},"stable")).rejects.toMatchObject({errorCode:"INVALID_PAYOUT_RESPONSE"});
});
it.each([{filename:"../../payout.csv"},{filename:`payout-00000000-0000-4000-8000-000000000002-v2.csv`},{encoding:"UTF-16"},{csv:"bad"}])("rejects unsafe/mismatched export %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue({success:true,message:"OK",data:{filename:`payout-${id}-v2.csv`,encoding:"UTF-8",csv:'\ufeff"payout_id","host_id",\r\n',...patch}});
  await expect(adminPayoutsApi.exportCsv(id)).rejects.toMatchObject({errorCode:"INVALID_PAYOUT_RESPONSE"});
});
it("validates evidence only for manual confirmation, and Host UUID only for creation",()=>{
  const fields={hostId:"",reason:"Fixture",bankReference:"",evidenceNote:""};
  expect(payoutFieldErrors(fields,"approve")).toEqual({});expect(payoutFieldErrors(fields,"cancel")).toEqual({});
  expect(Object.keys(payoutFieldErrors(fields,"confirmPaid"))).toEqual(["bankReference","evidenceNote"]);
  expect(Object.keys(payoutFieldErrors(fields,"create"))).toEqual(["hostId"]);
  expect(payoutFieldErrors({...fields,hostId:id},"create")).toEqual({});
});
it("evidence boundaries and whitespace fail before submission",()=>{
  const fields={hostId:id,reason:" ",bankReference:"x".repeat(201),evidenceNote:"x".repeat(501)};
  expect(Object.keys(payoutFieldErrors(fields,"confirmPaid"))).toEqual(["reason","bankReference","evidenceNote"]);
  expect(payoutFieldErrors({...fields,reason:"x".repeat(500),bankReference:"x".repeat(200),evidenceNote:"x".repeat(500)},"confirmPaid")).toEqual({});
});
