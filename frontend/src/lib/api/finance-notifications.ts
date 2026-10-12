import { managementRequest } from "./client";
import type { ApiEnvelope } from "@/lib/auth-types";
import type { Page } from "./homestays";

export type FinanceNotification = {
  id: string; complaintId: string; bookingId: string;
  type: "CREATED" | "RESPONDED" | "RESOLVED";
  message: string; readAt: string | null; createdAt: string;
};
export const financeNotificationsApi = {
  list: (page: number, signal?: AbortSignal) => managementRequest<Page<FinanceNotification> & { meta: { unreadCount: number } }>(
    "/finance/notifications", { params: { page, limit: 20 }, signal },
  ),
  markRead: async (id: string) => (
    await managementRequest<ApiEnvelope<FinanceNotification>>(`/finance/notifications/${encodeURIComponent(id)}/read`, { method: "POST", data: {} })
  ).data,
};
