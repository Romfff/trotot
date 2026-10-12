import { managementRequest } from "./client";
import { ApiError, type ApiEnvelope } from "@/lib/auth-types";
import type { Page } from "./homestays";

// Existing owner-approved calendar contract; prices/status/version are server-owned.
export type HostHomestay = {
  id: string; title: string; status: string;
  homestayUnits: { id: string; unitName: string; status: string; version: number }[];
};
export type HostCalendar = {
  unitId: string; month: string; timeZone: "Asia/Ho_Chi_Minh"; version: number;
  days: { date: string; status: "AVAILABLE" | "HELD" | "PENDING_HOST_APPROVAL" | "BOOKED" | "BLOCKED"; price: number; bookingId?: string }[];
};
export type CalendarWriteResult = { version: number; updatedDates: string[] };
export type CalendarBooking = {
  bookingId: string; bookingCode: string; unitId: string;
  checkInDate: string; checkOutDate: string;
  guestName: string; guestPhone: string; bookingStatus: string; paymentStatus: string;
};
type CalendarWrite = { dates: string[]; expectedVersion: number };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const versionValid = (value: number) => Number.isInteger(value) && value > 0 && value <= 2147483647;
function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new ApiError(502, "INVALID_HOST_CALENDAR_RESPONSE", "Dữ liệu lịch phòng không hợp lệ. Vui lòng tải lại.");
}
function monthDates(month: string) {
  requireValid(/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && !month.startsWith("0000"));
  const start = new Date(`${month}-01T00:00:00Z`);
  const dates: string[] = [];
  while (start.toISOString().slice(0, 7) === month) {
    dates.push(start.toISOString().slice(0, 10));
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return dates;
}
function writeResult(response: ApiEnvelope<CalendarWriteResult>, input: CalendarWrite) {
  requireValid(response?.success === true && typeof response.message === "string");
  const data = response.data;
  requireValid(data && versionValid(data.version) && data.version === input.expectedVersion + 1
    && Array.isArray(data.updatedDates) && data.updatedDates.length === input.dates.length
    && input.dates.length > 0 && new Set(data.updatedDates).size === data.updatedDates.length
    && data.updatedDates.every((date, index) => date === input.dates[index]
      && /^\d{4}-\d{2}-\d{2}$/.test(date) && monthDates(date.slice(0, 7)).includes(date)));
  return data;
}

export const hostCalendarApi = {
  booking: async (unitId: string, bookingId: string, date: string, signal?: AbortSignal): Promise<CalendarBooking> => {
    const response = await managementRequest<ApiEnvelope<CalendarBooking>>(`/host/bookings/${encodeURIComponent(bookingId)}`, { signal });
    const data = response?.data;
    requireValid(response?.success === true && typeof response.message === "string" && data
      && typeof data.bookingId === "string" && uuid.test(data.bookingId) && data.bookingId.toLowerCase() === bookingId.toLowerCase()
      && typeof data.unitId === "string" && uuid.test(data.unitId) && data.unitId.toLowerCase() === unitId.toLowerCase()
      && [data.checkInDate, data.checkOutDate, date].every(value => typeof value === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(value) && monthDates(value.slice(0, 7)).includes(value))
      && data.checkInDate <= date && date < data.checkOutDate
      && [data.bookingCode, data.guestName, data.guestPhone, data.bookingStatus, data.paymentStatus]
        .every(value => typeof value === "string" && value.trim().length > 0));
    // Keep only fields displayed here; do not cache the full guest/policy payload.
    return { bookingId: data.bookingId, bookingCode: data.bookingCode, unitId: data.unitId,
      checkInDate: data.checkInDate, checkOutDate: data.checkOutDate, guestName: data.guestName,
      guestPhone: data.guestPhone, bookingStatus: data.bookingStatus, paymentStatus: data.paymentStatus };
  },
  homestays: async (page: number, signal?: AbortSignal) => {
    const response = await managementRequest<Page<HostHomestay>>("/host/homestays", { params: { page, limit: 20 }, signal });
    requireValid(response?.success === true && Array.isArray(response.data) && response.meta
      && response.meta.page === page && response.meta.limit === 20 && Number.isSafeInteger(response.meta.total) && response.meta.total >= 0
      && response.meta.totalPages === Math.ceil(response.meta.total / 20) && response.data.length <= 20 && response.data.length <= response.meta.total);
    requireValid(response.data.every(property => property && typeof property.id === "string" && uuid.test(property.id)
      && typeof property.title === "string" && property.title.trim() && typeof property.status === "string" && Array.isArray(property.homestayUnits)
      && property.homestayUnits.every(unit => unit && typeof unit.id === "string" && uuid.test(unit.id)
        && typeof unit.unitName === "string" && unit.unitName.trim() && typeof unit.status === "string" && versionValid(unit.version))));
    requireValid(new Set(response.data.map(property => property.id)).size === response.data.length);
    const units = response.data.flatMap(property => property.homestayUnits.map(unit => unit.id));
    requireValid(new Set(units).size === units.length);
    return response;
  },
  read: async (unitId: string, month: string, signal?: AbortSignal) => {
    const response = await managementRequest<ApiEnvelope<HostCalendar>>(`/host/calendar/${encodeURIComponent(unitId)}`, { params: { month }, signal });
    requireValid(response?.success === true && typeof response.message === "string");
    const data = response.data;
    const dates = monthDates(month);
    requireValid(data && typeof data.unitId === "string" && uuid.test(data.unitId) && data.unitId.toLowerCase() === unitId.toLowerCase()
      && data.month === month && data.timeZone === "Asia/Ho_Chi_Minh" && versionValid(data.version)
      && Array.isArray(data.days) && data.days.length === dates.length);
    requireValid(data.days.every((day, index) => day && day.date === dates[index]
      && ["AVAILABLE", "HELD", "PENDING_HOST_APPROVAL", "BOOKED", "BLOCKED"].includes(day.status)
      && Number.isSafeInteger(day.price) && day.price >= 0
      && (day.bookingId === undefined || (typeof day.bookingId === "string" && uuid.test(day.bookingId)))
      && (!["HELD", "PENDING_HOST_APPROVAL"].includes(day.status) || day.bookingId !== undefined)
      && (!["AVAILABLE", "BLOCKED"].includes(day.status) || day.bookingId === undefined)));
    return data;
  },
  pricing: async (unitId: string, input: CalendarWrite & { customPrice: number | null }, key: string) => writeResult(
    await managementRequest<ApiEnvelope<CalendarWriteResult>>(`/host/calendar/${encodeURIComponent(unitId)}/pricing`, {
      method: "PUT", data: input, headers: { "Idempotency-Key": key },
    }), input,
  ),
  block: async (unitId: string, input: CalendarWrite & { isBlocked: boolean }, key: string) => writeResult(
    await managementRequest<ApiEnvelope<CalendarWriteResult>>(`/host/calendar/${encodeURIComponent(unitId)}/toggle-block`, {
      method: "POST", data: input, headers: { "Idempotency-Key": key },
    }), input,
  ),
};
