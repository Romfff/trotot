import { managementRequest } from "./client";
import { ApiError, toApiError, type ApiEnvelope } from "@/lib/auth-types";
import type { Page } from "./homestays";

export type Review = {id:string;cleanliness:number;location:number;value:number;comment:string;authorName:string;createdAt:string};
export type CreateReview = Pick<Review,"cleanliness"|"location"|"value"|"comment">;
export const reviewsApi = {
  own: async (bookingId:string,signal?:AbortSignal) => (await managementRequest<ApiEnvelope<Review|null>>(`/bookings/${encodeURIComponent(bookingId)}/review`,{signal})).data,
  create: async (bookingId:string,data:CreateReview) => (await managementRequest<ApiEnvelope<Review>>(`/bookings/${encodeURIComponent(bookingId)}/review`,{method:"POST",data})).data,
  list: async (slug:string,page=1,signal?:AbortSignal):Promise<Page<Review>> => {
    const response = await fetch(`/api/listings/properties/${encodeURIComponent(slug)}/reviews?page=${page}&limit=10`,{cache:"no-store",signal:signal??AbortSignal.timeout(12000)}).catch(error=>{
      if(error instanceof Error && error.name==="AbortError") throw error;
      throw new ApiError(0,"NETWORK_ERROR","Không thể kết nối máy chủ. Vui lòng thử lại.");
    });
    const body=await response.json();
    if(!response.ok) throw toApiError(response.status,body);
    if(body.success!==true) throw new ApiError(502,"INVALID_RESPONSE","Phản hồi máy chủ không hợp lệ.");
    return body;
  },
};
