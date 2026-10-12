import type {ComplaintBooking} from "@/lib/api/complaints";
export function complaintTextError(value:string) {
  return !value.trim()||value.trim().length>500?"Nội dung cần từ 1 đến 500 ký tự.":undefined;
}
// This is only a presentation gate. Server checks ownership, DB clock/window and version.
export function canRequestComplaint(booking:ComplaintBooking,hasOpen:boolean) {
  return !hasOpen&&booking.version<2147483647&&booking.paymentStatus==="PAID"&&["CONFIRMED","CHECKED_IN","COMPLETED"].includes(booking.bookingStatus);
}
