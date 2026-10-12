import 'reflect-metadata';
import { describe,expect,it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { calculateAdminRefund,type CancellationSnapshot } from '../bookings/booking-refund.js';
import { partialStayHoldStart,FINANCE_HOLD_MS } from './payout-policy.js';
import { financeBucket } from './host-finance.service.js';
import { ResolveComplaintDto } from './complaints.dto.js';
const snapshot:CancellationSnapshot={checkInDate:'2026-10-20',checkInTime:'14:00:00',cancellationPolicy:'MODERATE',
  baseAmount:'101',cleaningFee:'5',serviceFee:'5',taxAmount:'9',totalAmount:'120',commissionRate:'10',commissionAmount:'11',hostPayoutAmount:'95'};
const allocation={baseAmount:'51',cleaningFee:'3',serviceFee:'0',taxAmount:'5'};
describe('S4 Admin complaint individual refund allocation',()=>{
  it('keeps each Admin amount exact and derives retained commission HALF_UP from room plus cleaning only',()=>{
    const r=calculateAdminRefund(snapshot,allocation,'PARTIAL_REFUND');
    expect(r.refundTotal.toString()).toBe('59');expect(r.retainedCommission.toString()).toBe('5');expect(r.retainedHostPayout.toString()).toBe('47');
    expect(r.hostPayoutReduction.plus(r.commissionReversal).plus(r.refundServiceFee).plus(r.refundTaxAmount).eq(r.refundTotal)).toBe(true);
  });
  it('full refund removes all Host entitlement and includes service fee',()=>{
    const r=calculateAdminRefund(snapshot,{baseAmount:'101',cleaningFee:'5',serviceFee:'5',taxAmount:'9'},'FULL_REFUND');
    expect(r.refundTotal.toString()).toBe('120');expect(r.hostPayoutReduction.toString()).toBe('95');expect(r.retainedHostPayout.toString()).toBe('0');
  });
  it('successive partials reverse only the incremental commission, including HALF_UP boundary',()=>{
    const next={baseAmount:'1',cleaningFee:'0',serviceFee:'0',taxAmount:'0'};
    const first=calculateAdminRefund(snapshot,allocation,'PARTIAL_REFUND');
    const second=calculateAdminRefund(snapshot,next,'PARTIAL_REFUND',allocation);
    const together=calculateAdminRefund(snapshot,{...allocation,baseAmount:'52'},'PARTIAL_REFUND');
    expect(second.commissionReversal.toString()).toBe('0');
    expect(first.commissionReversal.plus(second.commissionReversal).eq(together.commissionReversal)).toBe(true);
    expect(first.hostPayoutReduction.plus(second.hostPayoutReduction).eq(together.hostPayoutReduction)).toBe(true);
  });
  it.each(['baseAmount','cleaningFee','taxAmount'] as const)('rejects cumulative %s exceeding original even when each individual request fits',key=>{
    const prior={baseAmount:'100',cleaningFee:'4',serviceFee:'0',taxAmount:'8'};
    const next={baseAmount:'0',cleaningFee:'0',serviceFee:'0',taxAmount:'0',[key]:'2'};
    expect(()=>calculateAdminRefund(snapshot,next,'PARTIAL_REFUND',prior)).toThrow();
  });
  it('counts approved pending obligations in cumulative cap and rejects service in partial or repeating original full allocation',()=>{
    expect(()=>calculateAdminRefund(snapshot,{...allocation,serviceFee:'1'},'PARTIAL_REFUND',allocation)).toThrow();
    expect(()=>calculateAdminRefund(snapshot,{baseAmount:'101',cleaningFee:'5',serviceFee:'5',taxAmount:'9'},'FULL_REFUND',allocation)).toThrow();
  });
  it('full after partial refunds precisely the unreserved remainder, reverses only remaining commission and Host entitlement',()=>{
    const first=calculateAdminRefund(snapshot,allocation,'PARTIAL_REFUND');
    const final=calculateAdminRefund(snapshot,{baseAmount:'50',cleaningFee:'2',serviceFee:'5',taxAmount:'4'},'FULL_REFUND',allocation);
    expect(final.refundTotal.toString()).toBe('61');
    expect(first.commissionReversal.plus(final.commissionReversal).toString()).toBe('11');
    expect(first.hostPayoutReduction.plus(final.hostPayoutReduction).toString()).toBe('95');
    expect(final.retainedHostPayout.isZero()).toBe(true);expect(final.retainedCommission.isZero()).toBe(true);
    expect(()=>calculateAdminRefund(snapshot,{baseAmount:'49',cleaningFee:'2',serviceFee:'5',taxAmount:'4'},'FULL_REFUND',allocation)).toThrow();
  });
  it.each(['-1','0.5','NaN','Infinity','1e2',' 1','01','10000000000000'])('rejects invalid integer amount %s',value=>{
    expect(()=>calculateAdminRefund(snapshot,{...allocation,baseAmount:value},'PARTIAL_REFUND')).toThrow();
  });
  it.each(['baseAmount','cleaningFee','serviceFee','taxAmount'] as const)('caps %s individually',key=>{
    expect(()=>calculateAdminRefund(snapshot,{...allocation,[key]:'121'},'PARTIAL_REFUND')).toThrow();
  });
  it('rejects partial service refund, zero total, full allocation labeled partial and partial allocation labeled full',()=>{
    for(const [a,d] of [[{...allocation,serviceFee:'1'},'PARTIAL_REFUND'],[{baseAmount:'0',cleaningFee:'0',serviceFee:'0',taxAmount:'0'},'PARTIAL_REFUND'],
      [{baseAmount:'101',cleaningFee:'5',serviceFee:'5',taxAmount:'9'},'PARTIAL_REFUND'],[allocation,'FULL_REFUND']] as const)
      expect(()=>calculateAdminRefund(snapshot,a,d)).toThrow();
  });
  it('rejects malformed source snapshot instead of guessing totals',()=>{
    expect(()=>calculateAdminRefund({...snapshot,commissionAmount:'10'},allocation,'PARTIAL_REFUND')).toThrow();
  });
  it('DTO preserves old HOST contract; refund branch requires version and each amount',async()=>{
    const body={expectedVersion:1,decision:'HOST',reason:'Reason',evidenceNote:'Evidence'};
    expect(await validate(plainToInstance(ResolveComplaintDto,body))).toHaveLength(0);
    expect((await validate(plainToInstance(ResolveComplaintDto,{...body,decision:'FULL_REFUND'}))).map(e=>e.property)).toEqual(expect.arrayContaining(['expectedBookingVersion','allocation']));
    expect(await validate(plainToInstance(ResolveComplaintDto,{...body,decision:'PARTIAL_REFUND',expectedBookingVersion:1,allocation}))).toHaveLength(0);
    expect(await validate(plainToInstance(ResolveComplaintDto,{...body,decision:'PARTIAL_REFUND',expectedBookingVersion:1,allocation:{...allocation,baseAmount:51}}))).not.toHaveLength(0);
  });
});
describe('S4 partial stay immutable hold boundary',()=>{
  const checkout=new Date('2026-10-20T12:00:00+07:00');
  it.each([-3600000,3600000])('Admin resolves at checkout offset %i ms: use later clock and hold exact 72h',offset=>{
    const resolution=new Date(checkout.getTime()+offset),start=partialStayHoldStart(checkout,resolution),end=new Date(start.getTime()+FINANCE_HOLD_MS);
    expect(start.getTime()).toBe(Math.max(checkout.getTime(),resolution.getTime()));
    const row={valid:true,openComplaint:false,bookingStatus:'CHECKED_IN',completedAt:null,payoutHoldStart:start};
    expect(financeBucket(row,new Date(end.getTime()-60000))).toBe('pendingHold');
    expect(financeBucket(row,end)).toBe('eligibleBeforeDeductions');expect(financeBucket(row,new Date(end.getTime()+60000))).toBe('eligibleBeforeDeductions');
    expect(row.bookingStatus).toBe('CHECKED_IN');expect(row.completedAt).toBeNull();
  });
  it('does not mutate dates or accept an invalid clock',()=>{
    const before=checkout.toISOString();partialStayHoldStart(checkout,new Date());expect(checkout.toISOString()).toBe(before);
    expect(()=>partialStayHoldStart(new Date(NaN),checkout)).toThrow();expect(()=>partialStayHoldStart(checkout,new Date(NaN))).toThrow();
  });
});
