import {beforeEach,describe,expect,it,vi} from "vitest";
import {noShowApi} from "../src/lib/api/no-show";
import {managementRequest} from "../src/lib/api/client";
vi.mock("../src/lib/api/client",()=>({managementRequest:vi.fn()}));
const transport=vi.mocked(managementRequest),id="11111111-1111-4111-8111-111111111111",bookingId="22222222-2222-4222-8222-222222222222";
const report={id,bookingId,bookingVersion:2,reason:"Fixture reason",reportedAt:"2026-10-01T07:00:00.000Z"};
const resolution={actorId:id,reason:"Fixture decision",evidenceNote:"Fixture evidence",resolvedAt:"2026-10-03T05:00:00.000Z"};
const resolved={bookingId,bookingVersion:3,decision:"NO_SHOW",refundAmount:"0",resolvedAt:resolution.resolvedAt,holdUntil:"2026-10-06T05:00:00.000Z"};
const envelope=(data:unknown)=>({success:true,message:"Fixture",data});
beforeEach(()=>{transport.mockReset();});
describe("existing no-show client contract (mock transport)",()=>{
  it("reads list metadata outside data and passes AbortSignal without private data",async()=>{
    const value={...envelope([{...report,resolved:false}]),meta:{page:1,limit:20,total:1,totalPages:1}},signal=new AbortController().signal;transport.mockResolvedValue(value);
    expect(await noShowApi.list(1,signal)).toEqual(value);expect(transport).toHaveBeenCalledWith("/admin/finance/no-show-reports",{params:{page:1,limit:20},signal});
  });
  it("accepts null and complete private Admin detail, not a list row",async()=>{
    const signal=new AbortController().signal;for(const value of [null,resolution]){transport.mockResolvedValue(envelope({...report,resolution:value}));expect(await noShowApi.detail(id,signal)).toEqual({...report,resolution:value});}
    expect(transport).toHaveBeenLastCalledWith(`/admin/finance/no-show-reports/${id}`,{signal});
  });
  it("preserves original report/decision bodies and keys, checks server increment without fabricating completion",async()=>{
    const input={expectedVersion:1,reason:" Fixture reason "};transport.mockResolvedValue(envelope(report));expect(await noShowApi.report(bookingId,input,"key-A")).toEqual(report);
    expect(transport).toHaveBeenLastCalledWith(`/host/bookings/${bookingId}/no-show-report`,{method:"POST",data:input,headers:{"Idempotency-Key":"key-A"}});expect(input.reason).toBe(" Fixture reason ");
    const decision={expectedVersion:2,decision:"NO_SHOW" as const,reason:" Fixture decision ",evidenceNote:" Fixture evidence "};transport.mockResolvedValue(envelope(resolved));expect(await noShowApi.resolve(bookingId,decision,"key-B")).toEqual(resolved);
    expect(transport).toHaveBeenLastCalledWith(`/admin/finance/bookings/${bookingId}/resolve-stay`,{method:"POST",data:decision,headers:{"Idempotency-Key":"key-B"}});
  });
  it.each([0,-1,1.5,NaN,Infinity,1000001])("rejects page %s before transport",async page=>{await expect(noShowApi.list(page)).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_INPUT"});expect(transport).not.toHaveBeenCalled();});
  it.each([
    {...report,id:"bad"},{...report,bookingId:"bad"},{...report,bookingVersion:1},{...report,bookingVersion:2147483648},
    {...report,reason:""},{...report,reason:"x".repeat(501)},{...report,reason:" untrimmed "},{...report,reportedAt:"2026-02-30T00:00:00.000Z"},
    {...report,reportedAt:"yesterday"},{...report,guestPhone:"private"},{...report,evidenceNote:"private"},
  ])("rejects malformed/leaking list row %j",async row=>{
    transport.mockResolvedValue({...envelope([{...row,resolved:false}]),meta:{page:1,limit:20,total:1,totalPages:1}});await expect(noShowApi.list(1)).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_RESPONSE"});
  });
  it.each(["false",0,null,[],{}].map(value=>({value})))("rejects nonboolean resolved %j",async ({value})=>{transport.mockResolvedValue({...envelope([{...report,resolved:value}]),meta:{page:1,limit:20,total:1,totalPages:1}});await expect(noShowApi.list(1)).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_RESPONSE"});});
  it.each([
    {page:2,limit:20,total:1,totalPages:1},{page:1,limit:10,total:1,totalPages:1},{page:1,limit:20,total:-1,totalPages:0},
    {page:1,limit:20,total:1,totalPages:2},{page:1,limit:20,total:2,totalPages:1},
  ])("rejects inconsistent list metadata %j",async meta=>{transport.mockResolvedValue({...envelope([{...report,resolved:false}]),meta});await expect(noShowApi.list(1)).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_RESPONSE"});});
  it("rejects duplicate report IDs and accepts an empty out-of-range page",async()=>{
    transport.mockResolvedValue({...envelope([{...report,resolved:false},{...report,resolved:false}]),meta:{page:1,limit:20,total:2,totalPages:1}});await expect(noShowApi.list(1)).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_RESPONSE"});
    const value={...envelope([]),meta:{page:1000000,limit:20,total:1,totalPages:1}};transport.mockResolvedValue(value);expect(await noShowApi.list(1000000)).toEqual(value);
  });
  it.each([
    {...report,id:bookingId,resolution:null},{...report,resolved:false,resolution:null},{...report,resolution:{}},
    {...report,resolution:{...resolution,actorId:"bad"}},{...report,resolution:{...resolution,evidenceNote:""}},
    {...report,resolution:{...resolution,bankAccount:"private"}},{...report,resolution:{...resolution,resolvedAt:"bad"}},
  ])("rejects malformed detail %j",async value=>{transport.mockResolvedValue(envelope(value));await expect(noShowApi.detail(id)).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_RESPONSE"});});
  it.each([{...report,bookingId:id},{...report,bookingVersion:3},{...report,reason:"Different"},{...report,resolved:false}])("rejects report acknowledgement %j",async value=>{
    transport.mockResolvedValue(envelope(value));await expect(noShowApi.report(bookingId,{expectedVersion:1,reason:report.reason},"key")).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_RESPONSE"});
  });
  it.each([
    {...resolved,bookingId:id},{...resolved,bookingVersion:2},{...resolved,refundAmount:0},{...resolved,refundAmount:"1"},
    {...resolved,decision:"PARTIAL_STAY"},{...resolved,holdUntil:resolution.resolvedAt},{...resolved,bookingStatus:"COMPLETED"},
    {...resolved,holdUntil:"bad"},{...resolved,resolvedAt:"bad"},
  ])("rejects false resolution result %j",async value=>{
    transport.mockResolvedValue(envelope(value));await expect(noShowApi.resolve(bookingId,{expectedVersion:2,decision:"NO_SHOW",reason:"Reason",evidenceNote:"Evidence"},"key")).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_RESPONSE"});
  });
  it("does not turn failed envelopes/network/abort into success or retry automatically",async()=>{
    transport.mockResolvedValue({success:false,message:"No",data:report});await expect(noShowApi.report(bookingId,{expectedVersion:1,reason:report.reason},"key")).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_RESPONSE"});
    const error=new Error("Fixture upstream failure");transport.mockRejectedValue(error);
    let caught:unknown;try{await noShowApi.detail(id);}catch(value){caught=value;}
    expect(caught).toBe(error);
    const abort=new DOMException("Fixture aborted","AbortError");transport.mockRejectedValue(abort);caught=undefined;
    try{await noShowApi.detail(id,new AbortController().signal);}catch(value){caught=value;}
    expect(caught).toBe(abort);expect(transport).toHaveBeenCalledTimes(3);
  });
  it("rejects invalid IDs/evidence/version before transport",async()=>{
    await expect(noShowApi.detail("bad")).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_INPUT"});
    await expect(noShowApi.report(bookingId,{expectedVersion:2147483647,reason:"Reason"},"key")).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_INPUT"});
    await expect(noShowApi.resolve(bookingId,{expectedVersion:2,decision:"NO_SHOW",reason:"Reason",evidenceNote:" "},"key")).rejects.toMatchObject({errorCode:"INVALID_NO_SHOW_INPUT"});expect(transport).not.toHaveBeenCalled();
  });
});
