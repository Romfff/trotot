import {managementRequest} from "./client";
import {ApiError} from "@/lib/auth-types";
import type {Page} from "./homestays";

export type NoShowReport={id:string;bookingId:string;bookingVersion:number;reason:string;reportedAt:string};
export type NoShowRow=NoShowReport&{resolved:boolean};
export type NoShowResolution={actorId:string;reason:string;evidenceNote:string;resolvedAt:string};
export type NoShowDetail=NoShowReport&{resolution:NoShowResolution|null};
export type NoShowInput={expectedVersion:number;reason:string};
export type NoShowDecision=NoShowInput&{decision:"NO_SHOW";evidenceNote:string};
export type NoShowResolved={bookingId:string;bookingVersion:number;decision:"NO_SHOW";refundAmount:"0";resolvedAt:string;holdUntil:string};
const path="/admin/finance/no-show-reports";
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const version=(v:unknown,min=2)=>Number.isInteger(v)&&(v as number)>=min&&(v as number)<=2147483647;
const text=(v:unknown)=>typeof v==="string"&&v===v.trim()&&v.length>=1&&v.length<=500;
const instant=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const envelope=(v:unknown):v is Record<string,unknown>=>object(v)&&v.success===true&&typeof v.message==="string";
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).length===allowed.length&&Object.keys(v).every(key=>allowed.includes(key));
const reportKeys=["id","bookingId","bookingVersion","reason","reportedAt"];
function report(v:unknown):v is NoShowReport & Record<string,unknown>{return object(v)&&uuid(v.id)&&uuid(v.bookingId)&&version(v.bookingVersion)&&text(v.reason)&&instant(v.reportedAt);}
function invalid():never{throw new ApiError(502,"INVALID_NO_SHOW_RESPONSE","Dữ liệu báo cáo khách không đến chưa hợp lệ. Chưa thể xác nhận kết quả.");}
function inputValid(id:string,input:NoShowInput,resolve=false){
  if(!uuid(id)||!version(input.expectedVersion,resolve?2:1)||input.expectedVersion>=2147483647
    ||typeof input.reason!=="string"||!text(input.reason.trim()))throw new ApiError(400,"INVALID_NO_SHOW_INPUT","Cần mã đơn, phiên bản và lý do hợp lệ.");
}
export const noShowApi={
  async list(page:number,signal?:AbortSignal):Promise<Page<NoShowRow>>{
    if(!Number.isInteger(page)||page<1||page>1000000)throw new ApiError(400,"INVALID_NO_SHOW_INPUT","Trang báo cáo không hợp lệ.");
    const v=await managementRequest<unknown>(path,{params:{page,limit:20},signal});
    if(!envelope(v)||!Array.isArray(v.data)||!object(v.meta)||v.meta.page!==page||v.meta.limit!==20
      ||!Number.isSafeInteger(v.meta.total)||(v.meta.total as number)<0||v.meta.totalPages!==Math.ceil((v.meta.total as number)/20)
      ||v.data.length!==Math.min(20,Math.max(0,(v.meta.total as number)-(page-1)*20))
      ||!v.data.every(row=>report(row)&&object(row)&&keys(row,[...reportKeys,"resolved"])&&typeof row.resolved==="boolean")
      ||new Set(v.data.map(row=>row.id)).size!==v.data.length)return invalid();
    return v as Page<NoShowRow>;
  },
  async detail(id:string,signal?:AbortSignal):Promise<NoShowDetail>{
    if(!uuid(id))throw new ApiError(400,"INVALID_NO_SHOW_INPUT","Mã báo cáo không hợp lệ.");
    const v=await managementRequest<unknown>(`${path}/${encodeURIComponent(id)}`,{signal});
    if(!envelope(v)||!report(v.data)||!object(v.data)||!keys(v.data,[...reportKeys,"resolution"])||v.data.id.toLowerCase()!==id.toLowerCase())return invalid();
    const r=v.data.resolution;
    if(r!==null&&(!object(r)||!keys(r,["actorId","reason","evidenceNote","resolvedAt"])||!uuid(r.actorId)||!text(r.reason)||!text(r.evidenceNote)||!instant(r.resolvedAt)))return invalid();
    return v.data as NoShowDetail;
  },
  async report(bookingId:string,input:NoShowInput,key:string):Promise<NoShowReport>{
    inputValid(bookingId,input);
    const v=await managementRequest<unknown>(`/host/bookings/${encodeURIComponent(bookingId)}/no-show-report`,{method:"POST",data:input,headers:{"Idempotency-Key":key}});
    if(!envelope(v)||!report(v.data)||!object(v.data)||!keys(v.data,reportKeys)||v.data.bookingId.toLowerCase()!==bookingId.toLowerCase()
      ||v.data.bookingVersion!==input.expectedVersion+1||v.data.reason!==input.reason.trim())return invalid();
    return v.data;
  },
  async resolve(bookingId:string,input:NoShowDecision,key:string):Promise<NoShowResolved>{
    inputValid(bookingId,input,true);
    if(input.decision!=="NO_SHOW"||typeof input.evidenceNote!=="string"||!text(input.evidenceNote.trim()))throw new ApiError(400,"INVALID_NO_SHOW_INPUT","Cần quyết định và chứng cứ hợp lệ.");
    const v=await managementRequest<unknown>(`/admin/finance/bookings/${encodeURIComponent(bookingId)}/resolve-stay`,{method:"POST",data:input,headers:{"Idempotency-Key":key}});
    if(!envelope(v)||!object(v.data))return invalid();const r=v.data;
    if(!keys(r,["bookingId","bookingVersion","decision","refundAmount","resolvedAt","holdUntil"])||!uuid(r.bookingId)||r.bookingId.toLowerCase()!==bookingId.toLowerCase()
      ||!version(r.bookingVersion,3)||r.bookingVersion!==input.expectedVersion+1||r.decision!=="NO_SHOW"||r.refundAmount!=="0"
      ||!instant(r.resolvedAt)||!instant(r.holdUntil)||Date.parse(r.holdUntil)-Date.parse(r.resolvedAt)!==72*3600000)return invalid();
    return r as NoShowResolved;
  },
};
