import {managementRequest} from "./client";
import {ApiError} from "@/lib/auth-types";
import type {Page} from "./homestays";
export type ComplaintRow={id:string;bookingId:string;reason:string;status:"OPEN"|"RESOLVED";assigneeId:string|null;version:number;createdAt:string;overdue:boolean};
export type ComplaintRefundAllocation={baseAmount:string;cleaningFee:string;serviceFee:string;taxAmount:string};
export type ComplaintResolution={decision:"HOST"|"FULL_REFUND"|"PARTIAL_REFUND";reason:string;resolvedAt:string;
  refundObligation?:{id:string;amount:string;status:"PENDING"|"PAID"};holdUntil?:string|null};
export type SettlementReview={originalHostAmount:string;offsetAmount:string;paidAmount:string;potentialExcessAmount:string};
export type ComplaintDetail=ComplaintRow&{settlementReviewStatus?:"PENDING";events:{id:string;action:"CREATED"|"RESPONDED"|"ASSIGNED"|"RESOLVED";message:string;createdAt:string}[];resolution:ComplaintResolution|null};
export type ComplaintBookingSnapshot={version:number;bookingStatus:string;paymentStatus:string;checkoutAt:string|null;
  amounts:ComplaintRefundAllocation&{totalAmount:string};approvedRefundAmounts:ComplaintRefundAllocation;refundedAmount:string;pendingRefundAmount:string;
  remainingRefundableAmounts:ComplaintRefundAllocation|null;reviewRequired:boolean};
export type AdminLateCase={caseType:"ADMIN_LATE_REFUND";caseLabel:"Admin mở sau hạn";actorId:string;evidenceNote:string;bookingVersionAtOpen:number;openedAt:string};
export type AdminComplaintDetail=Omit<ComplaintDetail,"resolution">&{resolution:(ComplaintResolution&{actorId:string;evidenceNote:string})|null;bookingSnapshot:ComplaintBookingSnapshot;lateCase?:AdminLateCase;settlementReview?:SettlementReview};
export type ComplaintResolved=ComplaintRow&{status:"RESOLVED";resolution:ComplaintResolution};
export type ComplaintBooking={bookingId:string;bookingCode:string;version:number;paymentStatus:string;bookingStatus:string};
export type ComplaintInput={expectedVersion:number;reason:string};
export type ComplaintResponseInput={expectedVersion:number;message:string};
export type ComplaintAssignInput=ComplaintInput&{assigneeId:string};
export type ComplaintResolveInput=ComplaintInput&{evidenceNote:string}&({decision:"HOST"}|{decision:"FULL_REFUND"|"PARTIAL_REFUND";expectedBookingVersion:number;allocation:ComplaintRefundAllocation});
type Scope="host"|"admin";
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const text=(v:unknown)=>typeof v==="string"&&!!v.trim()&&v.length<=500;
const instant=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const fields=["id","bookingId","reason","status","assigneeId","version","createdAt","overdue"];
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).length===allowed.length&&Object.keys(v).every(k=>allowed.includes(k));
function invalid():never{throw new ApiError(502,"INVALID_COMPLAINT_RESPONSE","Dữ liệu khiếu nại chưa hợp lệ. Chưa thể xác nhận kết quả xử lý.");}
function row(v:unknown):v is ComplaintRow&Record<string,unknown>{return object(v)&&uuid(v.id)&&uuid(v.bookingId)&&text(v.reason)&&["OPEN","RESOLVED"].includes(String(v.status))
  &&(v.assigneeId===null||uuid(v.assigneeId))&&Number.isInteger(v.version)&&(v.version as number)>=1&&(v.version as number)<=2147483647
  &&instant(v.createdAt)&&typeof v.overdue==="boolean"&&(v.status!=="RESOLVED"||v.overdue===false);}
