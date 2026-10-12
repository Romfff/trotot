import { describe,expect,it,vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { financeBucket,HostFinanceService } from './host-finance.service.js';
import { HostRevenueQueryDto } from './host-finance.dto.js';
import type { PrismaService } from '../database/prisma.service.js';
describe('S4 monthly revenue mapping and validation',()=>{
  it('fills all twelve empty months without inventing proceeds',async()=>{
    const query=vi.fn().mockResolvedValue([]),service=new HostFinanceService({$queryRaw:query} as unknown as PrismaService);
    const result=await service.revenue('fixture-host',2026);
    expect(result).toMatchObject({year:2026,timeZone:'Asia/Ho_Chi_Minh',basis:'LEDGER_POSTED',currency:'VND'});
    expect(result.months).toHaveLength(12);expect(result.months.map(m=>m.month)).toEqual(Array.from({length:12},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`));
    for(const m of result.months)expect(m).toMatchObject({roomAndCleaning:'0',commission:'0',refundRecognized:'0',hostEarned:'0',paidOut:'0',reviewCount:0,isComplete:true});
    expect(query).toHaveBeenCalledOnce();
  });
  it('preserves signed exact money above JS safe integers and flags incomplete months',async()=>{
    const query=vi.fn().mockResolvedValue([{month:2,roomAndCleaning:'9007199254740993',commission:'-110',refundRecognized:'1100',hostEarned:'-990',paidOut:'990',reviewCount:2n}]);
    const result=await new HostFinanceService({$queryRaw:query} as unknown as PrismaService).revenue('fixture-host',2026);
    expect(result.months[1]).toEqual({month:'2026-02',roomAndCleaning:'9007199254740993',commission:'-110',refundRecognized:'1100',hostEarned:'-990',paidOut:'990',reviewCount:2,isComplete:false});
    expect(result.months[0].isComplete).toBe(true);
  });
  it.each([1999,2101,2026.5,NaN,Infinity])('rejects invalid internal year %s before reading DB',async year=>{
    const query=vi.fn(),service=new HostFinanceService({$queryRaw:query} as unknown as PrismaService);
    await expect(service.revenue('fixture-host',year)).rejects.toMatchObject({status:400,response:{errorCode:'INVALID_REVENUE_YEAR'}});
    expect(query).not.toHaveBeenCalled();
  });
  it.each(['2000','2026','2100'])('accepts required HTTP year %s',async year=>{
    const dto=plainToInstance(HostRevenueQueryDto,{year});expect(await validate(dto)).toEqual([]);expect(dto.year).toBe(Number(year));
  });
  it.each([undefined,'',' 2026','2026.0','2e3',['2026','2027'],'1999','2101'])('rejects malformed HTTP year %j',async year=>{
    expect((await validate(plainToInstance(HostRevenueQueryDto,{year}))).length).toBeGreaterThan(0);
  });
});
describe('S4 payout holding classification',()=>{
  const completedAt=new Date('2026-10-01T00:00:00Z'),deadline=new Date('2026-10-04T00:00:00Z');
  const row={valid:true,openComplaint:false,bookingStatus:'COMPLETED',completedAt};
  it('holds until 72 hours and is eligible before deductions exactly at the deadline',()=>{
    expect(financeBucket(row,new Date(deadline.getTime()-1))).toBe('pendingHold');
    expect(financeBucket(row,deadline)).toBe('eligibleBeforeDeductions');
  });
  it('freezes the disputed booking even after the holding deadline',()=>{
    expect(financeBucket({...row,openComplaint:true},deadline)).toBe('frozen');
  });
  it('uses Admin no-show resolution as hold start without needing COMPLETED or bypassing complaints',()=>{
    const noShow={...row,bookingStatus:'CONFIRMED',completedAt:null,noShowResolvedAt:completedAt};
    expect(financeBucket(noShow,new Date(deadline.getTime()-1))).toBe('pendingHold');
    expect(financeBucket(noShow,deadline)).toBe('eligibleBeforeDeductions');
    expect(financeBucket({...noShow,openComplaint:true},deadline)).toBe('frozen');
  });
  it('does not invent money or a completion timestamp',()=>{
    expect(financeBucket({...row,valid:false},deadline)).toBe('REVIEW');
    expect(financeBucket({...row,completedAt:null},deadline)).toBe('REVIEW');
  });
  it('retained Guest cancellation waits from scheduled checkout and freezes an open dispute',()=>{
    const cancelled={...row,bookingStatus:'CANCELLED_BY_GUEST',completedAt:null,payoutHoldStart:completedAt};
    expect(financeBucket(cancelled,new Date(deadline.getTime()-1))).toBe('pendingHold');
    expect(financeBucket(cancelled,deadline)).toBe('eligibleBeforeDeductions');
    expect(financeBucket({...cancelled,openComplaint:true},deadline)).toBe('frozen');
    expect(financeBucket({...cancelled,payoutHoldStart:null},deadline)).toBe('waitingCompletion');
  });
  it.each(['CONFIRMED','CHECKED_IN','CANCELLED_BY_GUEST'])('waits for completion/financial resolution for %s',bookingStatus=>{
    expect(financeBucket({...row,bookingStatus,completedAt:null},deadline)).toBe('waitingCompletion');
  });
});
