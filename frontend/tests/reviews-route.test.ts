import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
import { GET,POST,PUT,DELETE } from "../src/app/api/management/[...path]/route";
import { GET as publicGet } from "../src/app/api/listings/[...path]/route";
const origin="http://localhost:3000",id="00000000-0000-4000-8000-000000000001";
const context=(path:string[])=>({params:Promise.resolve({path})});
const path=["bookings",id,"review"];
const input={cleanliness:5,location:4,value:3,comment:"Review fixture"};
const req=(method="GET",body:unknown=input,headers:Record<string,string>={})=>new NextRequest(`${origin}/api/management/bookings/${id}/review`,{
  method,headers:{authorization:"Bearer test",...(method!=="GET"?{origin,"content-type":"application/json"}:{}),...headers},...(method!=="GET"?{body:JSON.stringify(body)}:{})});
beforeEach(()=>{vi.stubEnv("FRONTEND_ORIGIN",origin);vi.stubEnv("BACKEND_API_URL","https://backend.test/api/v1");vi.stubEnv("BFF_PROXY_SECRET","review-bff-only-test-secret-32chars");vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","");});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("S5 review BFF allowlist",()=>{
  it("forwards read/create with bearer, never cookies; does not change Auth tokens",async()=>{
    const upstream=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({success:true,data:{id}}))));vi.stubGlobal("fetch",upstream);
    expect((await GET(req(),context(path))).status).toBe(200);
    const result=await POST(req("POST",input,{cookie:"private-cookie"}),context(path));expect(result.status).toBe(200);expect(result.headers.get("set-cookie")).toBeNull();
    expect(upstream.mock.calls[1][0]).toBe(`https://backend.test/api/v1/bookings/${id}/review`);
    const options=upstream.mock.calls[1][1];expect(options.body).toBe(JSON.stringify(input));expect(new Headers(options.headers).get("cookie")).toBeNull();
    expect(options.cache).toBe("no-store");expect(options.redirect).toBe("error");
  });
  it("rejects missing auth, cross-origin writes, wrong methods and paths before upstream",async()=>{
    const upstream=vi.fn();vi.stubGlobal("fetch",upstream);
    expect((await GET(req("GET",input,{authorization:""}),context(path))).status).toBe(401);
    expect((await POST(req("POST",input,{origin:"https://evil.test"}),context(path))).status).toBe(403);
    expect((await PUT(req("PUT"),context(path))).status).toBe(404);
    expect((await DELETE(req("DELETE"),context(path))).status).toBe(404);
    expect((await POST(req("POST"),context(["host",...path]))).status).toBe(404);
    expect((await GET(req(),context(["bookings","..","review"]))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([{cleanliness:0},{location:6},{value:2.5},{value:"5"},{comment:" "},{comment:"x".repeat(2001)},{guestId:id}])("rejects invalid or forged fields %j",async bad=>{
    const upstream=vi.fn();vi.stubGlobal("fetch",upstream);
    expect((await POST(req("POST",{...input,...bad}),context(path))).status).toBe(400);expect(upstream).not.toHaveBeenCalled();
  });
  it("public reviews never forward bearer/cookies and preserve pagination envelope",async()=>{
    const payload={success:true,data:[],meta:{page:1,limit:10,total:0,totalPages:0}};
    const upstream=vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));vi.stubGlobal("fetch",upstream);
    const request=new NextRequest(`${origin}/api/listings/properties/fixture/reviews?page=1&limit=10`,{headers:{authorization:"Bearer private",cookie:"private"}});
    const result=await publicGet(request,context(["properties","fixture","reviews"]));expect(await result.json()).toEqual(payload);
    const [url,options]=upstream.mock.calls[0];expect(url).toBe("https://backend.test/api/v1/properties/fixture/reviews?page=1&limit=10");
    expect(new Headers(options.headers).get("authorization")).toBeNull();expect(new Headers(options.headers).get("cookie")).toBeNull();
    expect((await publicGet(request,context(["properties","..","reviews"]))).status).toBe(404);
  });
  it.each([401,403,404,409,429,503])("preserves backend error %i without auto replay",async status=>{
    const upstream=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:false,errorCode:"REVIEW_ERROR",message:"Fixture"}),{status,headers:{"Retry-After":"60"}}));vi.stubGlobal("fetch",upstream);
    const result=await POST(req("POST"),context(path));expect(result.status).toBe(status);expect(upstream).toHaveBeenCalledTimes(1);
    if(status===429)expect(result.headers.get("retry-after")).toBe("60");
  });
});
