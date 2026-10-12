import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {GET,POST,PUT,DELETE} from "../src/app/api/management/[...path]/route";
const origin="http://localhost:3000",id="00000000-0000-4000-8000-000000000001";
const ctx=(path:string)=>({params:Promise.resolve({path:path.split("/")})});
const req=(method:string,body:unknown={},headers:Record<string,string>={})=>new NextRequest(`${origin}/api/management/test?page=2&limit=20`,{
  method,headers:{origin,authorization:"Bearer fixture","content-type":"application/json","idempotency-key":"same-key",...headers},...(method==="GET"?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{vi.stubEnv("FRONTEND_ORIGIN",origin);vi.stubEnv("BACKEND_API_URL","http://backend.test/api/v1");vi.stubEnv("BFF_PROXY_SECRET","fixture-secret-at-least-32-characters");vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","");});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const upstream=()=>{const mock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,message:"OK",data:[]})));vi.stubGlobal("fetch",mock);return mock;};
it.each([`bookings/${id}/complaints`,"host/finance/complaints",`host/finance/complaints/${id}`,"admin/finance/complaints",`admin/finance/complaints/${id}`])("opens exact read %s with no cookie",async path=>{
  const mock=upstream(),result=await GET(req("GET",undefined,{cookie:"private"}),ctx(path));expect(result.status).toBe(200);expect(result.headers.get("cache-control")).toBe("no-store");
  const [url,init]=mock.mock.calls[0];expect(url).toBe(`http://backend.test/api/v1/${path}?page=2&limit=20`);expect(new Headers(init.headers).get("cookie")).toBeNull();expect(new Headers(init.headers).get("x-trotot-proxy-signature")).toMatch(/^[a-f0-9]{64}$/);
});
const writes=[
  {path:`bookings/${id}/complaints`,body:{expectedVersion:7,reason:" Synthetic "}},
  {path:`host/finance/complaints/${id}/respond`,body:{expectedVersion:1,message:" Synthetic "}},
  {path:`admin/finance/complaints/${id}/assign`,body:{expectedVersion:1,assigneeId:id,reason:" Synthetic "}},
  {path:`admin/finance/complaints/${id}/resolve`,body:{expectedVersion:1,decision:"HOST",reason:" Synthetic ",evidenceNote:" Proof "}},
];
it.each(writes)("forwards original body/key on $path",async({path,body})=>{
  const mock=upstream();expect((await POST(req("POST",body),ctx(path))).status).toBe(200);
  const [url,init]=mock.mock.calls[0];expect(url).toBe(`http://backend.test/api/v1/${path}`);expect(JSON.parse(init.body)).toEqual(body);expect(new Headers(init.headers).get("idempotency-key")).toBe("same-key");expect(init.cache).toBe("no-store");expect(mock).toHaveBeenCalledTimes(1);
});
it.each(writes)("rejects invalid version/text/extras before upstream on $path",async({path,body})=>{
  const mock=vi.fn();vi.stubGlobal("fetch",mock);
  for(const forged of [{...body,expectedVersion:0},{...body,expectedVersion:2147483647},{...body,expectedVersion:1.5},{...body,amount:1},{}])expect((await POST(req("POST",forged),ctx(path))).status).toBe(400);
  expect(mock).not.toHaveBeenCalled();
});
it.each([
  {path:writes[0].path,body:{expectedVersion:1,reason:" "}},
  {path:writes[1].path,body:{expectedVersion:1,message:"x".repeat(501)}},
  {path:writes[2].path,body:{expectedVersion:1,assigneeId:"bad",reason:"Synthetic"}},
  {path:writes[3].path,body:{...writes[3].body,decision:"FULL_REFUND"}},
  {path:writes[3].path,body:{...writes[3].body,evidenceNote:" "}},
])("rejects unsupported payload for $path",async({path,body})=>{
  const mock=vi.fn();vi.stubGlobal("fetch",mock);expect((await POST(req("POST",body),ctx(path))).status).toBe(400);expect(mock).not.toHaveBeenCalled();
});
it("keeps Origin/Bearer/JSON guards",async()=>{
  const mock=vi.fn();vi.stubGlobal("fetch",mock);const {path,body}=writes[0];
  expect((await POST(req("POST",body,{origin:"https://evil.test"}),ctx(path))).status).toBe(403);
  expect((await POST(req("POST",body,{authorization:""}),ctx(path))).status).toBe(401);
  expect((await POST(req("POST",body,{"content-type":"text/plain"}),ctx(path))).status).toBe(415);expect(mock).not.toHaveBeenCalled();
});
it.each([
  {method:"POST",handler:POST,path:`host/finance/complaints/${id}/resolve`},
  {method:"POST",handler:POST,path:`admin/finance/complaints/${id}/respond`},
  {method:"POST",handler:POST,path:"admin/finance/complaints"},
  {method:"POST",handler:POST,path:`bookings/${id}/complaints/${id}/resolve`},
  {method:"GET",handler:GET,path:`admin/finance/complaints/${id}/resolve`},
  {method:"GET",handler:GET,path:"host/finance/complaints/bad"},
  {method:"PUT",handler:PUT,path:`admin/finance/complaints/${id}`},
  {method:"DELETE",handler:DELETE,path:`bookings/${id}/complaints`},
])("keeps $method $path closed",async({method,handler,path})=>{
  const mock=vi.fn();vi.stubGlobal("fetch",mock);expect((await handler(req(method),ctx(path))).status).toBe(404);expect(mock).not.toHaveBeenCalled();
});
it.each([403,404,409,429,503])("preserves backend status %s and Retry-After without retry",async status=>{
  const body={success:false,errorCode:"FIXTURE_ERROR",message:"Synthetic"},mock=vi.fn().mockResolvedValue(new Response(JSON.stringify(body),{status,headers:{"retry-after":"60"}}));vi.stubGlobal("fetch",mock);
  const result=await POST(req("POST",writes[3].body),ctx(writes[3].path));expect(result.status).toBe(status);expect(await result.json()).toEqual(body);expect(result.headers.get("retry-after")).toBe(status===429?"60":null);expect(mock).toHaveBeenCalledTimes(1);
});
it("does not invent success/key when upstream outcome is unknown",async()=>{
  const mock=vi.fn().mockRejectedValue(new Error("Synthetic network failure"));vi.stubGlobal("fetch",mock);
  const result=await POST(req("POST",writes[3].body),ctx(writes[3].path));expect(result.status).toBe(503);expect((await result.json()).message).toContain("Idempotency-Key");expect(mock).toHaveBeenCalledTimes(1);
});
