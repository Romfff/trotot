import axios, { AxiosError } from "axios";
import type { CostEstimateDto } from "./appointment-types.generated";
import type {
  AmenitiesResponse,
  AmenityItem,
  ListingDetailResponse,
  PublicListingItem,
  SearchListingsParams,
  SearchListingsResponse,
} from "@/types/listing";

const getBaseUrl = (): string => {
  if (typeof window !== "undefined") return "/api/listings";
  const base = process.env.BACKEND_API_URL;
  if (!base && process.env.NODE_ENV === "production") {
    throw new ListingApiError(503, "API_NOT_CONFIGURED", "Chưa cấu hình kết nối máy chủ.");
  }
  return (base || "http://localhost:5000/api/v1").replace(/\/$/, "");
};

export class ListingApiError extends Error {
  public status: number;
  public errorCode: string;
  public details?: unknown;

  constructor(status: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.name = "ListingApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

function handleAxiosError(error: unknown): never {
  if (error instanceof ListingApiError) throw error;
  if (axios.isAxiosError(error) || error instanceof AxiosError) {
    if (error.response) {
      const data = error.response.data as {
        success?: boolean;
        errorCode?: string;
        message?: string;
        errors?: unknown;
      };
      const status = error.response.status;
      const errorCode = data?.errorCode || (status === 429 ? "RATE_LIMITED" : status === 503 ? "SERVICE_UNAVAILABLE" : "API_ERROR");
      const message = data?.message || (status === 429 ? "Bạn thao tác quá nhanh. Vui lòng thử lại sau." : "Máy chủ gặp sự cố. Vui lòng thử lại sau.");
      throw new ListingApiError(status, errorCode, message, data?.errors);
    }
    if (error.request) {
      throw new ListingApiError(0, "NETWORK_ERROR", "Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.");
    }
  }
  throw new ListingApiError(0, "UNKNOWN_ERROR", error instanceof Error ? error.message : "Đã có lỗi xảy ra.");
}

export const listingsApi = {
  async costEstimate(slug: string, usage: Partial<Record<"electricityKwh" | "waterM3" | "occupants" | "vehicles", string>>, signal?: AbortSignal): Promise<CostEstimateDto> {
    try {
      const response = await axios.get<{ success: boolean; data: CostEstimateDto }>(`${getBaseUrl()}/properties/${encodeURIComponent(slug)}/cost-estimate`, {
        // Preserve explicit zero and decimal strings. Empty UI fields mean omitted;
        // the server owns all validation, prices, units, rounding and totals.
        params: Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== "")),
        signal, timeout: 10_000, headers: { Accept: "application/json" }, maxRedirects: 0,
      });
      return response.data.data;
    } catch (error) {
      if (signal?.aborted) throw error;
      return handleAxiosError(error);
    }
  },
  async search(params: SearchListingsParams = {}, upstreamHeaders: Record<string, string> = {}): Promise<SearchListingsResponse> {
    try {
      const cleanParams: Record<string, string | number> = {};

      if (params.province) cleanParams.province = params.province;
      if (params.district) cleanParams.district = params.district;
      if (typeof params.minPrice === "number" && !isNaN(params.minPrice) && params.minPrice >= 0) {
        cleanParams.minPrice = params.minPrice;
      }
      if (typeof params.maxPrice === "number" && !isNaN(params.maxPrice) && params.maxPrice >= 0) {
        cleanParams.maxPrice = params.maxPrice;
      }
      if (typeof params.minArea === "number" && !isNaN(params.minArea) && params.minArea >= 0) {
        cleanParams.minArea = params.minArea;
      }
      if (typeof params.maxArea === "number" && !isNaN(params.maxArea) && params.maxArea >= 0) {
        cleanParams.maxArea = params.maxArea;
      }
      if (params.amenities && params.amenities.trim()) {
        cleanParams.amenities = params.amenities.trim();
      }

      const hasCoordinates = typeof params.lat === "number" && !isNaN(params.lat) && typeof params.lng === "number" && !isNaN(params.lng);
      if (hasCoordinates) {
        cleanParams.lat = params.lat!;
        cleanParams.lng = params.lng!;
        if (typeof params.radius === "number" && !isNaN(params.radius) && params.radius > 0) {
          cleanParams.radius = Math.round(params.radius);
        }
      }

      if (params.sortBy) {
        if (params.sortBy === "distance_asc") {
          if (hasCoordinates) cleanParams.sortBy = params.sortBy;
          else cleanParams.sortBy = "newest";
        } else {
          cleanParams.sortBy = params.sortBy;
        }
      }

      if (typeof params.page === "number" && params.page >= 1) {
        cleanParams.page = Math.floor(params.page);
      }
      if (typeof params.limit === "number" && params.limit >= 1 && params.limit <= 100) {
        cleanParams.limit = Math.floor(params.limit);
      }

      const response = await axios.get<SearchListingsResponse>(
        `${getBaseUrl()}/properties/long-term/search`,
        {
          params: cleanParams,
          timeout: 10_000,
          headers: { Accept: "application/json", ...upstreamHeaders },
          maxRedirects: 0,
        }
      );

      return response.data;
    } catch (error) {
      return handleAxiosError(error);
    }
  },

  async getAmenities(): Promise<AmenityItem[]> {
    try {
      const response = await axios.get<AmenitiesResponse>(
        `${getBaseUrl()}/amenities`,
        {
          timeout: 10_000,
          headers: { Accept: "application/json" },
        }
      );
      return response.data.data;
    } catch (error) {
      return handleAxiosError(error);
    }
  },

  async getBySlug(slug: string, upstreamHeaders: Record<string, string> = {}): Promise<PublicListingItem> {
    try {
      const response = await axios.get<ListingDetailResponse>(
        `${getBaseUrl()}/properties/${encodeURIComponent(slug)}`,
        {
          timeout: 10_000,
          headers: { Accept: "application/json", ...upstreamHeaders },
          maxRedirects: 0,
        }
      );
      return response.data.data;
    } catch (error) {
      return handleAxiosError(error);
    }
  },
};
