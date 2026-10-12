import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Prisma,type Booking } from '../generated/prisma/client.js';
import { readVnpayPaymentProof } from './vnpay-payment-proof.js';
import { verifiedPaymentSource } from '../finance/payment-source.js';
vi.mock('../finance/payment-source.js',()=>({verifiedPaymentSource:vi.fn()}));
describe('S4 immutable provider proof reads, not PAID flag',()=>{
  const booking={id:'fixture',paymentStatus:'PAID'} as Booking;
  const row={sessionId:'fixture-session',journalId:'fixture-journal',hostId:'fixture-host',amount:'1100',paidAt:new Date('2026-10-07T10:00:00Z')};
  const query=vi.fn(),tx={$queryRaw:query} as unknown as Prisma.TransactionClient;
  beforeEach(()=>{vi.resetAllMocks();query.mockResolvedValue([row]);vi.mocked(verifiedPaymentSource).mockResolvedValue(row.journalId);});
  it.each(['PENDING','NOT_CONFIGURED'])('does not look for evidence for %s',async paymentStatus=>{
    expect(await readVnpayPaymentProof(tx,{...booking,paymentStatus})).toBeNull();expect(query).not.toHaveBeenCalled();
  });
  it.each([{rows:[]},{rows:[row,row]}])('requires exactly one matching receipt (%j)',async({rows})=>{
    query.mockResolvedValue(rows);expect(await readVnpayPaymentProof(tx,booking)).toBeNull();expect(verifiedPaymentSource).not.toHaveBeenCalled();
  });
  it('keeps proof private and exact after later cancellation/refund',async()=>{
    const payment=await readVnpayPaymentProof(tx,{...booking,paymentStatus:'REFUNDED'});
    expect(payment).toEqual({provider:'VNPAY_SANDBOX',verified:true,sessionId:row.sessionId,amountVnd:'1100',paidAt:row.paidAt.toISOString()});
    expect(verifiedPaymentSource).toHaveBeenCalledWith(tx,expect.objectContaining({paymentStatus:'REFUNDED'}),row.hostId);
    for(const key of ['journalId','hostId','merchantCode','transactionNo','signature'])expect(payment).not.toHaveProperty(key);
  });
  it('does not accept another journal or source needing financial review',async()=>{
    vi.mocked(verifiedPaymentSource).mockResolvedValueOnce('different');expect(await readVnpayPaymentProof(tx,booking)).toBeNull();
    vi.mocked(verifiedPaymentSource).mockRejectedValueOnce(new ConflictException('review'));expect(await readVnpayPaymentProof(tx,booking)).toBeNull();
  });
  it('does not mask database errors as unpaid',async()=>{
    const error=new Error('DB offline');vi.mocked(verifiedPaymentSource).mockRejectedValueOnce(error);
    await expect(readVnpayPaymentProof(tx,booking)).rejects.toBe(error);
  });
});
