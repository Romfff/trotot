import {managementRequest} from './client';
import {ApiError} from '@/lib/auth-types';
import type {Page} from './homestays';
export type HostDebt={id:string;bookingId:string;amount:string;remainingAmount:string;createdAt:string};
export type HostSettlement={id:string;cutoff:string;grossEligible:string;debtOffset:string;netPayout:string;batchId:string|null;status:'OFFSET'|'ALLOCATED'|'REVERSED';createdAt:string};
export type SettlementCreated=Omit<HostSettlement,'status'|'createdAt'>&{hostId:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const money=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9]\d{0,17})$/.test(v);
const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function invalid():never{throw new ApiError(502,'INVALID_SETTLEMENT_RESPONSE','Dữ liệu công nợ chưa hợp lệ. Hãy tải lại; chưa thể xác nhận kết quả ghi sổ.');}
function envelope(v:unknown){if(!object(v)||v.success!==true||typeof v.message!=='string')return invalid();return v;}
const debt=(v:unknown):v is HostDebt=>object(v)&&uuid(v.id)&&uuid(v.bookingId)&&money(v.amount)&&money(v.remainingAmount)&&BigInt(v.remainingAmount)<=BigInt(v.amount)&&date(v.createdAt);
function totals(v:Record<string,unknown>){return money(v.grossEligible)&&money(v.debtOffset)&&money(v.netPayout)&&BigInt(v.grossEligible)===BigInt(v.debtOffset)+BigInt(v.netPayout)&&((v.netPayout==='0'&&v.batchId===null)||(v.netPayout!=='0'&&uuid(v.batchId)));}
const settlement=(v:unknown):v is HostSettlement=>object(v)&&uuid(v.id)&&date(v.cutoff)&&date(v.createdAt)&&totals(v)&&['OFFSET','ALLOCATED','REVERSED'].includes(String(v.status));
async function list<T>(kind:string,page:number,check:(v:unknown)=>v is T,signal?:AbortSignal):Promise<Page<T>>{
 const v=envelope(await managementRequest<unknown>(`/host/finance/${kind}`,{params:{page,limit:20},signal}));
 if(!object(v.meta)||v.meta.page!==page||v.meta.limit!==20||!Number.isSafeInteger(v.meta.total)||(v.meta.total as number)<0||v.meta.totalPages!==Math.ceil((v.meta.total as number)/20)||!Array.isArray(v.data)||v.data.length!==Math.min(20,Math.max(0,(v.meta.total as number)-(page-1)*20))||!v.data.every(check))return invalid();
 return v as Page<T>;
}
export const debtSettlementsApi={
 debts:(page:number,signal?:AbortSignal)=>list('debts',page,debt,signal),
 settlements:(page:number,signal?:AbortSignal)=>list('settlements',page,settlement,signal),
 async create(input:{hostId:string;reason:string},key:string):Promise<SettlementCreated>{
  const v=envelope(await managementRequest<unknown>('/admin/finance/settlements',{method:'POST',data:input,headers:{'Idempotency-Key':key}})).data;
  if(!object(v)||!uuid(v.id)||!uuid(v.hostId)||v.hostId.toLowerCase()!==input.hostId.toLowerCase()||!date(v.cutoff)||!totals(v))return invalid();return v as SettlementCreated;
 },
 async reverse(id:string,reason:string,key:string){
  const v=envelope(await managementRequest<unknown>(`/admin/finance/settlements/${encodeURIComponent(id)}/reverse`,{method:'POST',data:{reason},headers:{'Idempotency-Key':key}})).data;
  if(!object(v)||v.id!==id.toLowerCase()||v.status!=='REVERSED'||!Number.isSafeInteger(v.reversedOffsets)||(v.reversedOffsets as number)<1)return invalid();return v;
 },
};
