import type {Booking} from "@/lib/api/homestays";
import type {NoShowDecision,NoShowDetail} from "@/lib/api/no-show";
import {reviewFieldErrors} from "@/features/admin-finance/bank-review";

export type NoShowFields=Pick<NoShowDecision,"reason"|"evidenceNote">;
export function noShowFieldErrors(fields:NoShowFields,scope:"host"|"admin") {
  const errors=reviewFieldErrors(fields);
  if(scope==="host")delete errors.evidenceNote;
  return errors;
}
const writableVersion=(version:number,min:number)=>Number.isInteger(version)&&version>=min&&version<2147483647;
// Presentation only: ownership and check-in/checkout use the server's DB clock
// and policy snapshot, neither the browser clock nor a guessed default time.
export function canReportNoShow(booking:Pick<Booking,"version"|"bookingStatus"|"paymentStatus">) {
  return writableVersion(booking.version,1)&&booking.bookingStatus==="CONFIRMED"&&booking.paymentStatus==="PAID";
}
export function canResolveNoShow(report:Pick<NoShowDetail,"bookingVersion"|"resolution">) {
  return writableVersion(report.bookingVersion,2)&&report.resolution===null;
}
