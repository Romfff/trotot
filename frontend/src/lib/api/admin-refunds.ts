import {managementRequest} from "./client";
import {ApiError} from "@/lib/auth-types";
import type {Page} from "./homestays";
export type RefundRow={id:string;bookingId:string;amount:string;status:"PENDING"|"PAID"|"CANCELLED";version:number;createdAt:string};
export type RefundDetail=RefundRow&{cancelledBy:"GUEST"|"HOST"|"ADMIN";reason:string;updatedAt:string;confirmation:null|{
  id:string;journalId:string;actorId:string;bankReference:string;evidenceNote:string;reason:string;createdAt:string;
}};
export type RefundEvidence={expectedVersion:number;bankReference:string;evidenceNote:string;reason:string};
export type RefundPaidResult={id:string;bookingId:string;amount:string;status:"PAID";version:number;journalId:string;message:string};
const path="/admin/finance/refunds";
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const version=(v:unknown)=>Number.isInteger(v)&&(v as number)>=1&&(v as number)<=2147483647;
const money=(v:unknown)=>typeof v==="string"&&/^[1-9]\d{0,17}$/.test(v);
const text=(v:unknown,max:number)=>typeof v==="string"&&!!v.trim()&&v.length<=max;
const instant=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const envelope=(v:unknown):v is Record<string,unknown>=>object(v)&&v.success===true&&typeof v.message==="string";
function invalid():never{throw new ApiError(502,"INVALID_REFUND_RESPONSE","Dữ liệu khoản hoàn chưa hợp lệ. Chưa thể xác nhận kết quả ghi sổ.");}
function row(v:unknown):v is RefundRow{return object(v)&&uuid(v.id)&&uuid(v.bookingId)&&money(v.amount)&&version(v.version)&&instant(v.createdAt)&&["PENDING","PAID","CANCELLED"].includes(String(v.status));}
export const adminRefundsApi={
  async list(page:number,signal?:AbortSignal):Promise<Page<RefundRow>> {
    const v=await managementRequest<unknown>(path,{params:{page,limit:20},signal});
    if(!envelope(v)||!Array.isArray(v.data)||!object(v.meta)||v.meta.page!==page||v.meta.limit!==20
      ||!Number.isSafeInteger(v.meta.total)||(v.meta.total as number)<0||v.meta.totalPages!==Math.ceil((v.meta.total as number)/20)
      ||v.data.length>20||v.data.length>(v.meta.total as number)||!v.data.every(row)||new Set(v.data.map(r=>r.id)).size!==v.data.length)return invalid();
    return v as Page<RefundRow>;
  },
  async detail(id:string,signal?:AbortSignal):Promise<RefundDetail> {
    const v=await managementRequest<unknown>(`${path}/${encodeURIComponent(id)}`,{signal});
    if(!envelope(v)||!row(v.data))return invalid();
    const r=v.data as RefundDetail;
    if(r.id.toLowerCase()!==id.toLowerCase()||!["GUEST","HOST","ADMIN"].includes(r.cancelledBy)||typeof r.reason!=="string"||r.reason.length>500||!instant(r.updatedAt))return invalid();
    if(r.status==="PAID") {
      const c=r.confirmation;
      if(!object(c)||!uuid(c.id)||!uuid(c.journalId)||!uuid(c.actorId)||!instant(c.createdAt)
        ||!text(c.bankReference,200)||!text(c.evidenceNote,500)||!text(c.reason,500))return invalid();
    }else if(r.confirmation!==null)return invalid();
    return r;
  },
  async confirm(id:string,input:RefundEvidence,key:string):Promise<RefundPaidResult> {
    const v=await managementRequest<unknown>(`${path}/${encodeURIComponent(id)}/confirm-paid`,{method:"POST",data:input,headers:{"Idempotency-Key":key}});
    if(!envelope(v)||!object(v.data))return invalid();
    const r=v.data;
    if(!uuid(r.id)||r.id.toLowerCase()!==id.toLowerCase()||!uuid(r.bookingId)||!uuid(r.journalId)||!money(r.amount)
      ||r.status!=="PAID"||!version(r.version)||r.version!==input.expectedVersion+1||!text(r.message,1000))return invalid();
    return r as RefundPaidResult;
  },
};
