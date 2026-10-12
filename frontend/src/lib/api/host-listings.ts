import { managementRequest } from "./client";
import { ApiError, toApiError, type ApiEnvelope } from "@/lib/auth-types";
import { isVietnamLocation, roundedLocation } from "@/lib/listing-location";

export type ListingInput = {
  title: string; propertyType: string; description: string; videoUrl: string | null;
  addressDetail: string; provinceCode: string; wardCode: string; latitude: number; longitude: number;
  monthlyPrice: number; depositAmount: number; areaSqm: number; electricityCost: number; waterCost: number;
  waterUnit: string; internetCost: number; garbageCost: number; parkingFee: number;
  contactPhone: string; contactZalo?: string; allowPets: boolean; amenityIds: string[]; imageUrls: string[];
};
export type OwnListing = Omit<ListingInput, "amenityIds" | "imageUrls" | "monthlyPrice" | "depositAmount" | "areaSqm" | "electricityCost" | "waterCost" | "waterUnit" | "internetCost" | "garbageCost" | "parkingFee" | "contactPhone" | "contactZalo" | "allowPets"> & {
  id: string; slug: string; version: number; status: string; isAvailable: boolean;
  longTermDetail: Record<string, string | number | boolean | null> | null;
  images: { url: string; position: number; sortOrder: number }[];
  amenities: { amenityId: string }[];
  revision: { status: string; content: ListingInput } | null;
};
export type OwnListings = ApiEnvelope<OwnListing[]> & { meta: { page: number; total: number; totalPages: number } };
export type Catalog = { version: string; asOf: string; sourceUrl: string; items: { code: string; name: string; provinceCode?: string }[] };
export const listingStatuses: Record<string, string> = { PENDING_REVIEW: "Chờ duyệt", PUBLISHED: "Đang hiển thị", HIDDEN: "Tạm ẩn", REJECTED: "Bị từ chối", DRAFT: "Bản nháp", EXPIRED: "Hết hạn" };

export function listingContactError(field: "contactPhone" | "contactZalo", message?: string): string | undefined {
  if (!message?.startsWith(`${field} `)) return message;
  const label = field === "contactPhone" ? "Số điện thoại liên hệ" : "Số Zalo";
  return `${label} không hợp lệ. Nhập 9–15 chữ số, có thể thêm + ở đầu.`;
}

// Editing starts from the pending/rejected revision, without discarding existing media.
export function listingFormValues(record?: OwnListing): Record<string, string | string[] | boolean> {
  if (!record) return { propertyType: "PHONG_TRO", waterUnit: "M3", allowPets: false, amenityIds: [], imageUrls: [] };
  const content: Record<string, unknown> = record.revision?.content ?? {
    ...record, ...record.longTermDetail,
    amenityIds: record.amenities.map(item => item.amenityId),
    imageUrls: record.images.toSorted((a, b) => a.position - b.position).map(item => item.url),
  };
  return Object.fromEntries(Object.entries(content).map(([name, value]) => [name,
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "boolean" ? value : value == null ? "" : String(value)]));
}

export function listingFormPayload(form: FormData, imageUrls: string[] = []): ListingInput {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const number = (key: string) => {
    const value = text(key);
    if (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
      throw new ApiError(400, "INVALID_FIELD", "Kiểm tra lại các ô số.", { [key]: "Điền số hợp lệ, không để trống." });
    }
    return Number(value);
  };
  const point = roundedLocation(number("latitude"), number("longitude"));
  if (!isVietnamLocation(point)) throw new ApiError(400, "INVALID_LOCATION", "Chọn vị trí phòng trong Việt Nam.", { latitude: "Ghim nằm ngoài khu vực Việt Nam được hỗ trợ." });
  return {
    title: text("title"), propertyType: text("propertyType"), description: text("description"), videoUrl: text("videoUrl") || null,
    addressDetail: text("addressDetail"), provinceCode: text("provinceCode"), wardCode: text("wardCode"),
    latitude: point.latitude, longitude: point.longitude, monthlyPrice: number("monthlyPrice"), depositAmount: number("depositAmount"),
    areaSqm: number("areaSqm"), electricityCost: number("electricityCost"), waterCost: number("waterCost"), waterUnit: text("waterUnit"),
    internetCost: number("internetCost"), garbageCost: number("garbageCost"), parkingFee: number("parkingFee"),
    contactPhone: text("contactPhone"), ...(text("contactZalo") ? { contactZalo: text("contactZalo") } : {}),
    allowPets: form.get("allowPets") === "on", amenityIds: form.getAll("amenityIds").map(String), imageUrls,
  };
}

export async function addressCatalog(kind: "provinces" | "wards", provinceCode: string, signal?: AbortSignal): Promise<Catalog> {
  const query = kind === "wards" ? `?${new URLSearchParams({ provinceCode })}` : "";
  const response = await fetch(`/api/listings/catalog/${kind}${query}`, { signal, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw toApiError(response.status, body);
  if (body.success !== true || !Array.isArray(body.data?.items)) throw new ApiError(502, "INVALID_RESPONSE", "Danh mục địa chỉ không hợp lệ.");
  return body.data;
}

export const hostListingsApi = {
  list: (page: number, signal?: AbortSignal) => managementRequest<OwnListings>("/host/properties", { params: { page, limit: 10 }, signal }),
  detail: async (id: string, signal?: AbortSignal) => (await managementRequest<ApiEnvelope<OwnListing>>(`/host/properties/${id}`, { signal })).data,
  save: async (input: ListingInput, record?: Pick<OwnListing, "id" | "version">) => (await managementRequest<ApiEnvelope<OwnListing>>(
    record ? `/host/properties/${record.id}` : "/properties/long-term",
    { method: record ? "PUT" : "POST", data: { ...input, ...(record ? { expectedVersion: record.version } : {}) } },
  )).data,
  action: (record: Pick<OwnListing, "id" | "version">, action: "hide" | "show" | "availability" | "delete", isAvailable?: boolean) => managementRequest<ApiEnvelope<unknown>>(
    `/host/properties/${record.id}${action === "delete" ? "" : `/${action}`}`,
    { method: action === "delete" ? "DELETE" : "POST", data: { expectedVersion: record.version, ...(action === "availability" ? { isAvailable } : {}) } },
  ),
};
