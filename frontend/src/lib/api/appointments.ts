import { managementRequest } from './client';
import type { ApiEnvelope } from '@/lib/auth-types';
import type { AppointmentActionDto, AppointmentResponseDto, CreateAppointmentDto, HostAppointmentResponseDto, NotificationResponseDto } from './appointment-types.generated';
type Page<T> = ApiEnvelope<T[]> & {meta:{page:number;limit:number;total:number;totalPages:number;unreadCount?:number}};
export const appointmentsApi = {
  create: (body:CreateAppointmentDto,key:string) => managementRequest<ApiEnvelope<AppointmentResponseDto>>('/appointments',{method:'POST',data:body,headers:{'Idempotency-Key':key}}),
  list: (page:number,status:string,host=false,signal?:AbortSignal) => managementRequest<Page<AppointmentResponseDto|HostAppointmentResponseDto>>(`${host?'/host':''}/appointments`,{params:{page,limit:20,...(status?{status}:{})},signal}),
  read: (id:string,host=false,signal?:AbortSignal) => managementRequest<ApiEnvelope<AppointmentResponseDto|HostAppointmentResponseDto>>(`${host?'/host':''}/appointments/${id}`,{signal}),
  action: (id:string,action:'accept'|'reject'|'cancel'|'complete',body:AppointmentActionDto,host=false) => managementRequest<ApiEnvelope<AppointmentResponseDto|HostAppointmentResponseDto>>(`${host?'/host':''}/appointments/${id}/${action}`,{method:'POST',data:body}),
  notifications: (page:number,signal?:AbortSignal) => managementRequest<Page<NotificationResponseDto>>('/notifications',{params:{page,limit:20},signal}),
  markRead: (id:string) => managementRequest<ApiEnvelope<NotificationResponseDto>>(`/notifications/${id}/read`,{method:'POST',data:{}}),
};
