import { describe,expect,it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { bookingPaymentStatus } from './payment-status.js';
describe('S4 read-only payment recovery snapshot',()=>{
  const now=new Date('2026-10-06T05:00:00Z'),deadline=new Date('2026-10-06T05:15:00Z');
  const booking={id:'fixture',bookingCode:'FIXTURE',version:3,bookingStatus:'PENDING_PAYMENT',paymentStatus:'NOT_CONFIGURED',totalAmount:new Prisma.Decimal('999999999999999999'),expiresAt:deadline};
  it('uses exact integer VND and DB clock without leaking contact/policy or inventing provider proof',()=>{
    const source={...booking,guestPhone:'synthetic-private',policySnapshot:{secret:'private'}};
    expect(bookingPaymentStatus(source,now)).toEqual({bookingId:'fixture',bookingCode:'FIXTURE',version:3,bookingStatus:'PENDING_PAYMENT',paymentStatus:'NOT_CONFIGURED',amount:'999999999999999999',currency:'VND',serverTime:now.toISOString(),reservationExpiresAt:deadline.toISOString(),reservationExpired:false,providerConnected:false,payment:null});
    expect(source).toEqual({...booking,guestPhone:'synthetic-private',policySnapshot:{secret:'private'}});
  });
  it.each(['PENDING_PAYMENT','PENDING_HOST_APPROVAL'])('marks %s expired exactly at the deadline, without changing state',bookingStatus=>{
    const source={...booking,bookingStatus};
    expect(bookingPaymentStatus(source,new Date(deadline.getTime()-1)).reservationExpired).toBe(false);
    expect(bookingPaymentStatus(source,deadline).reservationExpired).toBe(true);
    expect(bookingPaymentStatus(source,new Date(deadline.getTime()+1)).reservationExpired).toBe(true);
    expect(source.bookingStatus).toBe(bookingStatus);expect(source.version).toBe(3);
  });
  it.each(['CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED_TIMEOUT','CANCELLED_HOST_TIMEOUT','CANCELLED_BY_GUEST','CANCELLED','REJECTED_BY_HOST'])('does not present an old deadline as active for %s',bookingStatus=>{
    const result=bookingPaymentStatus({...booking,bookingStatus,paymentStatus:'PAID'},new Date(deadline.getTime()+1000));
    expect(result).toMatchObject({paymentStatus:'PAID',reservationExpiresAt:null,reservationExpired:false,providerConnected:false,payment:null});
  });
});
