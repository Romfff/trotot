import { beforeEach,describe,expect,it,vi } from 'vitest';
import { bookingPaymentsApi } from '@/lib/api/booking-payments';
import { managementRequest } from '@/lib/api/client';
vi.mock('@/lib/api/client',()=>({managementRequest:vi.fn()}));
beforeEach(()=>vi.clearAllMocks());
describe('S4 booking payment client without a provider',()=>{
  const id='00000000-0000-4000-8000-000000000001',sessionId='00000000-0000-4000-8000-000000000002';
  const fixture=()=>{
    const transactionRef=sessionId.replaceAll('-',''),url=new URL('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html');
    for(const [key,value] of Object.entries({vnp_TxnRef:transactionRef,vnp_Amount:'110000',vnp_Version:'2.1.0',vnp_Command:'pay',vnp_CurrCode:'VND',vnp_SecureHash:'a'.repeat(128)}))url.searchParams.set(key,value);
    return {provider:'VNPAY_SANDBOX',mode:'REDIRECT',sessionId,bookingId:id,transactionRef,amountVnd:'1100',createdAt:'2026-10-07T10:00:00.000Z',expiresAt:'2026-10-07T10:15:00.000Z',redirectUrl:url.toString()};
  };
  it.each(['read','create'])('accepts exact configured sandbox session without automatically opening or confirming it (%s)',async mode=>{
    const data=fixture();vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:'Synthetic only',data});
    expect(await (mode==='read'?bookingPaymentsApi.session(id):bookingPaymentsApi.createSession(id,1,'same-key'))).toBe(data);
  });
  it.each(['provider','mode','booking','session','transaction','amount','dates','origin','path','credentials','hash','duplicate','urlAmount'])('rejects mismatched sandbox session %s',async field=>{
    const data=fixture(),url=new URL(data.redirectUrl);
    if(field==='provider')data.provider='VNPAY_PRODUCTION';
    if(field==='mode')data.mode='PAID';
    if(field==='booking')data.bookingId=sessionId;
    if(field==='session')data.sessionId='wrong';
    if(field==='transaction')data.transactionRef='wrong';
    if(field==='amount')data.amountVnd='01';
    if(field==='dates')data.expiresAt=data.createdAt;
    if(field==='origin')url.hostname='evil.example';
    if(field==='path')url.pathname='/another';
    if(field==='credentials')url.username='unsafe';
    if(field==='hash')url.searchParams.set('vnp_SecureHash','invalid');
    if(field==='duplicate')url.searchParams.append('vnp_Amount','110000');
    if(field==='urlAmount')url.searchParams.set('vnp_Amount','1');
    data.redirectUrl=url.toString();vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:'Synthetic only',data});
    await expect(bookingPaymentsApi.session(id)).rejects.toMatchObject({errorCode:'INVALID_PAYMENT_RESPONSE'});expect(managementRequest).toHaveBeenCalledOnce();
  });
  it('preserves server snapshot, exact VND and unavailable provider with AbortSignal',async()=>{
    const signal=new AbortController().signal,data={bookingId:'fixture',bookingCode:'FIXTURE',version:1,currency:'VND',serverTime:'2026-10-07T10:00:00.000Z',amount:'999999999999999999',providerConnected:false,payment:null,reservationExpiresAt:null,reservationExpired:false,bookingStatus:'CANCELLED_TIMEOUT',paymentStatus:'NOT_CONFIGURED'};
    vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:'Synthetic only',data});
    expect(await bookingPaymentsApi.status('fixture',signal)).toBe(data);
    expect(managementRequest).toHaveBeenCalledWith('/bookings/fixture/payment-status',{signal});
  });
  const statusFixture=()=>({bookingId:id,bookingCode:'FIXTURE',version:2,bookingStatus:'CONFIRMED',paymentStatus:'PAID',amount:'1100',currency:'VND',serverTime:'2026-10-07T10:01:00.000Z',reservationExpiresAt:null,reservationExpired:false,providerConnected:false,payment:{provider:'VNPAY_SANDBOX',verified:true,sessionId,amountVnd:'1100',paidAt:'2026-10-07T10:00:00.000Z'}});
  it('accepts historical verified proof with config off, while a bare PAID flag remains null',async()=>{
    for(const data of [statusFixture(),{...statusFixture(),payment:null}]) {
      vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:'Synthetic only',data});
      expect(await bookingPaymentsApi.status(id)).toBe(data);
    }
  });
  it.each(['2026-10-07T10:00:59.999Z','2026-10-07T10:01:00.000Z','2026-10-07T10:01:00.001Z'])('uses exact server deadline %s and keeps pending reservations unpaid',async deadline=>{
    const data={...statusFixture(),bookingStatus:'PENDING_PAYMENT',paymentStatus:'PENDING',payment:null,providerConnected:true,reservationExpiresAt:deadline,reservationExpired:deadline<='2026-10-07T10:01:00.000Z'};
    vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:'Synthetic only',data});expect(await bookingPaymentsApi.status(id)).toBe(data);
  });
  it.each(['booking','currency','version','amount','clock','provider','pendingProof','proofAmount','proofProvider','proofTime','proofSession','proofVerified','expired','missingPayment'])('rejects invalid payment status %s without fallback',async field=>{
    const data:Record<string,unknown>=statusFixture(),payment=data.payment as Record<string,unknown>;
    if(field==='booking')data.bookingId=sessionId;
    if(field==='currency')data.currency='USD';
    if(field==='version')data.version=0;
    if(field==='amount')data.amount='1.1';
    if(field==='clock')data.serverTime='wrong';
    if(field==='provider')data.providerConnected='true';
    if(field==='pendingProof'){data.bookingStatus='PENDING_PAYMENT';data.paymentStatus='PENDING';data.reservationExpiresAt='2026-10-07T10:15:00.000Z';}
    if(field==='proofAmount')payment.amountVnd='1';
    if(field==='proofProvider')payment.provider='CLIENT_FLAG';
    if(field==='proofTime')payment.paidAt='2026-10-07T10:02:00.000Z';
    if(field==='proofSession')payment.sessionId='bad';
    if(field==='proofVerified')payment.verified=false;
    if(field==='expired')data.reservationExpired=true;
    if(field==='missingPayment')delete data.payment;
    vi.mocked(managementRequest).mockResolvedValueOnce({success:true,message:'Synthetic only',data});
    await expect(bookingPaymentsApi.status(id)).rejects.toMatchObject({errorCode:'INVALID_PAYMENT_RESPONSE'});expect(managementRequest).toHaveBeenCalledOnce();
  });
  it('does not turn unavailable session into a QR, auto-retry or successful payment',async()=>{
    const signal=new AbortController().signal,error={status:503,errorCode:'PAYMENT_NOT_CONFIGURED'};
    vi.mocked(managementRequest).mockRejectedValueOnce(error);
    await expect(bookingPaymentsApi.session('fixture',signal)).rejects.toBe(error);
    expect(managementRequest).toHaveBeenCalledWith('/bookings/fixture/payment-session',{signal});expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it('passes the unchanged caller version/key and never fabricates a success replay',async()=>{
    const error={status:503,errorCode:'PAYMENT_NOT_CONFIGURED'};vi.mocked(managementRequest).mockRejectedValueOnce(error);
    await expect(bookingPaymentsApi.createSession('fixture',2,'exact-key')).rejects.toBe(error);
    expect(managementRequest).toHaveBeenCalledWith('/bookings/fixture/payment-session',{method:'POST',data:{expectedVersion:2},headers:{'Idempotency-Key':'exact-key'}});
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it.each(['read','create'])('rejects unexpected session success until a real provider contract is implemented (%s)',async mode=>{
    vi.mocked(managementRequest).mockResolvedValueOnce({success:true,data:{qr:'untrusted'}});
    await expect(mode==='read'?bookingPaymentsApi.session('fixture'):bookingPaymentsApi.createSession('fixture',1,'key')).rejects.toMatchObject({errorCode:'INVALID_PAYMENT_RESPONSE'});
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it.each([new DOMException('Aborted','AbortError'),{status:401,errorCode:'SESSION_CHANGED'},{status:404,errorCode:'BOOKING_NOT_FOUND'},{status:429,errorCode:'RATE_LIMITED'}])('does not swallow status errors %j',async error=>{
    vi.mocked(managementRequest).mockRejectedValueOnce(error);await expect(bookingPaymentsApi.status('fixture')).rejects.toBe(error);expect(managementRequest).toHaveBeenCalledTimes(1);
  });
});
