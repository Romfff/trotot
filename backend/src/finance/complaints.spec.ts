import { describe,expect,it,vi } from 'vitest';
import { assertComplaintWindow,ComplaintsService } from './complaints.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';
import type { HomestayCalendarService } from '../homestays/homestay-calendar.service.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import { financeBucket } from './host-finance.service.js';
describe('S4 complaint window',()=>{
  const completedAt=new Date('2026-10-01T00:00:00Z'),end=new Date('2026-10-04T00:00:00Z');
  const booking={paymentStatus:'PAID',bookingStatus:'COMPLETED',completedAt};
  it.each(['CONFIRMED','CHECKED_IN'])('allows paid %s before completion is recorded',status=>{
    expect(()=>assertComplaintWindow({...booking,bookingStatus:status,completedAt:null},end)).not.toThrow();
  });
  it('accepts until just before 72 hours and closes exactly when payout hold ends',()=>{
    expect(()=>assertComplaintWindow(booking,new Date(end.getTime()-1))).not.toThrow();
    expect(()=>assertComplaintWindow(booking,end)).toThrow();
    expect(()=>assertComplaintWindow(booking,new Date(end.getTime()+1))).toThrow();
    const row={...booking,valid:true,openComplaint:false};
    expect(financeBucket(row,new Date(end.getTime()-1))).toBe('pendingHold');
    expect(financeBucket(row,end)).toBe('eligibleBeforeDeductions');
    expect(financeBucket({...row,openComplaint:true},end)).toBe('frozen');
  });
  it('does not infer a timestamp for legacy completed bookings',()=>{
    expect(()=>assertComplaintWindow({...booking,completedAt:null},end)).toThrow();
  });
  it.each(['NOT_CONFIGURED','UNPAID','REFUNDED'])('rejects %s even with completion',paymentStatus=>{
    expect(()=>assertComplaintWindow({...booking,paymentStatus},end)).toThrow();
  });
  it.each(['PENDING_PAYMENT','CANCELLED','REJECTED_BY_HOST'])('rejects paid flag with %s state',bookingStatus=>{
    expect(()=>assertComplaintWindow({...booking,bookingStatus},end)).toThrow();
  });
});
it('Admin late-case success keeps completed booking untouched and evidence out of participant audit (transaction fixture)',async()=>{
  const id='00000000-0000-4000-8000-000000000001',createdAt=new Date('2026-10-07T00:00:00Z');
  const booking={id,version:7,homestayUnitId:id,guestId:id,bookingStatus:'COMPLETED',paymentStatus:'PAID',unit:{property:{hostId:id}}};
  const row={id,bookingId:id,guestId:id,hostId:id,reason:'Reason',status:'OPEN',assigneeId:null,version:1,createdAt,overdue:false};
  const query=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{eligible:true}])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([row]).mockResolvedValueOnce([{id}]);
  const update=vi.fn(),execute=vi.fn().mockResolvedValue(1);
  const tx={booking:{findUnique:vi.fn().mockResolvedValue({homestayUnitId:id}),findUniqueOrThrow:vi.fn().mockResolvedValue(booking),update},$queryRaw:query,$executeRaw:execute} as unknown as Prisma.TransactionClient;
  const run=vi.fn(async(_actor:string,_operation:string,_key:string,_raw:unknown,apply:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>apply(tx));
  const service=new ComplaintsService({} as PrismaService,{run} as unknown as BookingIdempotencyService,{} as HomestayCalendarService,{} as BookingsService);
  const raw={expectedVersion:7,reason:' Reason ',evidenceNote:' Private proof '};
  expect(await service.createAdminLate(id,id,raw,'same-key',raw)).toMatchObject({id,caseType:'ADMIN_LATE_REFUND',caseLabel:'Admin mở sau hạn',status:'OPEN',version:1});
  expect(run).toHaveBeenCalledWith(id,'ADMIN_LATE_REFUND_CREATE','same-key',{bookingId:id,body:raw},expect.any(Function));
  expect(update).not.toHaveBeenCalled();expect(query.mock.calls.at(-1)!.slice(1)).not.toContain('Private proof');
  expect(execute.mock.calls.at(-1)!.slice(1)).toContain('Private proof');expect(booking.bookingStatus).toBe('COMPLETED');
});
