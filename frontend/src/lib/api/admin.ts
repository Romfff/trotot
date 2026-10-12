import { managementRequest } from './client';
import type { ApiEnvelope } from '@/lib/auth-types';
import type { Page } from './homestays';
export type AdminUser={id:string;fullName:string;role:string;status:string|null;createdAt:string|null;updatedAt:string|null};
export type Dashboard={from:string;to:string;timeZone:string;currency:string;serverTime:string;
  money:Record<'gmv'|'refundApproved'|'refundTransferred'|'refundPendingTransfer'|'gmvLessApprovedRefunds'|'commissionRecognized',string>;
  listings:Record<string,number>;deletedListings:number;users:{role:string;status:string|null;count:number}[];reviewCount:number;isComplete:boolean};
const moneyKeys=['gmv','refundApproved','refundTransferred','refundPendingTransfer','gmvLessApprovedRefunds','commissionRecognized'] as const;
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
export function validateDashboard(data:Dashboard):Dashboard {
  if(!data||!data.money||moneyKeys.some(key=>typeof data.money[key]!=='string'||! /^-?\d+$/.test(data.money[key]))
    ||data.timeZone!=='Asia/Ho_Chi_Minh'||data.currency!=='VND'||typeof data.isComplete!=='boolean'
    ||!count(data.reviewCount)||!count(data.deletedListings)||!data.listings||Object.values(data.listings).some(n=>!count(n))
    ||!Array.isArray(data.users)||data.users.some(row=>!row||!count(row.count)||typeof row.role!=='string'))
    throw new Error('Dữ liệu báo cáo chưa hợp lệ. Hãy thử tải lại.');
  return data;
}
export const adminApi={
  users:(page:number,role:string,status:string,signal?:AbortSignal)=>managementRequest<Page<AdminUser>>('/admin/users',{params:{page,limit:20,...(role?{role}:{}),...(status?{status}:{})},signal}),
  moderate:async(user:AdminUser,reason:string,signal?:AbortSignal)=>(await managementRequest<ApiEnvelope<AdminUser>>(`/admin/users/${user.id}/${user.status==='ACTIVE'?'ban':'unban'}`,{method:'POST',data:{expectedStatus:user.status,reason:reason.trim()},signal})).data,
  dashboard:async(from:string,to:string,signal?:AbortSignal)=>validateDashboard((await managementRequest<ApiEnvelope<Dashboard>>('/admin/dashboard',{params:{from,to},signal})).data),
};
