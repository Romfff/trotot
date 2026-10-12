import { describe,expect,it } from 'vitest';
import { assertNoShowTime } from './no-show.service.js';
describe('S4 no-show room-time gates',()=>{
  const b={bookingStatus:'CONFIRMED',paymentStatus:'PAID'},checkIn=new Date('2026-10-01T07:00:00Z'),checkOut=new Date('2026-10-03T05:00:00Z');
  it('reports from check-in, resolves only from checkout',()=>{
    expect(()=>assertNoShowTime(b,new Date(checkIn.getTime()-1),checkIn,checkOut,false)).toThrow();
    expect(()=>assertNoShowTime(b,checkIn,checkIn,checkOut,false)).not.toThrow();
    expect(()=>assertNoShowTime(b,new Date(checkOut.getTime()-1),checkIn,checkOut,true)).toThrow();
    expect(()=>assertNoShowTime(b,checkOut,checkIn,checkOut,true)).not.toThrow();
  });
  it.each(['CHECKED_IN','COMPLETED','CANCELLED','PENDING_PAYMENT'])('rejects %s rather than changing booking state automatically',bookingStatus=>{
    expect(()=>assertNoShowTime({...b,bookingStatus},checkOut,checkIn,checkOut,true)).toThrow();
  });
  it('rejects unpaid or corrupt legacy room times',()=>{
    expect(()=>assertNoShowTime({...b,paymentStatus:'NOT_CONFIGURED'},checkOut,checkIn,checkOut,true)).toThrow();
    expect(()=>assertNoShowTime(b,checkOut,new Date(NaN),checkOut,true)).toThrow();
  });
});
