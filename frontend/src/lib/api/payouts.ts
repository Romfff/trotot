import { managementRequest } from "./client";
import { ApiError } from "@/lib/auth-types";
import type { Page } from "./homestays";

// Financial values stay exact server strings. Approval/export never mean PAID.
export type PayoutSummary = { id:string; hostId:string; amount:string; status:"DRAFT"|"APPROVED"|"CANCELLED"|"PAID"; version:number; cutoff:string };
export type PayoutListItem = PayoutSummary & { createdAt:string; bankCode:string; accountNumber:string };
export type PayoutEvent = { action:"CREATED"|"APPROVED"|"CANCELLED"|"PAID"; createdAt:string };
export type HostPayoutDetail = PayoutListItem & {
  items:{bookingId:string;amount:string;eligibleAt:string;status:"ACTIVE"|"RELEASED"}[];
  events:PayoutEvent[];
  confirmation:{confirmedAt:string}|null;
};
export type AdminPayoutDetail = Omit<HostPayoutDetail,"events"|"confirmation"> & {
  operations:{canApprove:boolean;canExport:boolean;canConfirmPaid:boolean;canCancel:boolean;reviewRequired:boolean};
  accountName:string; bankAccountId:string; bankVersion:number;
  events:(PayoutEvent & {actorId:string;reason:string})[];
  confirmation:{confirmedAt:string;actorId:string;bankReference:string;evidenceNote:string;reason:string}|null;
};
export type PayoutAction = {expectedVersion:number;reason:string};
export type PayoutTransferEvidence = PayoutAction & {bankReference:string;evidenceNote:string};
export type PayoutPaidResult = {id:string;status:"PAID";version:number;amount:string;message:string};
export type PayoutCsvExport = {filename:string;encoding:"UTF-8";csv:string};
const admin="/admin/finance/payouts";
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const money=(value:unknown):value is string=>typeof value==="string"&&/^[1-9]\d{0,17}$/.test(value);
const instant=(value:unknown):value is string=>typeof value==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function invalidHostPayout():never {
  throw new ApiError(502,"INVALID_PAYOUT_RESPONSE","Dữ liệu lô chi trả chưa hợp lệ. Hãy tải lại; chưa thể xác nhận khoản chi trả.");
}
function hostRow(value:unknown,hostId?:string):value is PayoutListItem {
  return record(value)&&uuid(value.id)&&uuid(value.hostId)&&(!hostId||value.hostId.toLowerCase()===hostId.toLowerCase())&&money(value.amount)
    &&typeof value.status==="string"&&["DRAFT","APPROVED","CANCELLED","PAID"].includes(value.status)&&Number.isSafeInteger(value.version)
    &&(value.version as number)>=1&&(value.version as number)<=2147483647&&instant(value.cutoff)&&instant(value.createdAt)
    &&typeof value.bankCode==="string"&&/^[A-Za-z0-9_-]{1,20}$/.test(value.bankCode)
    &&typeof value.accountNumber==="string"&&/^\*{4}[A-Za-z0-9]{1,4}$/.test(value.accountNumber)
    &&!["accountName","bankAccountId","bankVersion","operations"].some(key=>key in value);
}
function hostList(value:unknown,page:number,hostId?:string):Page<PayoutListItem> {
  if(!record(value)||value.success!==true||typeof value.message!=="string"||!Array.isArray(value.data)||!record(value.meta))return invalidHostPayout();
  const {data,meta}=value;
  if(!Number.isSafeInteger(page)||page<1||meta.page!==page||meta.limit!==20||!Number.isSafeInteger(meta.total)||(meta.total as number)<0||meta.totalPages!==Math.ceil((meta.total as number)/20)
    ||data.length!==Math.min(20,Math.max(0,(meta.total as number)-(page-1)*20))||!data.every(row=>hostRow(row,hostId))||new Set(data.map(row=>row.id)).size!==data.length)return invalidHostPayout();
  return value as Page<PayoutListItem>;
}
function hostDetail(value:unknown,id:string,hostId?:string):HostPayoutDetail {
  if(!record(value)||value.success!==true||typeof value.message!=="string"||!hostRow(value.data,hostId))return invalidHostPayout();
  const data=value.data as HostPayoutDetail;
  if(data.id.toLowerCase()!==id.toLowerCase()||!Array.isArray(data.items)||data.items.length===0||!Array.isArray(data.events)
    ||!data.items.every(item=>record(item)&&uuid(item.bookingId)&&money(item.amount)&&instant(item.eligibleAt)
      &&item.status===(data.status==="CANCELLED"?"RELEASED":"ACTIVE"))
    ||new Set(data.items.map(item=>item.bookingId)).size!==data.items.length)return invalidHostPayout();
  // Snapshot integrity only; not a wallet balance or a permission to withdraw.
  if(data.items.reduce((total,item)=>total+BigInt(item.amount),BigInt(0))!==BigInt(data.amount))return invalidHostPayout();
  if(!data.events.every(event=>record(event)&&["CREATED","APPROVED","CANCELLED","PAID"].includes(event.action)&&instant(event.createdAt)
    &&!("actorId" in event)&&!("reason" in event)))return invalidHostPayout();
  const sequence=data.events.map(event=>event.action).join(",");
  const validSequences={DRAFT:["CREATED"],APPROVED:["CREATED,APPROVED"],CANCELLED:["CREATED,CANCELLED","CREATED,APPROVED,CANCELLED"],PAID:["CREATED,APPROVED,PAID"]};
  if(!validSequences[data.status].includes(sequence))return invalidHostPayout();
  if(data.status==="PAID") {
    if(!record(data.confirmation)||!instant(data.confirmation.confirmedAt)||Object.keys(data.confirmation).some(key=>key!=="confirmedAt"))return invalidHostPayout();
  }else if(data.confirmation!==null)return invalidHostPayout();
  return data;
}
export const hostPayoutsApi = {
  list:async(page:number,signal?:AbortSignal,hostId?:string)=>hostList(await managementRequest<unknown>("/host/payouts",{params:{page,limit:20},signal}),page,hostId),
  detail:async(id:string,signal?:AbortSignal,hostId?:string)=>hostDetail(await managementRequest<unknown>(`/host/payouts/${encodeURIComponent(id)}`,{signal}),id,hostId),
};
function adminDetail(value:unknown,id:string):AdminPayoutDetail {
  if(!record(value)||!record(value.data))return invalidHostPayout();
  const data=value.data;
  if(typeof data.accountNumber!=="string"||!/^[A-Za-z0-9]{1,50}$/.test(data.accountNumber)
    ||typeof data.accountName!=="string"||!data.accountName.trim()||data.accountName.length>150||!uuid(data.bankAccountId)
    ||!Number.isInteger(data.bankVersion)||(data.bankVersion as number)<1||(data.bankVersion as number)>2147483647
    ||!record(data.operations)||!["canApprove","canExport","canConfirmPaid","canCancel","reviewRequired"].every(key=>typeof (data.operations as Record<string,unknown>)[key]==="boolean")
    ||!Array.isArray(data.events)||!data.events.every(event=>record(event)&&uuid(event.actorId)&&typeof event.reason==="string"&&!!event.reason.trim()&&event.reason.length<=500))return invalidHostPayout();
  if(data.confirmation!==null&&(!record(data.confirmation)||!uuid(data.confirmation.actorId)
    ||!["bankReference","evidenceNote","reason"].every(key=>typeof (data.confirmation as Record<string,unknown>)[key]==="string"
      &&!!String((data.confirmation as Record<string,unknown>)[key]).trim()
      &&String((data.confirmation as Record<string,unknown>)[key]).length<=(key==="bankReference"?200:500))))return invalidHostPayout();
  hostDetail({...value,data:{id:data.id,hostId:data.hostId,amount:data.amount,status:data.status,version:data.version,cutoff:data.cutoff,
    createdAt:data.createdAt,bankCode:data.bankCode,accountNumber:`****${data.accountNumber.slice(-4)}`,items:data.items,
    events:data.events.map(event=>({action:event.action,createdAt:event.createdAt})),
    confirmation:record(data.confirmation)?{confirmedAt:data.confirmation.confirmedAt}:null}},id);
  return data as AdminPayoutDetail;
}
function actionResult(value:unknown,id:string,status:"APPROVED"|"CANCELLED"|"PAID",expectedVersion:number) {
  if(!record(value)||value.success!==true||typeof value.message!=="string"||!record(value.data))return invalidHostPayout();
  const data=value.data;
  if(!uuid(data.id)||data.id.toLowerCase()!==id.toLowerCase()||data.status!==status
    ||!Number.isInteger(data.version)||data.version!==expectedVersion+1||(data.version as number)>2147483647)return invalidHostPayout();
  if(status==="PAID"&&(!money(data.amount)||typeof data.message!=="string"||!data.message.trim()))return invalidHostPayout();
  return data as {id:string;status:typeof status;version:number};
}
export const adminPayoutsApi = {
  list:async(page:number,signal?:AbortSignal)=>hostList(await managementRequest<unknown>(admin,{params:{page,limit:20},signal}),page),
  detail:async(id:string,signal?:AbortSignal)=>adminDetail(await managementRequest<unknown>(`${admin}/${encodeURIComponent(id)}`,{signal}),id),
  create:async(input:{hostId:string;reason:string},key:string)=>{
    const value=await managementRequest<unknown>(admin,{method:"POST",data:input,headers:{"Idempotency-Key":key}});
    if(!record(value)||value.success!==true||typeof value.message!=="string"||!record(value.data))return invalidHostPayout();
    const data=value.data;
    if(!uuid(data.id)||!uuid(data.hostId)||data.hostId.toLowerCase()!==input.hostId.toLowerCase()
      ||data.status!=="DRAFT"||data.version!==1||!money(data.amount)||!instant(data.cutoff))return invalidHostPayout();
    return data as PayoutSummary;
  },
  approve:async(id:string,input:PayoutAction,key:string)=>actionResult(await managementRequest<unknown>(`${admin}/${encodeURIComponent(id)}/approve`,{
    method:"POST",data:input,headers:{"Idempotency-Key":key},
  }),id,"APPROVED",input.expectedVersion),
  cancel:async(id:string,input:PayoutAction,key:string)=>actionResult(await managementRequest<unknown>(`${admin}/${encodeURIComponent(id)}/cancel`,{
    method:"POST",data:input,headers:{"Idempotency-Key":key},
  }),id,"CANCELLED",input.expectedVersion),
  exportCsv:async(id:string,signal?:AbortSignal)=>{
    const value=await managementRequest<unknown>(`${admin}/${encodeURIComponent(id)}/export`,{signal});
    if(!record(value)||value.success!==true||typeof value.message!=="string"||!record(value.data))return invalidHostPayout();
    const data=value.data;
    if(!uuid(id)||typeof data.filename!=="string"||!new RegExp(`^payout-${id.toLowerCase()}-v[1-9]\\d{0,9}\\.csv$`).test(data.filename)
      ||data.encoding!=="UTF-8"||typeof data.csv!=="string"||!data.csv.startsWith('\ufeff"payout_id","host_id",')||!data.csv.endsWith("\r\n"))return invalidHostPayout();
    return data as PayoutCsvExport;
  },
  confirmPaid:async(id:string,input:PayoutTransferEvidence,key:string)=>actionResult(await managementRequest<unknown>(`${admin}/${encodeURIComponent(id)}/confirm-paid`,{
    method:"POST",data:input,headers:{"Idempotency-Key":key},
  }),id,"PAID",input.expectedVersion) as PayoutPaidResult,
};
