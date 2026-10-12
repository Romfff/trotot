import { bookingPaymentsApi,type BookingPaymentStatus,type BookingPaymentSession } from '@/lib/api/booking-payments';
import { ApiError } from '@/lib/auth-types';

export const canPayBooking=(status:BookingPaymentStatus)=>status.providerConnected && status.bookingStatus==='PENDING_PAYMENT'
  && status.paymentStatus==='PENDING' && status.payment===null && !status.reservationExpired && BigInt(status.amount)>BigInt(0);
function assertPayable(status:BookingPaymentStatus) {
  if(!canPayBooking(status)) throw new ApiError(409,'PAYMENT_NOT_PAYABLE','Đơn chưa thể thanh toán hoặc đã thay đổi. Hãy tải lại trạng thái.');
}
export async function preparePaymentSession(id:string,keyForVersion:(version:number)=>string,isCurrent:()=>boolean) {
  const assertSession=()=>{if(!isCurrent())throw new ApiError(409,'LOCAL_SESSION_CHANGED','Phiên đăng nhập đã thay đổi.');};
  assertSession();const before=await bookingPaymentsApi.status(id);assertSession();assertPayable(before);
  const session=await bookingPaymentsApi.createSession(id,before.version,keyForVersion(before.version));
  assertSession();const after=await bookingPaymentsApi.status(id);assertSession();
  await validatePaymentSession(id,before.version,session,after);
  return {session,version:before.version};
}
export async function validatePaymentSession(id:string,version:number,session:BookingPaymentSession,status?:BookingPaymentStatus) {
  const current=status || await bookingPaymentsApi.status(id);assertPayable(current);
  if(current.bookingId!==id || current.version!==version || session.bookingId!==id || session.amountVnd!==current.amount
    || session.expiresAt<=current.serverTime || !current.reservationExpiresAt || session.expiresAt>current.reservationExpiresAt)
    throw new ApiError(409,'PAYMENT_SESSION_CHANGED','Phiên thanh toán không còn khớp với đơn. Hãy tải lại trước khi mở cổng.');
  return current;
}
