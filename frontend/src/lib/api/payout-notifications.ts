import { managementRequest } from "./client";
import { ApiError } from "@/lib/auth-types";
import type { Page } from "./homestays";

export type PayoutNotification = {
  id: string; batchId: string; type: "CREATED" | "APPROVED" | "CANCELLED" | "PAID";
  message: string; readAt: string | null; createdAt: string;
};
export type PayoutNotificationPage = Page<PayoutNotification> & { meta: { unreadCount: number } };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const timestamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function invalid(): never {
  throw new ApiError(502, "INVALID_PAYOUT_NOTIFICATION_RESPONSE", "Thông báo chi trả chưa hợp lệ. Hãy tải lại; chưa thể xác nhận khoản chi trả.");
}
function notice(v: unknown): v is PayoutNotification {
  return object(v) && Object.keys(v).length === 6 && uuid(v.id) && uuid(v.batchId)
    && typeof v.type === "string" && ["CREATED", "APPROVED", "CANCELLED", "PAID"].includes(v.type)
    && typeof v.message === "string" && !!v.message.trim() && v.message.length <= 500
    && timestamp(v.createdAt) && (v.readAt === null || timestamp(v.readAt));
}
export const payoutNotificationsApi = {
  list: async (page: number, signal?: AbortSignal): Promise<PayoutNotificationPage> => {
    if (!integer(page) || page < 1 || page > 1000000) return invalid();
    const body = await managementRequest<unknown>("/host/payout-notifications", { params: { page, limit: 20 }, signal });
    if (!object(body) || body.success !== true || typeof body.message !== "string"
      || !Array.isArray(body.data) || !object(body.meta)) return invalid();
    const { data, meta } = body;
    if (meta.page !== page || meta.limit !== 20 || !integer(meta.total) || !integer(meta.unreadCount)
      || meta.unreadCount > meta.total || meta.totalPages !== Math.ceil(meta.total / 20)
      || data.length !== Math.min(20, Math.max(0, meta.total - (page - 1) * 20))
      || !data.every(notice) || new Set(data.map(row => row.id.toLowerCase())).size !== data.length
      || data.filter(row => row.readAt === null).length > meta.unreadCount
      || data.filter(row => row.readAt !== null).length > meta.total - meta.unreadCount) return invalid();
    return body as PayoutNotificationPage;
  },
  markRead: async (id: string): Promise<PayoutNotification> => {
    if (!uuid(id)) return invalid();
    const body = await managementRequest<unknown>(`/host/payout-notifications/${encodeURIComponent(id)}/read`, { method: "POST", data: {} });
    if (!object(body) || body.success !== true || typeof body.message !== "string" || !notice(body.data)
      || body.data.id.toLowerCase() !== id.toLowerCase() || body.data.readAt === null) return invalid();
    return body.data;
  },
};
