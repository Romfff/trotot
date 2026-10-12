import { managementRequest } from "./client";
import { ApiError, toApiError, type ApiEnvelope } from "@/lib/auth-types";

export type Page<T> = ApiEnvelope<T[]> & {meta:{page:number;limit:number;total:number;totalPages:number}};
export type Unit = {id:string;unitName:string;maxAdults:number;maxChildren:number;maxGuests:number|null;maxNights:number;instantBook:boolean;bedrooms:number;bathrooms:number;checkInTime:string;checkOutTime:string;cancellationPolicy:string;basePricePerNight:number;cleaningFee:number};
export type HomestayResult = Unit & {slug:string;title:string;address:string;media?:{url:string;sortOrder:number}[]};
export type Homestay = {id:string;slug:string;title:string;description:string;address:{addressDetail:string;wardName:string};units:Unit[];amenities:{id:string;name:string}[];media?:{url:string;sortOrder:number}[]};
export type Stay = {unitId:string;checkIn:string;checkOut:string;adults:number;children:number};
export type Price = {baseAmount:number;cleaningFee:number;serviceFee:number;taxAmount:number;totalAmount:number;nightlyPrices:{date:string;price:number|string}[]};
export type Quote = {isAvailable:boolean;totalNights:number;priceBreakdown:Price;quoteToken:string;quoteExpiresAt:string};
export type Calendar = {unitId:string;month:string;days:{date:string;isAvailable:boolean;price:number}[]};
export type Booking = Price & {bookingId:string;bookingCode:string;unitId:string;checkInDate:string;checkOutDate:string;numAdults:number;numChildren:number;guestName:string;guestPhone:string;guestEmail:string|null;bookingStatus:string;paymentStatus:string;expiresAt:string;serverTime:string;version:number;payment:null};
export type Hold = {unitId:string;checkInDate:string;checkOutDate:string;numAdults:number;numChildren:number;guestName:string;guestPhone:string;guestEmail?:string;guestNotes?:string;quoteToken:string};

async function read<T>(path:string,params:Record<string,string|number>={},signal?:AbortSignal):Promise<T> {
  const query=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]));
  const response=await fetch(`/api/listings/homestays/${path}?${query}`,{cache:"no-store",signal:signal??AbortSignal.timeout(12000)}).catch(error=>{
    if(error instanceof Error&&error.name==="AbortError") throw error;
    throw new ApiError(0,"NETWORK_ERROR","Không thể kết nối máy chủ. Vui lòng thử lại.");
  });
  const body=await response.json();
  if(!response.ok) throw toApiError(response.status,body);
  if(body.success!==true) throw new ApiError(502,"INVALID_RESPONSE","Phản hồi máy chủ không hợp lệ.");
  return body;
}
export const homestaysApi={
  search:(params:Record<string,string|number>,signal?:AbortSignal)=>read<Page<HomestayResult>>("search",params,signal),
  detail:async(slug:string,signal?:AbortSignal)=>(await read<ApiEnvelope<Homestay>>(encodeURIComponent(slug),{},signal)).data,
  quote:async(stay:Stay,signal?:AbortSignal)=>(await read<ApiEnvelope<Quote>>("check-availability",stay,signal)).data,
  calendar:async(unitId:string,month:string,adults:number,children:number,signal?:AbortSignal)=>(await read<ApiEnvelope<Calendar>>(`units/${unitId}/calendar`,{month,adults,children},signal)).data,
  hold:async(body:Hold,key:string)=>(await managementRequest<ApiEnvelope<Booking>>("/bookings/hold",{method:"POST",data:body,headers:{"Idempotency-Key":key}})).data,
  bookings:(host:boolean,page:number,signal?:AbortSignal)=>managementRequest<Page<Booking>>(host?"/host/bookings":"/bookings",{params:{page,limit:10},signal}),
  action:async(host:boolean,id:string,action:string,version:number,key:string)=>(await managementRequest<ApiEnvelope<Booking>>(`${host?"/host":""}/bookings/${id}/${action}`,{method:"POST",data:{expectedVersion:version},headers:{"Idempotency-Key":key}})).data,
};
