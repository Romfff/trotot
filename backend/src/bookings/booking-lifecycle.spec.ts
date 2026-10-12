import { describe,expect,it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { assertBookingTransition,bookingDeadline,roomTimestamp,validateBookingPrice } from './booking-lifecycle.js';
describe('approved booking lifecycle',()=>{
  const now=new Date('2026-10-05T03:00:00Z'),checkIn=new Date('2026-10-05T07:00:00Z'),checkOut=new Date('2026-10-06T05:00:00Z');
  const pending={bookingStatus:'PENDING_HOST_APPROVAL',paymentStatus:'NOT_CONFIGURED',version:1,expiresAt:new Date(now.getTime()+1000)};
  it('uses Vietnam configured room time',()=>expect(roomTimestamp('2026-10-05','14:00:00')).toEqual(checkIn));
  it('clips request/accepted deadlines, not same-day Instant Book',()=>{
    expect(bookingDeadline(now,false,'2026-10-05','14:00:00')).toEqual(checkIn);
    expect(bookingDeadline(new Date('2026-10-05T06:55:00Z'),false,'2026-10-05','14:00:00',true)).toEqual(checkIn);
    expect(bookingDeadline(new Date('2026-10-05T08:00:00Z'),true,'2026-10-05','14:00:00')).toEqual(new Date('2026-10-05T08:15:00Z'));
  });
  it.each(['accept','reject','cancel'] as const)('allows unpaid %s',action=>expect(()=>assertBookingTransition(pending,action,1,now,checkIn,checkOut)).not.toThrow());
  it.each(['accept','reject','cancel'] as const)('rejects late %s',action=>expect(()=>assertBookingTransition(pending,action,1,pending.expiresAt,checkIn,checkOut)).toThrow());
  it('rejects stale version',()=>expect(()=>assertBookingTransition(pending,'accept',2,now,checkIn,checkOut)).toThrow());
  it('only Host-request can accept',()=>expect(()=>assertBookingTransition({...pending,bookingStatus:'PENDING_PAYMENT'},'accept',1,now,checkIn,checkOut)).toThrow());
  for(const status of ['CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED_BY_GUEST','CANCELLED_TIMEOUT','REJECTED_BY_HOST']) {
    it(`forbids unpaid cancel/accept/reject for ${status}`,()=>{
      for(const action of ['accept','reject','cancel'] as const) expect(()=>assertBookingTransition({...pending,bookingStatus:status},action,1,now,checkIn,checkOut)).toThrow();
    });
  }
  it('paid check-in begins at check-in; checkout boundary closes it',()=>{
    const paid={...pending,bookingStatus:'CONFIRMED',paymentStatus:'PAID'};
    expect(()=>assertBookingTransition(paid,'check-in',1,checkIn,checkIn,checkOut)).not.toThrow();
    expect(()=>assertBookingTransition(paid,'check-in',1,now,checkIn,checkOut)).toThrow();
    expect(()=>assertBookingTransition(paid,'check-in',1,checkOut,checkIn,checkOut)).toThrow();
    expect(()=>assertBookingTransition({...paid,paymentStatus:'NOT_CONFIGURED'},'check-in',1,checkIn,checkIn,checkOut)).toThrow();
  });
  it('complete only paid checked-in at checkout or later',()=>{
    const paid={...pending,bookingStatus:'CHECKED_IN',paymentStatus:'PAID'};
    expect(()=>assertBookingTransition(paid,'complete',1,checkOut,checkIn,checkOut)).not.toThrow();
    expect(()=>assertBookingTransition(paid,'complete',1,checkIn,checkIn,checkOut)).toThrow();
    expect(()=>assertBookingTransition({...paid,bookingStatus:'CONFIRMED'},'complete',1,checkOut,checkIn,checkOut)).toThrow();
  });
  it('zero order/zero night/minimum rejected even if cleaning is charged',()=>{
    for(const [total,night,min] of [[0,0,1],[100,0,1],[100,10,11]]) expect(()=>validateBookingPrice({totalAmount:new Prisma.Decimal(total),nightlyPrices:[{price:new Prisma.Decimal(night)}]},min)).toThrow();
    expect(()=>validateBookingPrice({totalAmount:new Prisma.Decimal(100),nightlyPrices:[{price:new Prisma.Decimal(10)}]},10)).not.toThrow();
  });
});
