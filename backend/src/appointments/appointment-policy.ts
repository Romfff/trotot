import { BadRequestException, ConflictException } from '@nestjs/common';
import { positiveIntegerEnv } from '../config/environment.js';

export const appointmentStatuses = ['PENDING','ACCEPTED','REJECTED','COMPLETED','CANCELLED'] as const;
export type AppointmentStatus = typeof appointmentStatuses[number];
export type AppointmentAction = 'accept' | 'reject' | 'cancel' | 'complete';

export function appointmentTimestamp(date: string, time: string): Date {
  const value = new Date(`${date}T${time}+07:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)
    || !Number.isFinite(value.getTime()) || new Date(value.getTime()+7*3600000).toISOString().slice(0,19) !== `${date}T${time}`) {
    throw new BadRequestException({ errorCode:'INVALID_APPOINTMENT_TIME',message:'Ngày hoặc giờ hẹn không hợp lệ.' });
  }
  return value;
}
export function appointmentPolicy() {
  const open = process.env.APPOINTMENT_OPEN_TIME || '07:00:00';
  const close = process.env.APPOINTMENT_CLOSE_TIME || '21:00:00';
  appointmentTimestamp('2000-01-01',open); appointmentTimestamp('2000-01-01',close);
  if (open >= close) throw new Error('Invalid appointment opening hours');
  return { open,close,leadMinutes:positiveIntegerEnv('APPOINTMENT_MIN_LEAD_MINUTES',120),
    maxDays:positiveIntegerEnv('APPOINTMENT_MAX_DAYS',30),stepMinutes:positiveIntegerEnv('APPOINTMENT_STEP_MINUTES',30),
    tenantPending:positiveIntegerEnv('APPOINTMENT_TENANT_PENDING_LIMIT',5),propertyPending:positiveIntegerEnv('APPOINTMENT_PROPERTY_PENDING_LIMIT',20) };
}
export function validateAppointmentTime(date: string,time: string,now: Date) {
  const at = appointmentTimestamp(date,time), policy = appointmentPolicy();
  const minutes = Number(time.slice(0,2))*60+Number(time.slice(3,5));
  if (at.getTime() < now.getTime()+policy.leadMinutes*60000 || at.getTime()>now.getTime()+policy.maxDays*86400000
    || time < policy.open || time > policy.close || time.slice(6)!=='00' || minutes%policy.stepMinutes!==0) {
    throw new BadRequestException({ errorCode:'APPOINTMENT_TIME_NOT_ALLOWED',message:`Chọn giờ hẹn từ ${policy.open.slice(0,5)} đến ${policy.close.slice(0,5)}, theo bước ${policy.stepMinutes} phút. Lịch hẹn phải cách hiện tại ít nhất ${policy.leadMinutes} phút và không quá ${policy.maxDays} ngày.` });
  }
}
export function appointmentTransition(status:string,expected:string,action:AppointmentAction,host:boolean,at:Date,now:Date,reason?:string) {
  if (status!==expected) throw new ConflictException({ errorCode:'STALE_APPOINTMENT_STATUS',message:'Lịch hẹn đã đổi trạng thái. Hãy tải lại.',data:{currentStatus:status} });
  const allowed = host ? (['accept','reject'].includes(action) ? status==='PENDING' && now<at
    : action==='complete' ? status==='ACCEPTED' && now>at : status==='ACCEPTED' && Boolean(reason?.trim()))
    : action==='cancel' && ['PENDING','ACCEPTED'].includes(status) && now<at;
  if (!allowed) throw new ConflictException({ errorCode:'APPOINTMENT_ACTION_NOT_ALLOWED',message:'Không thể thực hiện thao tác ở trạng thái hoặc thời điểm hiện tại.' });
  return { accept:'ACCEPTED',reject:'REJECTED',complete:'COMPLETED',cancel:'CANCELLED' }[action];
}
