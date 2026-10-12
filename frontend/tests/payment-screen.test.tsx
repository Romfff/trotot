import { beforeEach,describe,expect,it,vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentStatusDetails } from '@/features/payments/payment-screen';
import { canPayBooking,preparePaymentSession,validatePaymentSession } from '@/features/payments/payment-session';
import { bookingPaymentsApi,type BookingPaymentStatus,type BookingPaymentSession } from '@/lib/api/booking-payments';
vi.mock('@/lib/api/booking-payments',()=>({bookingPaymentsApi:{status:vi.fn(),createSession:vi.fn()}}));
const id='00000000-0000-4000-8000-000000000001';
const status=():BookingPaymentStatus=>({bookingId:id,bookingCode:'SYNTHETIC',version:1,bookingStatus:'PENDING_PAYMENT',paymentStatus:'PENDING',amount:'1100',currency:'VND',
  serverTime:'2026-10-07T10:00:00.000Z',reservationExpiresAt:'2026-10-07T10:15:00.000Z',reservationExpired:false,providerConnected:true,payment:null});
const session=():BookingPaymentSession=>({bookingId:id,provider:'VNPAY_SANDBOX',mode:'REDIRECT',sessionId:id,transactionRef:id.replaceAll('-',''),amountVnd:'1100',
  createdAt:'2026-10-07T10:00:00.000Z',expiresAt:'2026-10-07T10:15:00.000Z',redirectUrl:'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'});
beforeEach(()=>vi.clearAllMocks());
describe('S4 payment UI safeguards, mocked transport not gateway',()=>{
  it.each([{providerConnected:false},{bookingStatus:'PENDING_HOST_APPROVAL'},{paymentStatus:'NOT_CONFIGURED'},{reservationExpired:true},{amount:'0'},{paymentStatus:'PAID'},{bookingStatus:'CANCELLED'}])('does not prepare payment when server blocks %j',async patch=>{
    const data={...status(),...patch};expect(canPayBooking(data)).toBe(false);vi.mocked(bookingPaymentsApi.status).mockResolvedValue(data);
    await expect(preparePaymentSession(id,()=> 'same-key',()=>true)).rejects.toMatchObject({errorCode:'PAYMENT_NOT_PAYABLE'});expect(bookingPaymentsApi.createSession).not.toHaveBeenCalled();
  });
  it('checks before and after preparation, keeps exact server version/key and never redirects automatically',async()=>{
    const data=status(),payment=session(),key=vi.fn(()=> 'stable-key');vi.mocked(bookingPaymentsApi.status).mockResolvedValue(data);vi.mocked(bookingPaymentsApi.createSession).mockResolvedValue(payment);
    expect(await preparePaymentSession(id,key,()=>true)).toEqual({session:payment,version:1});expect(key).toHaveBeenCalledWith(1);expect(bookingPaymentsApi.createSession).toHaveBeenCalledWith(id,1,'stable-key');expect(bookingPaymentsApi.status).toHaveBeenCalledTimes(2);
  });
  it.each([{version:2},{amount:'1200'},{serverTime:'2026-10-07T10:16:00.000Z',reservationExpired:true},{paymentStatus:'PAID'},{providerConnected:false}])('rejects a stale previously issued redirect when status changes %j',async patch=>{
    const data={...status(),...patch};vi.mocked(bookingPaymentsApi.status).mockResolvedValue(data);
    await expect(validatePaymentSession(id,1,session())).rejects.toBeDefined();
  });
  it('does not create a session after logout or switching accounts while preflight is running',async()=>{
    let active=true;vi.mocked(bookingPaymentsApi.status).mockImplementation(async()=>{active=false;return status();});
    await expect(preparePaymentSession(id,()=> 'same-key',()=>active)).rejects.toMatchObject({errorCode:'LOCAL_SESSION_CHANGED'});expect(bookingPaymentsApi.createSession).not.toHaveBeenCalled();
  });
  it('never shows legacy PAID without proof as gateway verified',()=>{
    const html=renderToStaticMarkup(<PaymentStatusDetails data={{...status(),paymentStatus:'PAID'}}/>);
    expect(html).toContain('chưa có chứng cứ gateway hợp lệ');expect(html).not.toContain('Máy chủ đã xác minh');
  });
  it('shows verified server proof, not provider configuration alone, as payment success',()=>{
    const pending=renderToStaticMarkup(<PaymentStatusDetails data={status()}/>);expect(pending).not.toContain('Máy chủ đã xác minh');
    const paid=status();paid.paymentStatus='PAID';paid.payment={provider:'VNPAY_SANDBOX',verified:true,sessionId:id,amountVnd:'1100',paidAt:paid.serverTime};
    expect(renderToStaticMarkup(<PaymentStatusDetails data={paid}/>)).toContain('Máy chủ đã xác minh thanh toán VNPay Sandbox');
  });
  it('renders explicit Vietnam deadline and unconfigured state, no fake QR or success button',()=>{
    const html=renderToStaticMarkup(<PaymentStatusDetails data={{...status(),providerConnected:false,paymentStatus:'NOT_CONFIGURED'}}/>);
    expect(html).toContain('Chưa thanh toán.');expect(html).not.toContain('Chưa kết nối cổng');expect(html).toContain('giờ Việt Nam');expect(html).toContain('17:15');expect(html).not.toContain('Giả lập');
  });
});
