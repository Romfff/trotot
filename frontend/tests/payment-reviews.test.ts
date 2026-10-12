import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
import { GET,POST,PUT,DELETE } from "../src/app/api/management/[...path]/route";
import { managementRequest } from "@/lib/api/client";
import { paymentReviewsApi } from "@/lib/api/payment-reviews";
vi.mock("@/lib/api/client",()=>({managementRequest:vi.fn()}));
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const path=["admin","finance","payment-reviews"],origin="http://localhost:3000";
const row={id,sessionId:other,bookingId:other,bookingCode:"FIXTURE",provider:"VNPAY_SANDBOX",transactionNo:"1234",
  expectedAmount:"1100",receivedAmount:"1099",reasonCode:"AMOUNT_MISMATCH",sessionBookingVersion:1,bookingVersion:2,
  bookingStatus:"CANCELLED",paymentStatus:"PENDING",sessionExpiresAt:"2026-10-07T00:00:00.000Z",payDate:null,receivedAt:"2026-10-07T00:01:00.000Z"};
const envelope={success:true,message:"Fixture",data:[row],meta:{page:1,limit:20,total:1,totalPages:1}};
const context=(parts:string[])=>({params:Promise.resolve({path:parts})});
const request=(method="GET",authorization="Bearer fixture")=>new NextRequest(`${origin}/api/management/${path.join("/")}?page=1&limit=20`,{
  method,headers:{authorization,cookie:"private-refresh",origin,"content-type":"application/json"},...(method==="GET"?{}:{body:"{}"})});
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv("BACKEND_API_URL","http://backend.test/api/v1");vi.stubEnv("FRONTEND_ORIGIN",origin);
  vi.stubEnv("BFF_PROXY_SECRET","review-fixture-secret-32characters");vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","");
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("client preserves exact string money, server snapshots and caller abort signal",async()=>{
  const signal=new AbortController().signal;vi.mocked(managementRequest).mockResolvedValueOnce(envelope);
  expect(await paymentReviewsApi.list(1,signal)).toBe(envelope);
  expect(managementRequest).toHaveBeenCalledWith("/admin/finance/payment-reviews",{params:{page:1,limit:20},signal});
  vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:"Fixture",data:row});
  expect(await paymentReviewsApi.read(id,signal)).toBe(row);
  expect(managementRequest).toHaveBeenLastCalledWith(`/admin/finance/payment-reviews/${id}`,{signal});
});
it.each(["PENDING_HOST_APPROVAL","PENDING_PAYMENT","REJECTED_BY_HOST","CANCELLED_HOST_TIMEOUT","CANCELLED_TIMEOUT","CONFIRMED","CHECKED_IN","COMPLETED","CANCELLED","CANCELLED_BY_GUEST"])("accepts actual DB booking state %s without inferring resolution",async bookingStatus=>{
  const data={...row,bookingStatus};vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:"Fixture",data});
  expect(await paymentReviewsApi.read(id)).toBe(data);
});
it.each([null,{...envelope,success:false},{...envelope,data:[]},{...envelope,meta:{...envelope.meta,totalPages:2}},
  {...envelope,data:[row,row],meta:{...envelope.meta,total:2}},
  ...[{...row,expectedAmount:1100},{...row,receivedAmount:"1.5"},{...row,receivedAmount:"0"},
    {...row,expectedAmount:"10000000000"},{...row,payDate:"2026-02-30T00:00:00.000Z"},
    {...row,guestPhone:"private"},{...row,payloadHash:"private"},{...row,reasonCode:"RESOLVED"},
    {...row,bookingStatus:"PAID"},{...row,paymentStatus:"SUCCESS"},{...row,bookingVersion:0},
    {...row,sessionId:"bad"},{...row,provider:"VNPAY_PRODUCTION"},{...row,transactionNo:"01234"},
    {...row,receivedAt:"bad"}].map(value=>({...envelope,data:[value]})),
])("rejects malformed or private upstream response %j",async value=>{
  vi.mocked(managementRequest).mockResolvedValueOnce(value);
  await expect(paymentReviewsApi.list(1)).rejects.toMatchObject({status:502,errorCode:"INVALID_PAYMENT_REVIEW_RESPONSE"});
});
it("rejects mismatched detail ID, supports empty pages and nullable provider payDate",async()=>{
  vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:"Fixture",data:{...row,id:other}});
  await expect(paymentReviewsApi.read(id)).rejects.toMatchObject({status:502});
  const empty={...envelope,data:[],meta:{page:2,limit:20,total:1,totalPages:1}};vi.mocked(managementRequest).mockResolvedValueOnce(empty);
  expect(await paymentReviewsApi.list(2)).toBe(empty);
});
it("invalid caller input never sends a request",async()=>{
  for(const page of [0,1.5,1000001,NaN])await expect(paymentReviewsApi.list(page)).rejects.toMatchObject({status:502});
  await expect(paymentReviewsApi.read("../refunds")).rejects.toMatchObject({status:502});expect(managementRequest).not.toHaveBeenCalled();
});
it.each([403,404,429,503,"abort"])("keeps client error %s without retry or a fabricated review",async status=>{
  const error={status};vi.mocked(managementRequest).mockRejectedValueOnce(error);
  await expect(paymentReviewsApi.list(1)).rejects.toBe(error);expect(managementRequest).toHaveBeenCalledTimes(1);
});
it.each([path,[...path,id]].map(parts=>({parts})))("BFF GET $parts signs private request without forwarding cookie",async ({parts})=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope)));vi.stubGlobal("fetch",fetcher);
  const response=await GET(request(),context(parts));expect(await response.json()).toEqual(envelope);
  expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("vary")).toBe("Origin, Authorization");
  const [url,init]=fetcher.mock.calls[0];expect(url).toBe(`http://backend.test/api/v1/${parts.join("/")}?page=1&limit=20`);
  const headers=new Headers(init.headers);expect(headers.get("cookie")).toBeNull();expect(headers.get("authorization")).toBe("Bearer fixture");
  expect(headers.get("x-trotot-proxy-signature")).toMatch(/^[a-f0-9]{64}$/);expect(init.cache).toBe("no-store");expect(init.redirect).toBe("error");
});
it.each([{handler:POST,method:"POST",parts:path},{handler:PUT,method:"PUT",parts:[...path,id]},
  {handler:DELETE,method:"DELETE",parts:[...path,id]},{handler:POST,method:"POST",parts:[...path,id,"resolve"]},
  {handler:GET,method:"GET",parts:[...path,"bad"]},{handler:GET,method:"GET",parts:[...path,id,"confirm-paid"]},
  {handler:GET,method:"GET",parts:["host","finance","payment-reviews"]},
])("BFF denies unapproved $method $parts before fetch",async({handler,method,parts})=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  expect((await handler(request(method),context(parts))).status).toBe(404);expect(fetcher).not.toHaveBeenCalled();
});
it("BFF requires bearer and fails closed when backend is unavailable",async()=>{
  const fetcher=vi.fn().mockRejectedValue(new Error("Fixture unavailable"));vi.stubGlobal("fetch",fetcher);
  expect((await GET(request("GET",""),context(path))).status).toBe(401);expect(fetcher).not.toHaveBeenCalled();
  expect((await GET(request(),context(path))).status).toBe(503);expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([400,403,404,429,503])("BFF preserves backend %s and Retry-After without retries",async status=>{
  const body={success:false,errorCode:"FIXTURE_ERROR",message:"Fixture"};
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(body),{status,headers:{"Retry-After":"60"}}));vi.stubGlobal("fetch",fetcher);
  const response=await GET(request(),context(path));expect(response.status).toBe(status);expect(await response.json()).toEqual(body);
  expect(response.headers.get("retry-after")).toBe(status===429?"60":null);expect(fetcher).toHaveBeenCalledTimes(1);
});
