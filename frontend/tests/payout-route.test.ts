import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT, DELETE } from "../src/app/api/management/[...path]/route";

const origin = "http://localhost:3000", id = "00000000-0000-4000-8000-000000000001";
const admin = ["admin", "finance", "payouts"], action = [...admin, id, "approve"];
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const input = { expectedVersion: 1, reason: " Review fixture " };
const proof={expectedVersion:2,bankReference:" FIXTURE ",evidenceNote:" Synthetic only ",reason:" Review "},confirm=[...admin,id,"confirm-paid"];
function request(method: string, body: unknown = input, headers: Record<string,string> = {}) {
  return new NextRequest(`${origin}/api/management/admin/finance/payouts?page=2&limit=20`, {
    method, headers: { origin, authorization: "Bearer fixture", "content-type": "application/json", "idempotency-key": "same-key", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.stubEnv("FRONTEND_ORIGIN", origin); vi.stubEnv("BACKEND_API_URL", "http://backend.test/api/v1");
  vi.stubEnv("BFF_PROXY_SECRET", "payout-fixture-secret-0123456789abcdef"); vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("private payout transport", () => {
  it.each([admin, [...admin,id], [...admin,id,"export"], ["host","payouts"], ["host","payouts",id]].map(path=>({path})))("GET $path preserves private envelope and query", async ({path}) => {
    const envelope = { success:true, data:{ amount:"999999999999999999", status:"APPROVED" }, meta:{page:2} };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope))); vi.stubGlobal("fetch",fetcher);
    const response = await GET(request("GET",undefined,{cookie:"private-refresh"}),context(path));
    expect(await response.json()).toEqual(envelope); expect(response.headers.get("cache-control")).toBe("no-store");
    const [url,init] = fetcher.mock.calls[0];
    expect(url).toBe(`http://backend.test/api/v1/${path.join("/")}?page=2&limit=20`);
    expect(new Headers(init.headers).get("cookie")).toBeNull(); expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error"); expect(new Headers(init.headers).get("x-trotot-proxy-signature")).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([{path:admin,body:{hostId:id,reason:" Fixture "}}, {path:action,body:input}, {path:[...admin,id,"cancel"],body:input}])("POST $path preserves payload and retry key",async ({path,body})=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{}}))); vi.stubGlobal("fetch",fetcher);
    expect((await POST(request("POST",body),context(path))).status).toBe(200);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(body);
    expect(new Headers(fetcher.mock.calls[0][1].headers).get("idempotency-key")).toBe("same-key");
  });
  it.each([{}, {...input,expectedVersion:0}, {...input,expectedVersion:1.5}, {...input,expectedVersion:2147483647}, {...input,reason:" "}, {...input,reason:"x".repeat(501)}, {...input,amount:"100"}, {...input,status:"PAID"}, {...input,bankAccountId:id}])("rejects malformed or forged action %j",async body=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await POST(request("POST",body),context(action))).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{hostId:"bad",reason:"fixture"},{hostId:id,reason:"fixture",cutoff:"now"},{hostId:id,reason:5}])("rejects forged creation %j",async body=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await POST(request("POST",body),context(admin))).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    {handler:POST,method:"POST",path:[...admin,id,"paid"]}, {handler:POST,method:"POST",path:[...admin,id,"export"]},
    {handler:GET,method:"GET",path:["host","payouts",id,"export"]}, {handler:GET,method:"GET",path:[...admin,"bad"]},
    {handler:PUT,method:"PUT",path:action}, {handler:DELETE,method:"DELETE",path:[...admin,id]},
    {handler:POST,method:"POST",path:["host","payouts"]}, {handler:GET,method:"GET",path:[...admin,id,"export","extra"]},
    {handler:GET,method:"GET",path:confirm}, {handler:PUT,method:"PUT",path:confirm},
    {handler:POST,method:"POST",path:["host","payouts",id,"confirm-paid"]},
  ])("blocks unapproved $method $path",async ({handler,method,path})=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await handler(request(method),context(path))).status).toBe(404);expect(fetcher).not.toHaveBeenCalled();
  });
  it("enforces bearer, origin and JSON without changing Auth",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await GET(request("GET",undefined,{authorization:""}),context(admin))).status).toBe(401);
    expect((await POST(request("POST",input,{origin:"https://other.test"}),context(action))).status).toBe(403);
    expect((await POST(request("POST",input,{"content-type":"text/plain"}),context(action))).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("confirmation keeps exact evidence and caller key, private cookie never forwarded",async()=>{
    const envelope={success:true,data:{status:"PAID",amount:"999999999999999999",message:"Admin proof only"}};
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope)));vi.stubGlobal("fetch",fetcher);
    const response=await POST(request("POST",proof,{cookie:"refresh-private"}),context(confirm));
    expect(await response.json()).toEqual(envelope);expect(response.headers.get("cache-control")).toBe("no-store");
    const [url,init]=fetcher.mock.calls[0];expect(url).toBe(`http://backend.test/api/v1/${confirm.join("/")}`);
    expect(JSON.parse(init.body)).toEqual(proof);expect(new Headers(init.headers).get("idempotency-key")).toBe("same-key");
    expect(new Headers(init.headers).get("cookie")).toBeNull();
  });
  it("confirmation requires bearer, same Origin and JSON before sending bank evidence",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await POST(request("POST",proof,{authorization:""}),context(confirm))).status).toBe(401);
    expect((await POST(request("POST",proof,{origin:"https://evil.test"}),context(confirm))).status).toBe(403);
    expect((await POST(request("POST",proof,{"content-type":"text/plain"}),context(confirm))).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["connection", "envelope"])("uncertain %s response warns not to transfer again and never retries",async kind=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    if(kind==="connection") fetcher.mockRejectedValue(new Error("Synthetic connection failure"));
    else fetcher.mockResolvedValue(new Response(JSON.stringify({success:false,data:{status:"PAID"}})));
    const response=await POST(request("POST",proof),context(confirm));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({success:false,errorCode:"BACKEND_UNAVAILABLE",message:expect.stringContaining("không chuyển tiền ngân hàng lần nữa")});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{}, {...proof,expectedVersion:1}, {...proof,expectedVersion:2.5}, {...proof,expectedVersion:2147483647},
    {...proof,bankReference:" "}, {...proof,bankReference:"x".repeat(201)}, {...proof,evidenceNote:" "},
    {...proof,evidenceNote:"x".repeat(501)}, {...proof,reason:" "}, {...proof,reason:"x".repeat(501)},
    {...proof,amount:"1"}, {...proof,bankAccountId:id}, {...proof,status:"PAID"}, {...proof,actorId:id},
  ])("rejects forged or malformed transfer proof %j",async body=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await POST(request("POST",body),context(confirm))).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400,403,404,409,429,503])("confirmation preserves backend %s without retry or a made-up key",async status=>{
    const envelope={success:false,errorCode:"PAYOUT_RECORDING_FAILED",message:"Do not transfer again"};
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope),{status,headers:{"Retry-After":"60"}}));vi.stubGlobal("fetch",fetcher);
    const response=await POST(request("POST",proof,{"idempotency-key":""}),context(confirm));
    expect(response.status).toBe(status);expect(await response.json()).toEqual(envelope);
    expect(new Headers(fetcher.mock.calls[0][1].headers).get("idempotency-key")).toBeNull();
    expect(response.headers.get("retry-after")).toBe(status===429?"60":null);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([400,403,404,409,429,503])("preserves backend %s without retry or inventing a missing key",async status=>{
    const envelope={success:false,errorCode:"PAYOUT_REVIEW_REQUIRED",data:{version:2}};
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope),{status,headers:{"Retry-After":"60"}}));vi.stubGlobal("fetch",fetcher);
    const response=await POST(request("POST",input,{"idempotency-key":""}),context(action));
    expect(response.status).toBe(status);expect(await response.json()).toEqual(envelope);
    expect(response.headers.get("retry-after")).toBe(status===429?"60":null);
    expect(new Headers(fetcher.mock.calls[0][1].headers).get("idempotency-key")).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
