import {describe,it,expect} from "vitest";
import {complaintTextError,canRequestComplaint} from "../src/features/host-finance/complaint-form";
const booking={bookingId:"id",bookingCode:"code",version:1,paymentStatus:"PAID",bookingStatus:"CONFIRMED"};
describe("complaint presentation only; server enforces ownership/window",()=>{
  it.each(["","  ","a".repeat(501)])("rejects empty/oversized text",text=>expect(complaintTextError(text)).toBeTruthy());
  it("validates trimmed boundary without mutating submitted text",()=>{const text=" "+"a".repeat(500)+" ";expect(complaintTextError(text)).toBeUndefined();expect(text.length).toBe(502);});
  it.each(["CONFIRMED","CHECKED_IN","COMPLETED"])("can ask on paid %s; completed window stays server-side",bookingStatus=>expect(canRequestComplaint({...booking,bookingStatus},false)).toBe(true));
  it.each(["PENDING_PAYMENT","PENDING_HOST_APPROVAL","CANCELLED_BY_GUEST","REJECTED_BY_HOST"])("cannot create for %s",bookingStatus=>expect(canRequestComplaint({...booking,bookingStatus},false)).toBe(false));
  it.each(["PENDING","NOT_CONFIGURED","REFUNDED"])("unpaid/refunded %s cannot create",paymentStatus=>expect(canRequestComplaint({...booking,paymentStatus},false)).toBe(false));
  it("open complaint and exhausted version block creation",()=>{expect(canRequestComplaint(booking,true)).toBe(false);expect(canRequestComplaint({...booking,version:2147483647},false)).toBe(false);});
});
