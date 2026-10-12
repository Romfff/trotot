import { managementRequest } from './client';
import { ApiError,type ApiEnvelope } from '@/lib/auth-types';

export type BookingPaymentStatus={
  bookingId:string;bookingCode:string;version:number;bookingStatus:string;paymentStatus:string;amount:string;currency:'VND';
  serverTime:string;reservationExpiresAt:string|null;reservationExpired:boolean;providerConnected:boolean;
  payment:null|{provider:'VNPAY_SANDBOX';verified:true;sessionId:string;amountVnd:string;paidAt:string};
};
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const timestamp=(value:unknown):value is string=>typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
async function statusData(request:Promise<unknown>,bookingId:string):Promise<BookingPaymentStatus> {
  const invalid=()=>new ApiError(502,'INVALID_PAYMENT_RESPONSE','Dữ liệu trạng thái thanh toán chưa hợp lệ. Vui lòng thử lại.');
  const body=await request;
  if(!body || typeof body!=='object' || !('success' in body) || body.success!==true || !('message' in body) || typeof body.message!=='string' || !('data' in body))throw invalid();
  const data=body.data;
  if(!data || typeof data!=='object' || Array.isArray(data))throw invalid();
  const value=data as Record<string,unknown>;
  if(value.bookingId!==bookingId || typeof value.bookingCode!=='string' || !value.bookingCode || !Number.isSafeInteger(value.version) || Number(value.version)<1 || Number(value.version)>2147483647
    || !['PENDING_HOST_APPROVAL','PENDING_PAYMENT','REJECTED_BY_HOST','CANCELLED_HOST_TIMEOUT','CANCELLED_TIMEOUT','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','CANCELLED_BY_GUEST'].includes(String(value.bookingStatus))
    || !['NOT_CONFIGURED','PENDING','PAID','REFUNDED'].includes(String(value.paymentStatus)) || value.currency!=='VND' || typeof value.amount!=='string' || !/^(0|[1-9]\d{0,17})$/.test(value.amount)
    || !timestamp(value.serverTime) || typeof value.providerConnected!=='boolean' || typeof value.reservationExpired!=='boolean')throw invalid();
  const pending=['PENDING_HOST_APPROVAL','PENDING_PAYMENT'].includes(String(value.bookingStatus));
  if(pending?(!timestamp(value.reservationExpiresAt) || value.reservationExpired!==(value.reservationExpiresAt<=value.serverTime)):(value.reservationExpiresAt!==null || value.reservationExpired!==false))throw invalid();
  if(value.payment!==null) {
    if(!value.payment || typeof value.payment!=='object' || Array.isArray(value.payment))throw invalid();
    const payment=value.payment as Record<string,unknown>;
    if(payment.provider!=='VNPAY_SANDBOX' || payment.verified!==true || typeof payment.sessionId!=='string' || !uuid.test(payment.sessionId)
      || payment.amountVnd!==value.amount || !timestamp(payment.paidAt) || payment.paidAt>value.serverTime || !['PAID','REFUNDED'].includes(String(value.paymentStatus)))throw invalid();
  }
  return data as BookingPaymentStatus;
}
// Transport only. No polling, cached success, QR fallback or payment mutation at the client.
export type BookingPaymentSession={provider:'VNPAY_SANDBOX';mode:'REDIRECT';sessionId:string;bookingId:string;transactionRef:string;amountVnd:string;createdAt:string;expiresAt:string;redirectUrl:string};
async function sessionData(request:Promise<unknown>,bookingId:string):Promise<BookingPaymentSession> {
  const invalid=()=>new ApiError(502,'INVALID_PAYMENT_RESPONSE','Dữ liệu phiên thanh toán chưa hợp lệ. Chưa thể mở cổng thanh toán.');
  const body=await request;
  if(!body || typeof body!=='object' || !('success' in body) || body.success!==true || !('message' in body) || typeof body.message!=='string' || !('data' in body))throw invalid();
  const data=body.data;
  if(!data || typeof data!=='object' || Array.isArray(data))throw invalid();
  const value=data as Record<string,unknown>;
  if(value.provider!=='VNPAY_SANDBOX' || value.mode!=='REDIRECT' || value.bookingId!==bookingId || typeof value.sessionId!=='string' || !uuid.test(value.sessionId)
    || value.transactionRef!==value.sessionId.replaceAll('-','').toLowerCase() || typeof value.amountVnd!=='string' || !/^[1-9]\d{0,9}$/.test(value.amountVnd)
    || !timestamp(value.createdAt) || !timestamp(value.expiresAt) || value.expiresAt<=value.createdAt || typeof value.redirectUrl!=='string')throw invalid();
  let url:URL;try {url=new URL(value.redirectUrl);}catch{throw invalid();}
  if(url.origin!=='https://sandbox.vnpayment.vn' || url.pathname!=='/paymentv2/vpcpay.html' || url.username || url.password || url.hash
    || Array.from(url.searchParams.keys()).some((key,_,keys)=>keys.filter(other=>other===key).length!==1)
    || url.searchParams.get('vnp_TxnRef')!==value.transactionRef || url.searchParams.get('vnp_Amount')!==(BigInt(value.amountVnd)*BigInt(100)).toString()
    || url.searchParams.get('vnp_Version')!=='2.1.0' || url.searchParams.get('vnp_Command')!=='pay' || url.searchParams.get('vnp_CurrCode')!=='VND'
    || !/^[a-f0-9]{128}$/i.test(url.searchParams.get('vnp_SecureHash')??''))throw invalid();
  // Validation only: no redirect, paid state, QR fallback or auto-retry is performed here.
  return data as BookingPaymentSession;
}
export const bookingPaymentsApi={
  status:(id:string,signal?:AbortSignal)=>statusData(managementRequest<ApiEnvelope<BookingPaymentStatus>>(`/bookings/${encodeURIComponent(id)}/payment-status`,{signal}),id),
  session:(id:string,signal?:AbortSignal)=>sessionData(managementRequest(`/bookings/${encodeURIComponent(id)}/payment-session`,{signal}),id),
  createSession:(id:string,version:number,key:string)=>sessionData(managementRequest(`/bookings/${encodeURIComponent(id)}/payment-session`,{method:'POST',data:{expectedVersion:version},headers:{'Idempotency-Key':key}}),id),
};
