import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { GET,POST,PUT,DELETE } from "../src/app/api/management/[...path]/route";
const origin="http://localhost:3000";
const id="00000000-0000-4000-8000-000000000001";
const context=(path:string[])=>({params:Promise.resolve({path})});
const queue=["admin","properties"];
const approve=[...queue,id,"approve"];
function request(method:"GET"|"POST",headers:Record<string,string>={},body:unknown={expectedVersion:2}){
 return new NextRequest(`${origin}/api/management/admin/properties?page=2&limit=10`,{
  method,headers:{authorization:"Bearer access",...(method==="POST"?{origin,"content-type":"application/json"}:{}),...headers},
  ...(method==="POST"?{body:JSON.stringify(body)}:{}),
 });
}
beforeEach(()=>{vi.stubEnv("FRONTEND_ORIGIN",origin);vi.stubEnv("BACKEND_API_URL","http://backend.test/api/v1/");vi.stubEnv("BFF_PROXY_SECRET","management-test-secret-0123456789abcdef");vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","");});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("existing Admin API private BFF",()=>{
 it.each([["host","users"],["admin","users",id],[...queue,".."],[...queue,"not-a-uuid"],[...queue,id,"approve"],["https:","evil.example"]])("rejects non-allowlisted read %j",async(...path)=>{
  const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
  expect((await GET(request("GET"),context(path))).status).toBe(404);expect(fetchMock).not.toHaveBeenCalled();
 });
 it("rejects missing bearer, cross-origin/form writes and forged body actor without upstream calls",async()=>{
  const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
  expect((await GET(request("GET",{authorization:""}),context(queue))).status).toBe(401);
  expect((await POST(request("POST",{origin:"https://evil.example"}),context(approve))).status).toBe(403);
  expect((await POST(request("POST",{"content-type":"text/plain"}),context(approve))).status).toBe(415);
  for(const body of [{expectedVersion:2,actorId:id},{expectedVersion:"2"},{expectedVersion:0},{},[],null])
   expect((await POST(request("POST",{},body),context(approve))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
 });
 it("forwards fixed path/version/bearer and signed context; ignores cookies and unsigned IP",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{id,status:"PUBLISHED",version:3}}),{status:200}));vi.stubGlobal("fetch",fetchMock);
  const result=await POST(request("POST",{cookie:"trotot_refresh=must-not-forward","x-forwarded-for":"203.0.113.4"}),context(approve));
  expect(result.status).toBe(200);expect(result.headers.get("cache-control")).toBe("no-store");expect(result.headers.get("set-cookie")).toBeNull();
  const [url,init]=fetchMock.mock.calls[0] as [string,RequestInit];const headers=new Headers(init.headers);
  expect(url).toBe(`http://backend.test/api/v1/admin/properties/${id}/approve`);expect(init.redirect).toBe("error");
  expect(init.body).toBe(JSON.stringify({expectedVersion:2}));expect(headers.get("authorization")).toBe("Bearer access");expect(headers.get("cookie")).toBeNull();
  expect(headers.get("x-trotot-client-ip")).toBe("");
  expect(headers.get("x-trotot-proxy-signature")).toBe(createHmac("sha256",process.env.BFF_PROXY_SECRET!).update(`${headers.get("x-trotot-proxy-timestamp")}\nPOST\n/api/v1/admin/properties/${id}/approve\n`).digest("hex"));
 });
 it("preserves pagination and authorization/stale/rate/backend errors without replay",async()=>{
  const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({success:true,data:[],meta:{page:2,total:0}}),{status:200}));
  const list=await GET(request("GET"),context(queue));expect((await list.json()).meta.page).toBe(2);
  expect(fetchMock.mock.calls[0][0]).toBe("http://backend.test/api/v1/admin/properties?page=2&limit=10");
  for(const status of [401,403,404,409,429,503]){
   fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({success:false,errorCode:"TEST_ERROR",message:"Test"}),{status}));
   expect((await POST(request("POST"),context(approve))).status).toBe(status);
  }
  expect(fetchMock).toHaveBeenCalledTimes(7);
 });
 it("fails closed on invalid edge context/config/envelope/network",async()=>{
  const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","x-real-ip");
  expect((await GET(request("GET",{"x-real-ip":"203.0.113.1, 1.2.3.4"}),context(queue))).status).toBe(503);expect(fetchMock).not.toHaveBeenCalled();
  vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","");vi.stubEnv("BFF_PROXY_SECRET","");
  expect((await GET(request("GET"),context(queue))).status).toBe(503);expect(fetchMock).not.toHaveBeenCalled();
  vi.stubEnv("BFF_PROXY_SECRET","management-test-secret-0123456789abcdef");
  for(const payload of [{},{success:false,data:[]},{success:true,data:[] }]){
   fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload),{status:payload.success===true?403:200}));
   expect((await GET(request("GET"),context(queue))).status).toBe(503);
  }
  fetchMock.mockRejectedValueOnce(new Error("network"));expect((await GET(request("GET"),context(queue))).status).toBe(503);
 });
});

