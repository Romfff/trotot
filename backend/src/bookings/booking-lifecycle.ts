import { BadRequestException, ConflictException } from '@nestjs/common';

export function roomTimestamp(date:string,time:string):Date {
  return new Date(`${date}T${time}+07:00`);
}
export function bookingDeadline(now:Date,instantBook:boolean,checkIn:string,checkInTime:string,accepted=false):Date {
  const deadline = now.getTime() + (instantBook || accepted ? 15*60_000 : 12*60*60_000);
  return new Date(instantBook ? deadline : Math.min(deadline,roomTimestamp(checkIn,checkInTime).getTime()));
}
export function validateBookingPrice(price:{totalAmount:{isZero():boolean};nightlyPrices:{price:{lt(n:number):boolean}}[]},minimum:number) {
  if (price.totalAmount.isZero()) throw new BadRequestException({errorCode:'FREE_BOOKING_NOT_SUPPORTED',message:'Chưa hỗ trợ tạo đơn đặt phòng miễn phí.'});
  if (price.nightlyPrices.some(n => n.price.lt(minimum))) throw new BadRequestException({errorCode:'NIGHTLY_PRICE_TOO_LOW',message:'Giá mỗi đêm chưa đạt mức tối thiểu để đặt phòng.'});
}
export function assertBookingTransition(booking:{bookingStatus:string;paymentStatus:string;version:number;expiresAt:Date},
  action:'accept'|'reject'|'cancel'|'check-in'|'complete',version:number,now:Date,checkIn:Date,checkOut:Date) {
  if(booking.version!==version) throw new ConflictException({errorCode:'STALE_BOOKING_VERSION',message:'Đơn đã thay đổi. Vui lòng tải lại.'});
  if(['accept','reject','cancel'].includes(action) && booking.expiresAt<=now) throw new ConflictException({errorCode:'BOOKING_EXPIRED',message:'Đơn đã hết thời hạn xử lý.'});
  const pending = ['NOT_CONFIGURED','PENDING'].includes(booking.paymentStatus);
  const valid = action==='accept'||action==='reject' ? pending && booking.bookingStatus==='PENDING_HOST_APPROVAL'
    : action==='cancel' ? pending && ['PENDING_HOST_APPROVAL','PENDING_PAYMENT'].includes(booking.bookingStatus)
    : action==='check-in' ? booking.paymentStatus==='PAID' && booking.bookingStatus==='CONFIRMED' && now>=checkIn && now<checkOut
    : booking.paymentStatus==='PAID' && booking.bookingStatus==='CHECKED_IN' && now>=checkOut;
  if(!valid) throw new ConflictException({errorCode:'INVALID_BOOKING_STATE',message:'Không thể thực hiện thao tác với trạng thái hoặc thời điểm hiện tại.'});
}
