import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { decodeJwt, SignJWT } from 'jose';
import { calculateCancellationRefund } from './booking-refund.js';
import { signRefundQuote, verifyRefundQuote } from './booking-refund-quote.js';

const secret='test-only-refund-quote-secret-independent-123456';
const now=new Date('2026-10-20T07:00:00Z');
const binding={userId:'11111111-1111-4111-8111-111111111111',bookingId:'22222222-2222-4222-8222-222222222222',version:3};
const snapshot={checkInDate:'2026-10-25',checkInTime:'14:00:00',cancellationPolicy:'MODERATE',baseAmount:'1000',
  cleaningFee:'100',serviceFee:'50',taxAmount:'50',totalAmount:'1200',commissionRate:'10',commissionAmount:'110',hostPayoutAmount:'990'};
const refund=()=>calculateCancellationRefund(snapshot,'GUEST',now);
describe('S4 signed refund preview',()=>{
  beforeEach(()=>vi.stubEnv('HOMESTAY_QUOTE_SECRET',secret));
  afterEach(()=>vi.unstubAllEnvs());
  it('binds actor/booking/version and full server snapshot for 120 seconds, without exposing host finance',async()=>{
    const q=await signRefundQuote(binding,snapshot,refund(),now);
    expect(q.quoteExpiresAt).toBe('2026-10-20T07:02:00.000Z');
    expect(q.refund).toEqual({room:1000,cleaning:100,service:50,tax:50,total:1200});
    expect(JSON.stringify(q)).not.toMatch(/commission|hostPayout|guestPhone/);
    expect(decodeJwt(q.refundQuoteToken)).toMatchObject({...binding,aud:'refund-quote',schemaVersion:1});
    expect(await verifyRefundQuote(q.refundQuoteToken,binding,snapshot,refund(),now)).toEqual({refundChanged:false});
  });
  it.each(['userId','bookingId','version'] as const)('rejects reuse with another %s',async field=>{
    const q=await signRefundQuote(binding,snapshot,refund(),now);
    const changed={...binding,[field]:field==='version'?4:'33333333-3333-4333-8333-333333333333'};
    await expect(verifyRefundQuote(q.refundQuoteToken,changed,snapshot,refund(),now)).rejects.toMatchObject({response:{errorCode:'INVALID_REFUND_QUOTE'}});
  });
  it('accepts immediately before expiry, rejects exactly at expiry',async()=>{
    const q=await signRefundQuote(binding,snapshot,refund(),now);
    expect((await verifyRefundQuote(q.refundQuoteToken,binding,snapshot,refund(),new Date(now.getTime()+119999))).refundChanged).toBe(false);
    await expect(verifyRefundQuote(q.refundQuoteToken,binding,snapshot,refund(),new Date(now.getTime()+120000))).rejects.toMatchObject({response:{errorCode:'REFUND_QUOTE_EXPIRED'}});
  });
  it('detects a cutoff crossing even while token is valid',async()=>{
    const atCutoff=new Date('2026-10-20T07:00:00.000Z');
    const q=await signRefundQuote(binding,snapshot,refund(),atCutoff);
    const later=new Date(atCutoff.getTime()+1);
    expect((await verifyRefundQuote(q.refundQuoteToken,binding,snapshot,calculateCancellationRefund(snapshot,'GUEST',later),later)).refundChanged).toBe(true);
  });
  it('binds unchanged refund totals to the original snapshot too',async()=>{
    const q=await signRefundQuote(binding,snapshot,refund(),now);
    expect((await verifyRefundQuote(q.refundQuoteToken,binding,{...snapshot,commissionRate:'11'},refund(),now)).refundChanged).toBe(true);
  });
  it.each(['','x'.repeat(2049),'not-a-token'])('rejects malformed input',async token=>{
    await expect(verifyRefundQuote(token,binding,snapshot,refund(),now)).rejects.toMatchObject({status:400});
  });
  it('rejects tampering, wrong purpose/algorithm/TTL and future issuance',async()=>{
    const q=await signRefundQuote(binding,snapshot,refund(),now),payload=decodeJwt(q.refundQuoteToken);
    for(const change of [{aud:'homestay-quote'},{iss:'other'},{schemaVersion:2},{exp:payload.exp!+1},{iat:payload.iat!+1}]) {
      const token=await new SignJWT({...payload,...change}).setProtectedHeader({alg:'HS256',typ:'trotot-refund-quote+jwt'}).sign(new TextEncoder().encode(secret));
      await expect(verifyRefundQuote(token,binding,snapshot,refund(),now)).rejects.toMatchObject({status:400});
    }
    const parts=q.refundQuoteToken.split('.'); parts[1]=Buffer.from(JSON.stringify({...payload,version:99})).toString('base64url');
    await expect(verifyRefundQuote(parts.join('.'),binding,snapshot,refund(),now)).rejects.toMatchObject({status:400});
    const token=await new SignJWT(payload).setProtectedHeader({alg:'HS384',typ:'trotot-refund-quote+jwt'}).sign(new TextEncoder().encode(secret));
    await expect(verifyRefundQuote(token,binding,snapshot,refund(),now)).rejects.toMatchObject({status:400});
  });
  it.each(['','short',secret])('fails closed on missing/short/auth-reused signing secret',async value=>{
    vi.stubEnv('HOMESTAY_QUOTE_SECRET',value);vi.stubEnv('JWT_ACCESS_SECRET',secret);
    await expect(signRefundQuote(binding,snapshot,refund(),now)).rejects.toMatchObject({status:503});
  });
});
