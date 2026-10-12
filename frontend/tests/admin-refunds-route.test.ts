import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {GET,POST,PUT,DELETE} from "../src/app/api/management/[...path]/route";
const origin="http://localhost:3000",id="00000000-0000-4000-8000-000000000001",parts=["admin","finance","refunds"];
const input={expectedVersion:1,reason:" Fixture ",bankReference:" FIXTURE ",evidenceNote:" Synthetic only "};
const ctx=(path:string[])=>({params:Promise.resolve({path})});
const req=(method:string,body:unknown=input,headers:Record<string,string>={})=>new NextRequest(`${origin}/api/management/admin/finance/refunds?page=2&limit=20`,{
  method,headers:{origin,authorization:"Bearer fixture","content-type":"application/json","idempotency-key":"same-key",...headers},...(method==="GET"?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{vi.stubEnv("FRONTEND_ORIGIN",origin);vi.stubEnv("BACKEND_API_URL","http://backend.test/api/v1");vi.stubEnv("BFF_PROXY_SECRET","fixture-secret-at-least-32-characters");vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","");});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it.each([parts,[...parts,id]].map(path=>({path})))("opens exact refund read $path",async({path})=>{
  const upstream=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,message:"OK",data:[]})));vi.stubGlobal("fetch",upstream);
  const result=await GET(req("GET",undefined,{cookie:"private"}),ctx(path));expect(result.status).toBe(200);expect(result.headers.get("cache-control")).toBe("no-store");
  const [url,init]=upstream.mock.calls[0];expect(url).toBe(`http://backend.test/api/v1/${path.join("/")}?page=2&limit=20`);expect(new Headers(init.headers).get("cookie")).toBeNull();
});
it("forwards original evidence/version/key without executing a transfer",async()=>{
  const upstream=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,message:"OK",data:{}})));vi.stubGlobal("fetch",upstream);
  expect((await POST(req("POST"),ctx([...parts,id,"confirm-paid"]))).status).toBe(200);
  const [url,init]=upstream.mock.calls[0];expect(url).toBe(`http://backend.test/api/v1/admin/finance/refunds/${id}/confirm-paid`);
  expect(JSON.parse(init.body)).toEqual(input);expect(new Headers(init.headers).get("idempotency-key")).toBe("same-key");expect(init.cache).toBe("no-store");
});
it.each([{}, {...input,expectedVersion:0},{...input,expectedVersion:2147483647},{...input,expectedVersion:1.5},{...input,bankReference:" "},{...input,bankReference:"x".repeat(201)},
  {...input,evidenceNote:"x".repeat(501)},{...input,reason:" "},{...input,amount:"10"},{...input,status:"PAID"}])("rejects forged body %j",async body=>{
  const upstream=vi.fn();vi.stubGlobal("fetch",upstream);expect((await POST(req("POST",body),ctx([...parts,id,"confirm-paid"]))).status).toBe(400);expect(upstream).not.toHaveBeenCalled();
});
it("preserves Origin/Bearer/JSON guards",async()=>{
  const upstream=vi.fn();vi.stubGlobal("fetch",upstream);const path=[...parts,id,"confirm-paid"];
  expect((await POST(req("POST",input,{origin:"https://evil.test"}),ctx(path))).status).toBe(403);
  expect((await POST(req("POST",input,{authorization:""}),ctx(path))).status).toBe(401);
  expect((await POST(req("POST",input,{"content-type":"text/plain"}),ctx(path))).status).toBe(415);expect(upstream).not.toHaveBeenCalled();
});
it.each([{method:"POST",handler:POST,path:parts},{method:"PUT",handler:PUT,path:[...parts,id]},{method:"DELETE",handler:DELETE,path:[...parts,id]},
  {method:"GET",handler:GET,path:[...parts,id,"confirm-paid"]},{method:"POST",handler:POST,path:[...parts,id,"cancel"]}])("keeps $method $path closed",async({method,handler,path})=>{
  const upstream=vi.fn();vi.stubGlobal("fetch",upstream);expect((await handler(req(method),ctx(path))).status).toBe(404);expect(upstream).not.toHaveBeenCalled();
});
it.each([403,404,409,429,503])("preserves backend %s without auto retry",async status=>{
  const body={success:false,errorCode:"REFUND_RECORDING_FAILED",message:"Fixture"},upstream=vi.fn().mockResolvedValue(new Response(JSON.stringify(body),{status,headers:{"retry-after":"60"}}));vi.stubGlobal("fetch",upstream);
  const result=await POST(req("POST"),ctx([...parts,id,"confirm-paid"]));expect(result.status).toBe(status);expect(await result.json()).toEqual(body);expect(result.headers.get("retry-after")).toBe(status===429?"60":null);expect(upstream).toHaveBeenCalledTimes(1);
});