describe("Sprint 2 Host private BFF",()=>{
 const own=["host","properties",id];
 const req=(method:string,body:unknown,originValue=origin)=>new NextRequest(`${origin}/api/management/host/properties`,{
  method,headers:{authorization:"Bearer access",origin:originValue,"content-type":"application/json",cookie:"private-refresh"},body:JSON.stringify(body),
 });
 it("allows own list/detail only and never forwards refresh cookies",async()=>{
  const fetchMock=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({success:true,data:[]}))));vi.stubGlobal("fetch",fetchMock);
  for(const path of [["host","properties"],own]) expect((await GET(request("GET"),context(path))).status).toBe(200);
  expect((await GET(request("GET"),context(["host","properties",".."]))).status).toBe(404);
  expect(new Headers(fetchMock.mock.calls[0][1].headers).get("cookie")).toBeNull();
 });
 it.each(["PUT","DELETE"])("requires Origin and version for %s without changing Auth/Cookie",async(method)=>{
  const handler=method==="PUT"?PUT:DELETE;const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{id}})));vi.stubGlobal("fetch",fetchMock);
  expect((await handler(req(method,{expectedVersion:2},"https://evil.test"),context(own))).status).toBe(403);
  expect((await handler(req(method,{expectedVersion:0}),context(own))).status).toBe(400);
  expect((await handler(req(method,{expectedVersion:2,hostId:id}),context(own))).status).toBe(400);
  const response=await handler(req(method,{expectedVersion:2}),context(own));expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url,init]=fetchMock.mock.calls[0];expect(url).toBe(`http://backend.test/api/v1/host/properties/${id}`);expect(init.method).toBe(method);
  const headers=new Headers(init.headers);expect(headers.get("cookie")).toBeNull();
  expect(headers.get("x-trotot-proxy-signature")).toBe(createHmac("sha256",process.env.BFF_PROXY_SECRET!).update(`${headers.get("x-trotot-proxy-timestamp")}\n${method}\n/api/v1/host/properties/${id}\n`).digest("hex"));
 });
 it("allows create fields but refuses client role/status/version and unauthorized methods",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{id}}),{status:201}));vi.stubGlobal("fetch",fetchMock);
  for(const extra of [{hostId:id},{status:"PUBLISHED"},{expectedVersion:1},{listingPlan:"PAID"}])
   expect((await POST(req("POST",{title:"Test",...extra}),context(["properties","long-term"]))).status).toBe(400);
  expect((await POST(req("POST",{title:"Test",imageUrls:[]}),context(["properties","long-term"]))).status).toBe(201);
  expect((await PUT(req("PUT",{expectedVersion:2}),context(approve))).status).toBe(404);
  expect((await DELETE(req("DELETE",{expectedVersion:2}),context(["bookings",id,"cancel"]))).status).toBe(404);
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it("only accepts boolean availability and preserves backend conflict/quota failures",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:false,errorCode:"STALE_LISTING_VERSION",message:"Reload"}),{status:409}));vi.stubGlobal("fetch",fetchMock);
  for(const body of [{expectedVersion:2},{expectedVersion:2,isAvailable:"false"},{expectedVersion:2,isAvailable:false,status:"PUBLISHED"}])
   expect((await POST(req("POST",body),context([...own,"availability"]))).status).toBe(400);
  expect((await POST(req("POST",{expectedVersion:2,isAvailable:false}),context([...own,"availability"]))).status).toBe(409);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({expectedVersion:2,isAvailable:false});
 });
});

