import { managementRequest } from "./client";
import { ApiError, type ApiEnvelope } from "@/lib/auth-types";
import { isVietnamLocation, roundedLocation } from "@/lib/listing-location";
import type { OwnListings } from "./host-listings";

export type HomestayContent = {
  title: string; description: string; propertyType: "HOMESTAY" | "VILLA";
  addressDetail: string; provinceCode: string; wardCode: string; latitude: number; longitude: number;
  amenityIds: string[]; imageUrls: string[]; videoUrl: string | null;
};
export type UnitInput = {
  unitName: string; maxAdults: number; maxChildren: number; maxGuests: number | null; maxNights: number;
  bedrooms: number; bathrooms: number; basePricePerNight: number; weekendPricePerNight: number | null;
  cleaningFee: number; checkInTime: string; checkOutTime: string; sameDayBookingCutoff: string;
  cancellationPolicy: "FLEXIBLE" | "MODERATE" | "STRICT"; instantBook: boolean;
};
export type OwnUnit = Omit<UnitInput, "basePricePerNight" | "weekendPricePerNight" | "cleaningFee"> & {
  id: string; version: number; status: string; pendingRevision: UnitInput | null;
  basePricePerNight: string | number; weekendPricePerNight: string | number | null; cleaningFee: string | number;
};
export type OwnHomestay = HomestayContent & {
  id: string; slug: string; version: number; status: string;
  homestayUnits: OwnUnit[]; images: { url: string; position: number }[]; amenities: { amenityId: string }[];
  revision: { status: string; content: HomestayContent } | null;
};
type HomestayPage = Omit<OwnListings, "data"> & { data: OwnHomestay[] };
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
function numeric(form: FormData, key: string, optional = false): number | null {
  const value = text(form, key);
  if (optional && !value) return null;
  if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
    throw new ApiError(400, "INVALID_FIELD", "Kiểm tra lại các ô số.", { [key]: "Điền số không âm hợp lệ." });
  }
  return Number(value);
}
export function homestayContent(form: FormData, imageUrls: string[]): HomestayContent {
  const point = roundedLocation(numeric(form, "latitude")!, numeric(form, "longitude")!);
  if (!isVietnamLocation(point)) throw new ApiError(400, "INVALID_LOCATION", "Chọn vị trí hợp lệ trong Việt Nam.");
  return { title: text(form, "title"), description: text(form, "description"), propertyType: text(form, "propertyType") as HomestayContent["propertyType"],
    addressDetail: text(form, "addressDetail"), provinceCode: text(form, "provinceCode"), wardCode: text(form, "wardCode"), ...point,
    amenityIds: form.getAll("amenityIds").map(String), imageUrls, videoUrl: text(form, "videoUrl") || null };
}
export function homestayUnitInput(form: FormData): UnitInput {
  const time = (key: string) => { const value = text(form, key); return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value; };
  return { unitName: text(form, "unitName"), maxAdults: numeric(form, "maxAdults")!, maxChildren: numeric(form, "maxChildren")!,
    maxGuests: numeric(form, "maxGuests", true), maxNights: numeric(form, "maxNights")!, bedrooms: numeric(form, "bedrooms")!, bathrooms: numeric(form, "bathrooms")!,
    basePricePerNight: numeric(form, "basePricePerNight")!, weekendPricePerNight: numeric(form, "weekendPricePerNight", true), cleaningFee: numeric(form, "cleaningFee")!,
    checkInTime: time("checkInTime"), checkOutTime: time("checkOutTime"), sameDayBookingCutoff: time("sameDayBookingCutoff"),
    cancellationPolicy: text(form, "cancellationPolicy") as UnitInput["cancellationPolicy"], instantBook: form.get("instantBook") === "on" };
}
export function homestayFormContent(record?: OwnHomestay): Partial<HomestayContent> {
  return record?.revision?.content ?? (record ? { ...record, amenityIds: record.amenities.map(item => item.amenityId),
    imageUrls: record.images.toSorted((a, b) => a.position - b.position).map(item => item.url) } : { propertyType: "HOMESTAY", amenityIds: [], imageUrls: [] });
}
export function unitTime(value?: string) {
  return value?.includes("T") ? value.slice(11, 19) : value || "";
}
export const hostHomestaysApi = {
  list: (page: number, admin = false, signal?: AbortSignal) => managementRequest<HomestayPage>(`/${admin ? "admin" : "host"}/homestays`, { params: { page, limit: 10 }, signal }),
  detail: async (id: string, admin = false, signal?: AbortSignal) => (await managementRequest<ApiEnvelope<OwnHomestay>>(`/${admin ? "admin" : "host"}/homestays/${encodeURIComponent(id)}`, { signal })).data,
  save: async (input: HomestayContent, record: OwnHomestay | undefined, firstUnit: UnitInput | undefined, signal?: AbortSignal) => (await managementRequest<ApiEnvelope<OwnHomestay>>(
    `/host/homestays${record ? `/${record.id}` : ""}`, { method: record ? "PUT" : "POST", signal, data: { ...input, ...(record ? { expectedVersion: record.version } : { units: [firstUnit] }) } })).data,
  unit: (record: OwnHomestay, input: UnitInput, unit?: OwnUnit, signal?: AbortSignal) => managementRequest<ApiEnvelope<OwnUnit>>(
    `/host/homestays/${record.id}/units${unit ? `/${unit.id}` : ""}`, { method: unit ? "PUT" : "POST", signal, data: { ...input, expectedVersion: unit?.version ?? record.version } }),
  action: (record: Pick<OwnHomestay, "id" | "version">, action: "hide" | "show" | "delete" | "approve" | "reject", unit?: OwnUnit, signal?: AbortSignal) => managementRequest<ApiEnvelope<unknown>>(
    `/${["approve", "reject"].includes(action) ? "admin" : "host"}/homestays/${record.id}${unit ? `/units/${unit.id}` : ""}${action === "delete" ? "" : `/${action}`}`,
    { method: action === "delete" ? "DELETE" : "POST", signal, data: { expectedVersion: unit?.version ?? record.version } }),
};
