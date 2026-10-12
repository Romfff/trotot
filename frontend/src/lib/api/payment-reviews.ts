import { managementRequest } from "./client";
import { ApiError } from "@/lib/auth-types";
import type { Page } from "./homestays";

export type PaymentReview = {
  id:string; sessionId:string; bookingId:string; bookingCode:string; provider:"VNPAY_SANDBOX"; transactionNo:string;
  expectedAmount:string; receivedAmount:string;
  reasonCode:"AMOUNT_MISMATCH"|"BOOKING_NOT_PAYABLE"|"SESSION_CHANGED"|"PAYMENT_TIME_INVALID"|"SOURCE_EXISTS";
  sessionBookingVersion:number; bookingVersion:number; bookingStatus:string; paymentStatus:string;
  sessionExpiresAt:string; payDate:string|null; receivedAt:string;
};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const version=(v:unknown)=>integer(v)&&v>=1&&v<=2147483647;
const money=(v:unknown):v is string=>typeof v==="string"&&/^[1-9][0-9]{0,9}$/.test(v);
const timestamp=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  &&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function invalid():never {throw new ApiError(502,"INVALID_PAYMENT_REVIEW_RESPONSE","Dữ liệu đối soát chưa hợp lệ. Hãy tải lại; chưa thể xác nhận thanh toán.");}
function review(v:unknown):v is PaymentReview {
  return object(v)&&Object.keys(v).length===16&&uuid(v.id)&&uuid(v.sessionId)&&uuid(v.bookingId)
    &&typeof v.bookingCode==="string"&&!!v.bookingCode.trim()&&v.bookingCode.length<=32&&v.provider==="VNPAY_SANDBOX"
    &&typeof v.transactionNo==="string"&&/^[1-9][0-9]{0,14}$/.test(v.transactionNo)
    &&money(v.expectedAmount)&&money(v.receivedAmount)
    &&typeof v.reasonCode==="string"&&["AMOUNT_MISMATCH","BOOKING_NOT_PAYABLE","SESSION_CHANGED","PAYMENT_TIME_INVALID","SOURCE_EXISTS"].includes(v.reasonCode)
    &&version(v.sessionBookingVersion)&&version(v.bookingVersion)
    &&typeof v.bookingStatus==="string"&&["PENDING_HOST_APPROVAL","PENDING_PAYMENT","CONFIRMED","CHECKED_IN","COMPLETED","CANCELLED","CANCELLED_BY_GUEST","REJECTED_BY_HOST","CANCELLED_HOST_TIMEOUT","CANCELLED_TIMEOUT"].includes(v.bookingStatus)
    &&typeof v.paymentStatus==="string"&&["NOT_CONFIGURED","PENDING","PAID","REFUNDED"].includes(v.paymentStatus)
    &&timestamp(v.sessionExpiresAt)&&(v.payDate===null||timestamp(v.payDate))&&timestamp(v.receivedAt);
}
const validEnvelope=(v:unknown):v is Record<string,unknown>=>object(v)&&v.success===true&&typeof v.message==="string";
export const paymentReviewsApi={
  list:async(page:number,signal?:AbortSignal):Promise<Page<PaymentReview>>=>{
    if(!integer(page)||page<1||page>1000000)return invalid();
    const body=await managementRequest<unknown>("/admin/finance/payment-reviews",{params:{page,limit:20},signal});
    if(!validEnvelope(body)||!Array.isArray(body.data)||!object(body.meta))return invalid();
    const {data,meta}=body;
    if(meta.page!==page||meta.limit!==20||!integer(meta.total)||meta.totalPages!==Math.ceil(meta.total/20)
      ||data.length!==Math.min(20,Math.max(0,meta.total-(page-1)*20))||!data.every(review)
      ||new Set(data.map(row=>row.id.toLowerCase())).size!==data.length)return invalid();
    return body as Page<PaymentReview>;
  },
  read:async(id:string,signal?:AbortSignal):Promise<PaymentReview>=>{
    if(!uuid(id))return invalid();
    const body=await managementRequest<unknown>(`/admin/finance/payment-reviews/${encodeURIComponent(id)}`,{signal});
    if(!validEnvelope(body)||!review(body.data)||body.data.id.toLowerCase()!==id.toLowerCase())return invalid();
    return body.data;
  },
};