describe("approved appointment/notification BFF",()=>{
 it("allows only fixed appointment paths and UUIDs, forwards create idempotency and no cookies",async()=>{
  const fetchMock=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({success:true,data:{id}}),{status:201})));vi.stubGlobal("fetch",fetchMock);
  const result=await POST(request("POST",{"idempotency-key":"appointment-fixture",cookie:"never-forward"},{propertyId:id,tenantName:"Fixture",tenantPhone:"0990000011",scheduledDate:"2026-10-20",scheduledTime:"15:30:00"}),context(["appointments"]));
  expect(result.status).toBe(201);const headers=new Headers(fetchMock.mock.calls[0][1].headers);
  expect(headers.get("idempotency-key")).toBe("appointment-fixture");expect(headers.get("cookie")).toBeNull();
  expect((await POST(request("POST",{},{expectedStatus:"PENDING",tenantId:id}),context(["appointments",id,"cancel"]))).status).toBe(400);
  expect((await POST(request("POST",{},{expectedStatus:"PENDING"}),context(["appointments","../evil","cancel"]))).status).toBe(404);
  expect((await GET(request("GET"),context(["host","appointments",id]))).status).toBe(201);
  expect((await PUT(new NextRequest(origin,{method:"PUT"}),context(["appointments",id]))).status).toBe(404);
 });
 it("requires action state/Origin and preserves stale status and Retry-After",async()=>{
  const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
  for(const body of [{},{expectedStatus:"NEW"},{expectedStatus:"PENDING",reason:"x".repeat(501)}])
   expect((await POST(request("POST",{},body),context(["host","appointments",id,"reject"]))).status).toBe(400);
  expect((await POST(request("POST",{origin:"https://evil.test"},{expectedStatus:"PENDING"}),context(["host","appointments",id,"accept"]))).status).toBe(403);
  const stale={success:false,errorCode:"STALE_APPOINTMENT_STATUS",data:{currentStatus:"ACCEPTED"}};
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(stale),{status:409}));
  expect(await (await POST(request("POST",{},{expectedStatus:"PENDING"}),context(["appointments",id,"cancel"]))).json()).toEqual(stale);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({success:false,errorCode:"RATE_LIMITED"}),{status:429,headers:{"retry-after":"60"}}));
  expect((await GET(request("GET"),context(["appointments"]))).headers.get("retry-after")).toBe("60");
 });
 it("allows own notification list/read with an empty body only",async()=>{
  const fetchMock=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({success:true,data:[],meta:{unreadCount:1}}))));vi.stubGlobal("fetch",fetchMock);
  expect((await GET(request("GET"),context(["notifications"]))).status).toBe(200);
  expect((await POST(request("POST",{},{recipientId:id}),context(["notifications",id,"read"]))).status).toBe(400);
  expect((await POST(request("POST",{},{}),context(["notifications",id,"read"]))).status).toBe(200);
  expect((await GET(request("GET"),context(["notifications",id]))).status).toBe(404);
  expect((await POST(request("POST",{},{}),context(["notifications",id,"delete"]))).status).toBe(404);
 });
});

describe("Sprint 3 booking BFF",()=>{
 it("forwards only allowed hold fields and idempotency key; never forwards refresh cookies",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{bookingId:id,payment:null}}),{status:201}));vi.stubGlobal("fetch",fetchMock);
  const body={unitId:id,checkInDate:"2026-10-22",checkOutDate:"2026-10-24",numAdults:1,numChildren:0,guestName:"Synthetic guest",guestPhone:"0990000000",quoteToken:"signed-fixture"};
  const response=await POST(request("POST",{"idempotency-key":"retry-fixture",cookie:"secret-refresh"},body),context(["bookings","hold"]));
  expect(response.status).toBe(201);const headers=new Headers(fetchMock.mock.calls[0][1].headers);
  expect(headers.get("idempotency-key")).toBe("retry-fixture");expect(headers.get("cookie")).toBeNull();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
  expect((await POST(request("POST",{}, {...body,totalAmount:1}),context(["bookings","hold"]))).status).toBe(400);
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it.each(["accept","reject","check-in","complete"])("allows fixed Host action %s but refuses custom status or traversal",async(action)=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{}})));vi.stubGlobal("fetch",fetchMock);
  const path=["host","bookings",id,action];expect((await POST(request("POST",{"idempotency-key":"action-fixture"}),context(path))).status).toBe(200);
  expect(fetchMock.mock.calls[0][0]).toBe(`http://backend.test/api/v1/host/bookings/${id}/${action}`);
  expect((await POST(request("POST",{},{expectedVersion:2,bookingStatus:"CONFIRMED"}),context(path))).status).toBe(400);
  expect((await POST(request("POST"),context(["host","bookings",id,"paid"]))).status).toBe(404);
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it("keeps signed repricing errors for explicit guest confirmation",async()=>{
  const body={success:false,errorCode:"PRICE_CHANGED",message:"New quote",data:{quoteToken:"new-signed-quote",priceBreakdown:{totalAmount:10}}};
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(body),{status:409})));
  const response=await POST(request("POST",{},{}),context(["bookings","hold"]));expect(response.status).toBe(409);expect(await response.json()).toEqual(body);
 });
});
