import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {GET,POST,PUT,DELETE} from "../src/app/api/management/[...path]/route";
const origin="http://localhost:3000",id="11111111-1111-4111-8111-111111111111";
const report=["host","bookings",id,"no-show-report"],resolve=["admin","finance","bookings",id,"resolve-stay"],list=["admin","finance","no-show-reports"];
const context=(path:string[])=>({params:Promise.resolve({path})});
const input={expectedVersion:1,reason:" Fixture reason "},decision={expectedVersion:2,reason:" Fixture decision ",decision:"NO_SHOW",evidenceNote:" Fixture evidence "};
function request(method:string,body:unknown=input,headers:Record<string,string>={}){return new NextRequest(origin+"/api/management/test?page=2&limit=20",{method,headers:{authorization:"Bearer fixture",origin,"content-type":"application/json","idempotency-key":"key-original",...headers},...(method==="GET"?{}:{body:JSON.stringify(body)})});}
beforeEach(()=>{vi.stubEnv("FRONTEND_ORIGIN",origin);vi.stubEnv("BACKEND_API_URL","http://backend.test/api/v1");vi.stubEnv("BFF_PROXY_SECRET","fixture-proxy-secret-0123456789abcdef");vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","");});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("no-show fixed BFF routes (mock upstream, no Auth execution)",()=>{
  it.each([[report,input,201],[resolve,decision,200]] as const)("forwards %j unchanged with key, never cookies",async(path,body,status)=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,message:"Fixture",data:{}}),{status}));vi.stubGlobal("fetch",fetchMock);
    const response=await POST(request("POST",body,{cookie:"refresh=private"}),context([...path]));expect(response.status).toBe(status);expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("set-cookie")).toBeNull();
    const [url,init]=fetchMock.mock.calls[0];expect(url).toBe(`http://backend.test/api/v1/${path.join("/")}`);expect(init.body).toBe(JSON.stringify(body));
    expect(init.headers["Idempotency-Key"]).toBe("key-original");expect(init.headers.Authorization).toBe("Bearer fixture");expect(init.headers.cookie).toBeUndefined();expect(init.cache).toBe("no-store");expect(init.redirect).toBe("error");
  });
  it.each([{path:list},{path:[...list,id]}])("forwards exact private read %j and query",async ({path})=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,message:"Fixture",data:[]}),{status:200}));vi.stubGlobal("fetch",fetchMock);
    expect((await GET(request("GET"),context(path))).status).toBe(200);expect(fetchMock.mock.calls[0][0]).toBe(`http://backend.test/api/v1/${path.join("/")}?page=2&limit=20`);
  });
  it.each([
    {...input,actorId:id},{...input,reason:" "},{...input,reason:"x".repeat(501)},{...input,expectedVersion:0},{...input,expectedVersion:2147483647},
    {...input,expectedVersion:"1"},[],null,{},
  ])("rejects malformed Host body %j before upstream",async body=>{const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);expect((await POST(request("POST",body),context(report))).status).toBe(400);expect(fetchMock).not.toHaveBeenCalled();});
  it.each([{...decision,evidenceNote:""},{...decision,decision:"PARTIAL_STAY"},{...decision,refundAmount:"0"},{...decision,expectedVersion:1}])("rejects unapproved Admin body %j",async body=>{const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);expect((await POST(request("POST",body),context(resolve))).status).toBe(400);expect(fetchMock).not.toHaveBeenCalled();});
  it("enforces bearer, origin and JSON without interpreting cookie as identity",async()=>{
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    expect((await GET(request("GET",{}, {authorization:"",cookie:"refresh=private"}),context(list))).status).toBe(401);
    expect((await POST(request("POST",input,{origin:"https://evil.test"}),context(report))).status).toBe(403);
    expect((await POST(request("POST",input,{"content-type":"text/plain"}),context(report))).status).toBe(415);expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not open aliases, arbitrary methods, booking detail or unknown actions",async()=>{
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    for(const path of [["host","finance","no-show-reports"],[...list,"bad"],[...list,id,"resolve"],[...report,"extra"]])expect((await GET(request("GET"),context(path))).status).toBe(404);
    expect((await GET(request("GET"),context(resolve))).status).toBe(404);expect((await POST(request("POST"),context(list))).status).toBe(404);
    for(const handler of [PUT,DELETE])expect((await handler(request(handler===PUT?"PUT":"DELETE",decision),context(resolve))).status).toBe(404);expect(fetchMock).not.toHaveBeenCalled();
  });
  it("preserves role/conflict/rate errors and retries only when caller sends a request",async()=>{
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    for(const status of [403,404,409,429]){
      const value={success:false,errorCode:"FIXTURE",message:"Fixture error"};fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value),{status,headers:{"Retry-After":"12"}}));
      const response=await POST(request("POST",decision),context(resolve));expect(response.status).toBe(status);expect(await response.json()).toEqual(value);if(status===429)expect(response.headers.get("retry-after")).toBe("12");
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
