import type { Booking } from '../generated/prisma/client.js';

type StatusBooking=Pick<Booking,'id'|'bookingCode'|'version'|'bookingStatus'|'paymentStatus'|'totalAmount'|'expiresAt'>;
// Read-only booking snapshot, not provider verification or permission to execute a payment.
export function bookingPaymentStatus(booking:StatusBooking,now:Date) {
  const pending=['PENDING_PAYMENT','PENDING_HOST_APPROVAL'].includes(booking.bookingStatus);
  return {bookingId:booking.id,bookingCode:booking.bookingCode,version:booking.version,
    bookingStatus:booking.bookingStatus,paymentStatus:booking.paymentStatus,amount:booking.totalAmount.toFixed(0),currency:'VND' as const,
    serverTime:now.toISOString(),reservationExpiresAt:pending?booking.expiresAt.toISOString():null,
    reservationExpired:pending && booking.expiresAt<=now,providerConnected:false as const,payment:null};
}
