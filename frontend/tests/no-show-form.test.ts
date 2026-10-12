import {describe,expect,it} from "vitest";
import {canReportNoShow,canResolveNoShow,noShowFieldErrors} from "@/features/no-show/form";
const booking={version:1,bookingStatus:"CONFIRMED",paymentStatus:"PAID"};
const fields={reason:"Fixture reason",evidenceNote:"Fixture evidence"};
describe("no-show form presentation, not server authorization",()=>{
  it("Host requires reason, Admin additionally requires evidence",()=>{
    expect(noShowFieldErrors({...fields,evidenceNote:""},"host")).toEqual({});
    expect(noShowFieldErrors({...fields,evidenceNote:""},"admin")).toHaveProperty("evidenceNote");
    expect(noShowFieldErrors(fields,"admin")).toEqual({});
  });
  it.each([""," ","x".repeat(501)])("rejects invalid reason and Admin evidence %s",value=>{
    for(const scope of ["host","admin"] as const)expect(noShowFieldErrors({...fields,reason:value},scope)).toHaveProperty("reason");
    expect(noShowFieldErrors({...fields,evidenceNote:value},"admin")).toHaveProperty("evidenceNote");
  });
  it("checks trimmed boundary without mutating body used by idempotency",()=>{
    const input={reason:" "+"x".repeat(500)+" ",evidenceNote:" "+"x".repeat(500)+" "},before={...input};
    expect(noShowFieldErrors(input,"admin")).toEqual({});expect(input).toEqual(before);
  });
  it("allows only paid confirmed report, without inventing check-in time",()=>{
    expect(canReportNoShow(booking)).toBe(true);
  });
  it.each(["HELD","PENDING_PAYMENT","PENDING_HOST_APPROVAL","CHECKED_IN","COMPLETED","CANCELLED_BY_GUEST","REJECTED_BY_HOST"])("blocks report status %s",bookingStatus=>{
    expect(canReportNoShow({...booking,bookingStatus})).toBe(false);
  });
  it.each(["PENDING","NOT_CONFIGURED","REFUNDED","FAILED"])("blocks unpaid/refunded %s",paymentStatus=>{
    expect(canReportNoShow({...booking,paymentStatus})).toBe(false);
  });
  it.each([0,-1,1.5,NaN,Infinity,2147483647,2147483648])("blocks unusable report version %s",version=>{
    expect(canReportNoShow({...booking,version})).toBe(false);
  });
  it("Admin may attempt unresolved report, not resolve it twice or fabricate money",()=>{
    expect(canResolveNoShow({bookingVersion:2,resolution:null})).toBe(true);
    expect(canResolveNoShow({bookingVersion:2147483646,resolution:null})).toBe(true);
    expect(canResolveNoShow({bookingVersion:3,resolution:{actorId:"fixture",reason:"Fixture",evidenceNote:"Fixture",resolvedAt:"2026-10-07T00:00:00.000Z"}})).toBe(false);
  });
  it.each([0,1,-1,2.5,NaN,Infinity,2147483647,2147483648])("blocks unusable resolve version %s",bookingVersion=>{
    expect(canResolveNoShow({bookingVersion,resolution:null})).toBe(false);
  });
});
