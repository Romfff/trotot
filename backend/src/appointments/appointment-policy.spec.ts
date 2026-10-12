import { afterEach,describe,expect,it,vi } from 'vitest';
import { appointmentPolicy,appointmentTimestamp,appointmentTransition,validateAppointmentTime } from './appointment-policy.js';

afterEach(()=>vi.unstubAllEnvs());
describe('Appointment Vietnam policy',()=>{
  it('preserves Vietnam date/time rather than interpreting it as UTC',()=>{
    expect(appointmentTimestamp('2026-10-06','07:00:00').toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(appointmentPolicy()).toMatchObject({leadMinutes:120,maxDays:30,stepMinutes:30,open:'07:00:00',close:'21:00:00',tenantPending:5,propertyPending:20});
  });
  it.each([['2026-02-30','12:00:00'],['2026-10-06','24:00:00'],['2026-10-6','07:00:00'],['2026-10-06','07:00']])('rejects impossible/ambiguous date %s %s',(date,time)=>{
    expect(()=>appointmentTimestamp(date,time)).toThrow();
  });
  it('enforces lead/max days, exact slots and opening hours without rounding',()=>{
    const now=new Date('2026-10-05T23:00:00Z'); // 06:00 Vietnam
    expect(()=>validateAppointmentTime('2026-10-06','08:00:00',now)).not.toThrow();
    for(const [date,time] of [['2026-10-06','07:30:00'],['2026-10-06','08:15:00'],['2026-10-06','08:00:01'],['2026-10-06','21:30:00'],['2026-11-06','08:00:00']]) expect(()=>validateAppointmentTime(date,time,now)).toThrow();
    vi.stubEnv('APPOINTMENT_MIN_LEAD_MINUTES','60');
    expect(()=>validateAppointmentTime('2026-10-06','07:00:00',now)).not.toThrow();
  });
  it('requires current status and applies actor/time transitions',()=>{
    const at=appointmentTimestamp('2026-10-06','12:00:00'),before=new Date(at.getTime()-1),after=new Date(at.getTime()+1);
    expect(appointmentTransition('PENDING','PENDING','accept',true,at,before)).toBe('ACCEPTED');
    expect(appointmentTransition('PENDING','PENDING','reject',true,at,before)).toBe('REJECTED');
    expect(appointmentTransition('ACCEPTED','ACCEPTED','complete',true,at,after)).toBe('COMPLETED');
    expect(appointmentTransition('ACCEPTED','ACCEPTED','cancel',false,at,before)).toBe('CANCELLED');
    expect(appointmentTransition('ACCEPTED','ACCEPTED','cancel',true,at,after,'reason')).toBe('CANCELLED');
    for(const fn of [()=>appointmentTransition('ACCEPTED','PENDING','accept',true,at,before),()=>appointmentTransition('ACCEPTED','ACCEPTED','complete',true,at,before),()=>appointmentTransition('ACCEPTED','ACCEPTED','cancel',false,at,after),()=>appointmentTransition('ACCEPTED','ACCEPTED','cancel',true,at,before,' '),()=>appointmentTransition('PENDING','PENDING','accept',true,at,after)]) expect(fn).toThrow();
  });
  it.each([30,15])('explains the configured %i-minute step without changing the error code',step=>{
    vi.stubEnv('APPOINTMENT_STEP_MINUTES',String(step));
    try {
      validateAppointmentTime('2026-10-10','10:46:00',new Date('2026-10-09T00:00:00Z'));
      throw new Error('Expected appointment rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const response=(error as import('@nestjs/common').BadRequestException).getResponse();
      expect(response).toMatchObject({errorCode:'APPOINTMENT_TIME_NOT_ALLOWED',message:expect.stringContaining(`theo bước ${step} phút`)});
    }
    expect(()=>validateAppointmentTime('2026-10-10','10:30:00',new Date('2026-10-09T00:00:00Z'))).not.toThrow();
    expect(()=>validateAppointmentTime('2026-10-10','11:00:00',new Date('2026-10-09T00:00:00Z'))).not.toThrow();
  });
});