function envelope(v:unknown):Record<string,unknown>{if(!object(v)||v.success!==true||typeof v.message!=="string")return invalid();return v;}
function resolution(v:unknown,admin:boolean):boolean{
  if(!object(v)||!["HOST","FULL_REFUND","PARTIAL_REFUND"].includes(String(v.decision))||!text(v.reason)||!instant(v.resolvedAt)
    ||admin&&(!uuid(v.actorId)||!text(v.evidenceNote)))return false;
  const refund=v.decision!=="HOST";
  if(!keys(v,["decision","reason","resolvedAt",...(admin?["actorId","evidenceNote"]:[]),...(refund?["refundObligation","holdUntil"]:[])]))return false;
  if(!refund)return true;
  const obligation=v.refundObligation;
  return object(obligation)&&keys(obligation,["id","amount","status"])&&uuid(obligation.id)&&typeof obligation.amount==="string"&&/^[1-9]\d{0,12}$/.test(obligation.amount)
    &&["PENDING","PAID"].includes(String(obligation.status))&&(v.decision==="FULL_REFUND"?v.holdUntil===null:instant(v.holdUntil));
}
function detail(v:unknown,admin:boolean):v is ComplaintDetail|AdminComplaintDetail {
  if(!row(v)||!object(v)||!keys(v,[...fields,"events","resolution",...(admin?["bookingSnapshot",...(v.lateCase!==undefined?["lateCase"]:[]),...(v.settlementReview!==undefined?["settlementReview"]:[])]:v.settlementReviewStatus!==undefined?["settlementReviewStatus"]:[])])||!Array.isArray(v.events)||admin&&!bookingSnapshot(v.bookingSnapshot))return false;
  if(!admin&&v.settlementReviewStatus!==undefined&&v.settlementReviewStatus!=="PENDING")return false;
  if(admin&&v.settlementReview!==undefined) {
    const review=v.settlementReview, names=["originalHostAmount","offsetAmount","paidAmount","potentialExcessAmount"];
    if(!object(review)||!keys(review,names)||!names.every(k=>typeof review[k]==="string"&&/^(0|[1-9]\d{0,12})$/.test(review[k] as string)))return false;
    if(BigInt(review.offsetAmount as string)<=BigInt(0)||BigInt(review.paidAmount as string)<=BigInt(0)||BigInt(review.originalHostAmount as string)!==BigInt(review.paidAmount as string)+BigInt(review.potentialExcessAmount as string))return false;
  }
  if(admin&&v.lateCase!==undefined) {
    const late=v.lateCase;
    if(!object(late)||!keys(late,["caseType","caseLabel","actorId","evidenceNote","bookingVersionAtOpen","openedAt"])
      ||late.caseType!=="ADMIN_LATE_REFUND"||late.caseLabel!=="Admin mở sau hạn"||!uuid(late.actorId)||!text(late.evidenceNote)
      ||!Number.isInteger(late.bookingVersionAtOpen)||(late.bookingVersionAtOpen as number)<1||(late.bookingVersionAtOpen as number)>2147483647||!instant(late.openedAt))return false;
  }
  const events=v.events;
  return events.every(e=>object(e)&&keys(e,["id","action","message","createdAt"])&&uuid(e.id)&&["CREATED","RESPONDED","ASSIGNED","RESOLVED"].includes(String(e.action))&&text(e.message)&&instant(e.createdAt))
    &&new Set(events.map(e=>e.id)).size===events.length&&(v.status==="OPEN"?v.resolution===null:resolution(v.resolution,admin));
}
function bookingSnapshot(v:unknown):v is ComplaintBookingSnapshot {
  const allocationKeys=["baseAmount","cleaningFee","serviceFee","taxAmount"],money=(n:unknown):n is string=>typeof n==="string"&&/^(0|[1-9]\d{0,12})$/.test(n);
  const allocation=(a:unknown):a is ComplaintRefundAllocation=>object(a)&&keys(a,allocationKeys)&&allocationKeys.every(k=>money(a[k]));
  if(!object(v)||!keys(v,["version","bookingStatus","paymentStatus","checkoutAt","amounts","approvedRefundAmounts","refundedAmount","pendingRefundAmount","remainingRefundableAmounts","reviewRequired"])
    ||!Number.isInteger(v.version)||(v.version as number)<1||(v.version as number)>2147483647
    ||!["PENDING_PAYMENT","PENDING_HOST_APPROVAL","CONFIRMED","CHECKED_IN","COMPLETED","CANCELLED","CANCELLED_BY_GUEST","CANCELLED_TIMEOUT","CANCELLED_HOST_TIMEOUT","REJECTED_BY_HOST"].includes(String(v.bookingStatus))
    ||!["NOT_CONFIGURED","PENDING","PAID","REFUNDED"].includes(String(v.paymentStatus))
    ||!(v.checkoutAt===null||instant(v.checkoutAt))||typeof v.reviewRequired!=="boolean"||!object(v.amounts)||!keys(v.amounts,[...allocationKeys,"totalAmount"])
    ||![...allocationKeys,"totalAmount"].every(k=>money((v.amounts as Record<string,unknown>)[k]))||!allocation(v.approvedRefundAmounts)
    ||!money(v.refundedAmount)||!money(v.pendingRefundAmount))return false;
  if(v.reviewRequired)return v.remainingRefundableAmounts===null;
  if(!instant(v.checkoutAt)||!allocation(v.remainingRefundableAmounts))return false;
  const amounts=v.amounts as ComplaintRefundAllocation&{totalAmount:string},approved=v.approvedRefundAmounts,remaining=v.remainingRefundableAmounts;
  return allocationKeys.every(k=>BigInt(amounts[k as keyof ComplaintRefundAllocation])===BigInt(approved[k as keyof ComplaintRefundAllocation])+BigInt(remaining[k as keyof ComplaintRefundAllocation]))
    &&allocationKeys.reduce((sum,k)=>sum+BigInt(amounts[k as keyof ComplaintRefundAllocation]),BigInt(0))===BigInt(amounts.totalAmount)
    &&BigInt(v.refundedAmount)+BigInt(v.pendingRefundAmount)<=allocationKeys.reduce((sum,k)=>sum+BigInt(approved[k as keyof ComplaintRefundAllocation]),BigInt(0));
}
const base=(scope:Scope)=>`/${scope}/finance/complaints`;
async function mutation(path:string,input:object,key:string):Promise<unknown>{return envelope(await managementRequest<unknown>(path,{method:"POST",data:input,headers:{"Idempotency-Key":key}})).data;}
function actionRow(v:unknown,id:string,version:number):ComplaintRow {
  if(!row(v)||!object(v)||!keys(v,fields)||v.id.toLowerCase()!==id.toLowerCase()||v.status!=="OPEN"||v.version!==version+1)return invalid();return v;
}
export const complaintsApi={
  async createAdminLate(bookingId:string,input:ComplaintInput&{evidenceNote:string},key:string):Promise<ComplaintRow> {
    const v=await mutation(`/admin/finance/bookings/${encodeURIComponent(bookingId)}/late-refund-cases`,input,key);
    if(!row(v)||!object(v)||!keys(v,[...fields,'caseType','caseLabel'])||v.bookingId.toLowerCase()!==bookingId.toLowerCase()||v.status!=='OPEN'||v.version!==1||v.caseType!=='ADMIN_LATE_REFUND'||v.caseLabel!=='Admin mở sau hạn')return invalid();return v;
  },
  async ownBooking(id:string,signal?:AbortSignal):Promise<ComplaintBooking> {
    const v=envelope(await managementRequest<unknown>(`/bookings/${encodeURIComponent(id)}`,{signal})).data;
    if(!object(v)||!uuid(v.bookingId)||v.bookingId.toLowerCase()!==id.toLowerCase()||typeof v.bookingCode!=="string"||!v.bookingCode
      ||!Number.isInteger(v.version)||(v.version as number)<1||(v.version as number)>2147483647||typeof v.paymentStatus!=="string"||typeof v.bookingStatus!=="string")return invalid();
    return v as ComplaintBooking;
  },
  async booking(bookingId:string,signal?:AbortSignal):Promise<ComplaintDetail[]> {
    const v=envelope(await managementRequest<unknown>(`/bookings/${encodeURIComponent(bookingId)}/complaints`,{signal}));
    if(!Array.isArray(v.data)||!v.data.every(r=>detail(r,false)&&r.bookingId.toLowerCase()===bookingId.toLowerCase())||new Set(v.data.map(r=>r.id)).size!==v.data.length)return invalid();
    return v.data as ComplaintDetail[];
  },
  async create(bookingId:string,input:ComplaintInput,key:string):Promise<ComplaintRow> {
    const v=await mutation(`/bookings/${encodeURIComponent(bookingId)}/complaints`,input,key);
    if(!row(v)||!object(v)||!keys(v,fields)||v.bookingId.toLowerCase()!==bookingId.toLowerCase()||v.status!=="OPEN"||v.version!==1||v.assigneeId!==null||v.overdue)return invalid();return v;
  },
  async list(scope:Scope,page:number,signal?:AbortSignal):Promise<Page<ComplaintRow>> {
    const v=envelope(await managementRequest<unknown>(base(scope),{params:{page,limit:20},signal}));
    if(!Array.isArray(v.data)||!object(v.meta)||v.meta.page!==page||v.meta.limit!==20||!Number.isSafeInteger(v.meta.total)||(v.meta.total as number)<0
      ||v.meta.totalPages!==Math.ceil((v.meta.total as number)/20)||v.data.length>20||v.data.length>(v.meta.total as number)
      ||!v.data.every(r=>row(r)&&object(r)&&keys(r,fields))||new Set(v.data.map(r=>r.id)).size!==v.data.length)return invalid();return v as Page<ComplaintRow>;
  },
  async hostDetail(id:string,signal?:AbortSignal):Promise<ComplaintDetail> {
    const v=envelope(await managementRequest<unknown>(`${base("host")}/${encodeURIComponent(id)}`,{signal})).data;
    if(!detail(v,false)||v.id.toLowerCase()!==id.toLowerCase())return invalid();return v as ComplaintDetail;
  },
  async adminDetail(id:string,signal?:AbortSignal):Promise<AdminComplaintDetail> {
    const v=envelope(await managementRequest<unknown>(`${base("admin")}/${encodeURIComponent(id)}`,{signal})).data;
    if(!detail(v,true)||v.id.toLowerCase()!==id.toLowerCase())return invalid();return v as AdminComplaintDetail;
  },
  async respond(id:string,input:ComplaintResponseInput,key:string):Promise<ComplaintRow> {
    return actionRow(await mutation(`${base("host")}/${encodeURIComponent(id)}/respond`,input,key),id,input.expectedVersion);
  },
  async assign(id:string,input:ComplaintAssignInput,key:string):Promise<ComplaintRow> {
    const r=actionRow(await mutation(`${base("admin")}/${encodeURIComponent(id)}/assign`,input,key),id,input.expectedVersion);
    if(r.assigneeId?.toLowerCase()!==input.assigneeId.toLowerCase())return invalid();return r;
  },
  async resolve(id:string,input:ComplaintResolveInput,key:string):Promise<ComplaintResolved> {
    const v=await mutation(`${base("admin")}/${encodeURIComponent(id)}/resolve`,input,key);
    if(!row(v)||!object(v)||!keys(v,[...fields,"resolution"])||v.id.toLowerCase()!==id.toLowerCase()||v.status!=="RESOLVED"
      ||v.version!==input.expectedVersion+1||!resolution(v.resolution,false)||(v.resolution as ComplaintResolution).reason!==input.reason.trim()
      ||(v.resolution as ComplaintResolution).decision!==input.decision)return invalid();return v as ComplaintResolved;
  },
};
