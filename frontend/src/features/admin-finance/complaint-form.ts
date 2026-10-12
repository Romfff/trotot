import {reviewFieldErrors} from "./bank-review";
import type {ComplaintRefundAllocation,ComplaintResolveInput} from "@/lib/api/complaints";
export type RefundFields={decision:ComplaintResolveInput["decision"];expectedBookingVersion:string}&ComplaintRefundAllocation;
export const emptyRefund:RefundFields={decision:"HOST",expectedBookingVersion:"",baseAmount:"",cleaningFee:"",serviceFee:"",taxAmount:""};
export const refundLabels={baseAmount:"Tiền phòng hoàn (đ)",cleaningFee:"Phí vệ sinh hoàn (đ)",serviceFee:"Phí dịch vụ hoàn (đ)",taxAmount:"Thuế hoàn (đ)"};
export function refundFieldErrors(fields:RefundFields) {
  const errors:Partial<Record<keyof RefundFields,string>>={};
  if(fields.decision==="HOST")return errors;
  if(!/^[1-9]\d{0,9}$/.test(fields.expectedBookingVersion)||Number(fields.expectedBookingVersion)>2147483646)
    errors.expectedBookingVersion="Phiên bản đơn phải là số nguyên từ 1 đến 2147483646.";
  for(const name of Object.keys(refundLabels) as (keyof ComplaintRefundAllocation)[])
    if(!/^(0|[1-9]\d{0,12})$/.test(fields[name]))errors[name]="Nhập số nguyên VND không âm; khoản không hoàn nhập 0.";
  if(fields.decision==="PARTIAL_REFUND"&&fields.serviceFee!=="0")errors.serviceFee="Hoàn một phần không hoàn phí dịch vụ; nhập 0.";
  if(!Object.keys(errors).length&&Object.keys(refundLabels).every(name=>fields[name as keyof ComplaintRefundAllocation]==="0"))
    errors.baseAmount="Tổng tiền hoàn phải lớn hơn 0.";
  return errors;
}
export function resolveComplaintBody(fields:ComplaintFields,refund:RefundFields,expectedVersion:number):ComplaintResolveInput {
  const shared={expectedVersion,reason:fields.reason,evidenceNote:fields.evidenceNote};
  return refund.decision==="HOST"?{...shared,decision:"HOST"}:{...shared,decision:refund.decision,
    expectedBookingVersion:Number(refund.expectedBookingVersion),allocation:{baseAmount:refund.baseAmount,cleaningFee:refund.cleaningFee,serviceFee:refund.serviceFee,taxAmount:refund.taxAmount}};
}
export type ComplaintFields={assigneeId:string;reason:string;evidenceNote:string};
export function complaintFieldErrors(fields:ComplaintFields,action:"assign"|"resolve") {
  const errors:Partial<Record<keyof ComplaintFields,string>>=reviewFieldErrors(fields);
  if(action==="assign") {
    delete errors.evidenceNote;
    if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(fields.assigneeId.trim()))errors.assigneeId="Nhập UUID của Admin đang hoạt động.";
  }
  return errors;
}
