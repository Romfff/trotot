export type User = {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  role: "TENANT" | "HOST" | "ADMIN";
  avatarUrl: string | null;
  isPhoneVerified: boolean | null;
  isIdentityVerified: boolean | null;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ApiEnvelope<T> = { success: true; message: string; data: T };
export type ApiErrorBody = { success: false; errorCode: string; message: string; errors?: { field: string; message: string }[]; data?: unknown };

export class ApiError extends Error {
  constructor(readonly status: number, readonly errorCode: string, message: string, readonly fieldErrors: Record<string, string> = {}, readonly data?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export function toApiError(status: number, body: Partial<ApiErrorBody>) {
  return new ApiError(status, body.errorCode || "REQUEST_FAILED", body.message || "Đã xảy ra lỗi. Vui lòng thử lại.",
    Object.fromEntries((body.errors || []).map((error) => [error.field, error.message])), body.errorCode === "PRICE_CHANGED" ? body.data
      : body.errorCode === "STALE_APPOINTMENT_STATUS" && body.data && typeof body.data === "object" && "currentStatus" in body.data
        && ["PENDING", "ACCEPTED", "REJECTED", "COMPLETED", "CANCELLED"].includes(String(body.data.currentStatus))
        ? { currentStatus: body.data.currentStatus } : undefined);
}
