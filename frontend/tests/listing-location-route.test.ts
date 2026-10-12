import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const origin="http://localhost:3000";
const valid={provinceCode:"79",wardCode:"26740",provinceName:"TP.HCM",wardName:"Phường thử",addressDetail:"Đường thử"};
function request(body:unknown=valid,headers:Record<string,string>={}) {return new NextRequest(origin+"/api/listing-location",{method:"POST",headers:{origin,"content-type":"application/json",...headers},body:JSON.stringify(body)});}
beforeEach(()=>{vi.resetModules();vi.stubEnv("FRONTEND_ORIGIN",origin);vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","");});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("unconfigured geocoding boundary",()=>{
  it("accepts a province-only lookup but never invents coordinates", async () => {
    const {POST}=await import("../src/app/api/listing-location/route");
    const result=await POST(request({...valid,wardCode:"",wardName:"",addressDetail:""}));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({errorCode:"GEOCODING_NOT_CONFIGURED"});
  });
  it.each([{...valid,wardCode:""},{...valid,wardCode:"",wardName:"",addressDetail:"Street"}])("rejects inconsistent province-only input", async body => {
    const {POST}=await import("../src/app/api/listing-location/route");
    expect((await POST(request(body))).status).toBe(400);
  });
  it("reports blocker without network calls, cookies, keys, or cached addresses",async()=>{
    const {POST}=await import("../src/app/api/listing-location/route"); const network=vi.fn();vi.stubGlobal("fetch",network);
    const result=await POST(request());expect(result.status).toBe(503);expect(await result.json()).toMatchObject({errorCode:"GEOCODING_NOT_CONFIGURED"});
    expect(result.headers.get("cache-control")).toBe("no-store");expect(result.headers.get("set-cookie")).toBeNull();expect(network).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and non-JSON",async()=>{const {POST}=await import("../src/app/api/listing-location/route");expect((await POST(request(valid,{origin:"https://evil.test"}))).status).toBe(403);expect((await POST(request(valid,{"content-type":"text/plain"}))).status).toBe(415);});
  it.each([null,[],{}, {...valid,provinceCode:"1"},{...valid,wardCode:"https://evil.test"},{...valid,provider:"chosen-by-client"},{...valid,addressDetail:"x".repeat(256)}])("rejects malformed lookup %j",async body=>{const {POST}=await import("../src/app/api/listing-location/route");expect((await POST(request(body))).status).toBe(400);});
  it("caps streamed body even without content length",async()=>{const {POST}=await import("../src/app/api/listing-location/route");expect((await POST(request({...valid,addressDetail:"x".repeat(5000)}))).status).toBe(413);});
  it("uses configured trusted edge IP only, otherwise shared local limit; returns Retry-After",async()=>{
    const {POST}=await import("../src/app/api/listing-location/route");
    for(let i=0;i<20;i++) expect((await POST(request(valid,{"x-forwarded-for":`203.0.113.${i}`}))).status).toBe(503);
    const blocked=await POST(request());expect(blocked.status).toBe(429);expect(blocked.headers.get("retry-after")).toBe("60");
  });
  it("fails closed for a missing/multi-value trusted edge IP",async()=>{vi.stubEnv("TRUSTED_CLIENT_IP_HEADER","x-real-ip");const {POST}=await import("../src/app/api/listing-location/route");for(const ip of ["","203.0.113.1,203.0.113.2"]) expect((await POST(request(valid,{"x-real-ip":ip}))).status).toBe(503);});
});
