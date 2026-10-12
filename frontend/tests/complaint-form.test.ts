import {expect,it} from "vitest";
import {complaintFieldErrors,emptyRefund,refundFieldErrors,resolveComplaintBody} from "@/features/admin-finance/complaint-form";
const fields={assigneeId:"00000000-0000-4000-8000-000000000001",reason:"Review",evidenceNote:"Evidence"};
it("assignment needs reason and UUID, not resolution evidence",()=>{
  expect(complaintFieldErrors({...fields,evidenceNote:""},"assign")).toEqual({});
  expect(complaintFieldErrors({...fields,assigneeId:"bad"},"assign")).toHaveProperty("assigneeId");
});
it("resolution needs reason and evidence, not an assignee",()=>{
  expect(complaintFieldErrors({...fields,assigneeId:""},"resolve")).toEqual({});
  expect(complaintFieldErrors({...fields,evidenceNote:" "},"resolve")).toHaveProperty("evidenceNote");
});
it.each(["", " ", "x".repeat(501)])("rejects invalid reason for either action",reason=>{
  for(const action of ["assign","resolve"] as const)expect(complaintFieldErrors({...fields,reason},action)).toHaveProperty("reason");
});
it("accepts exact trimmed boundaries without mutating values",()=>{
  const input={...fields,reason:" "+"x".repeat(500)+" ",evidenceNote:"x".repeat(500)};
  expect(complaintFieldErrors(input,"resolve")).toEqual({});expect(input.reason).toHaveLength(502);
});
const refund={...emptyRefund,decision:"PARTIAL_REFUND" as const,expectedBookingVersion:"7",baseAmount:"500",cleaningFee:"0",serviceFee:"0",taxAmount:"0"};
it("HOST ignores inactive refund fields and excludes them from request",()=>{
  expect(refundFieldErrors(emptyRefund)).toEqual({});
  expect(resolveComplaintBody(fields,{...refund,decision:"HOST"},3)).toEqual({expectedVersion:3,reason:"Review",evidenceNote:"Evidence",decision:"HOST"});
});
it("refund preserves exact strings and distinguishes booking/complaint versions",()=>{
  expect(refundFieldErrors(refund)).toEqual({});
  expect(resolveComplaintBody(fields,refund,3)).toEqual({expectedVersion:3,reason:"Review",evidenceNote:"Evidence",decision:"PARTIAL_REFUND",expectedBookingVersion:7,
    allocation:{baseAmount:"500",cleaningFee:"0",serviceFee:"0",taxAmount:"0"}});
});
it.each(["","-1","0.5","1e3","01"," 5 ","10000000000000"])("rejects noncanonical refund input %s",baseAmount=>{
  expect(refundFieldErrors({...refund,baseAmount})).toHaveProperty("baseAmount");
});
it.each(["","0","1.5","-1","2147483647","7e1","01"])("rejects booking version %s",expectedBookingVersion=>{
  expect(refundFieldErrors({...refund,expectedBookingVersion})).toHaveProperty("expectedBookingVersion");
});
it("partial cannot return service or create a zero obligation; full accepts service for server snapshot check",()=>{
  expect(refundFieldErrors({...refund,serviceFee:"1"})).toHaveProperty("serviceFee");
  expect(refundFieldErrors({...refund,baseAmount:"0"})).toHaveProperty("baseAmount");
  expect(refundFieldErrors({...refund,decision:"FULL_REFUND",serviceFee:"100"})).toEqual({});
});
