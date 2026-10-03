import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { ApiError, toApiError, type ApiEnvelope, type ApiErrorBody } from "@/lib/auth-types";
import { isLogoutPending, publishAuth } from "@/lib/auth-channel";
import { useAuthStore } from "@/stores/auth-store";

type RetryConfig = InternalAxiosRequestConfig & { _authRetried?: boolean; _authSession?: ReturnType<typeof useAuthStore.getState> };
type SessionPayload = { accessToken: string; user: import("@/lib/auth-types").User };
export const api = axios.create({ baseURL: "/api/auth", timeout: 12_000, headers: { "Content-Type": "application/json" }, withCredentials: true });
let refreshing: Promise<string> | null = null;

function payload<T>(response: { data: ApiEnvelope<T> }): T {
  return response.data.data;
}

function onSession(session: SessionPayload) {
  useAuthStore.getState().setSession(session.accessToken, session.user);
  publishAuth({ type: "session", ...session });
}

async function requestRefresh(): Promise<string> {
  if (isLogoutPending()) throw new ApiError(0, "SESSION_CLOSED", "Phiên đăng nhập đang được đóng.");
  const previousSession = useAuthStore.getState();
  try {
    const response = await axios.post<ApiEnvelope<SessionPayload>>("/api/auth/refresh", {}, {
      withCredentials: true,
      headers: { "Content-Type": "application/json" },
      timeout: 12_000,
    });
    const session = payload(response);
    if (isLogoutPending()) throw new ApiError(0, "SESSION_CLOSED", "Phiên đăng nhập đang được đóng.");
    if (useAuthStore.getState() !== previousSession) throw new ApiError(0, "SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
    onSession(session);
    return session.accessToken;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isLogoutPending()) throw new ApiError(0, "SESSION_CLOSED", "Phiên đăng nhập đã được đóng.");
    if (useAuthStore.getState() !== previousSession) throw new ApiError(0, "SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
    if (error instanceof AxiosError && error.response) {
      throw toApiError(error.response.status, error.response.data);
    }
    if (error instanceof AxiosError) {
      throw new ApiError(0, "NETWORK_ERROR", "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
    }
    throw error;
  }
}

async function refreshAcrossTabs(failedToken: string | null): Promise<string> {
  if (isLogoutPending()) throw new ApiError(0, "SESSION_CLOSED", "Phiên đăng nhập đã được đóng.");
  return withSessionLock(async () => {
    if (isLogoutPending()) throw new ApiError(0, "SESSION_CLOSED", "Phiên đăng nhập đã được đóng.");
    const current = useAuthStore.getState().accessToken;
    if (current && current !== failedToken) return current;
    return requestRefresh();
  });
}

async function withSessionLock<T>(callback: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    throw new ApiError(0, "BROWSER_LOCKS_UNAVAILABLE", "Trình duyệt chưa hỗ trợ đồng bộ phiên. Hãy cập nhật trình duyệt rồi thử lại.");
  }
  // Hold until Set-Cookie and the matching memory/broadcast update have finished.
  return navigator.locks.request("trotot-auth-refresh-v1", { mode: "exclusive" }, callback);
}

api.interceptors.request.use((config) => {
  const session = useAuthStore.getState();
  (config as RetryConfig)._authSession = session;
  const token = session.accessToken;
  if (token && (config.url === "/me" || config.url === "/logout")) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function expireSession(session: ReturnType<typeof useAuthStore.getState> | undefined) {
  if (!session || useAuthStore.getState() !== session) return;
  session.clearSession();
  publishAuth({ type: "logout" });
  window.dispatchEvent(new CustomEvent("trotot:session-expired"));
}

api.interceptors.response.use((response) => response, async (error: AxiosError<ApiErrorBody>) => {
  const config = error.config as RetryConfig | undefined;
  const excluded = ["/login", "/register", "/send-otp", "/verify-otp", "/forgot-password", "/reset-password", "/refresh", "/logout"];
  if (error.response?.status === 401 && config && !config._authRetried && !excluded.includes(config.url || "")) {
    config._authRetried = true;
    const failedSession = useAuthStore.getState();
    const failedToken = failedSession.accessToken;
    try {
      refreshing ??= refreshAcrossTabs(failedToken).finally(() => { refreshing = null; });
      const token = await refreshing;
      config.headers.Authorization = `Bearer ${token}`;
      return api.request(config);
    } catch (refreshError) {
      if (refreshError instanceof ApiError && refreshError.status === 401 && useAuthStore.getState() === failedSession) {
        expireSession(failedSession);
      }
      return Promise.reject(refreshError);
    }
  }
  if (error.response?.status === 401 && config?._authRetried && !excluded.includes(config.url || "")) {
    // The renewed credential also failed. Do not leave the UI authenticated,
    // but never let a late failure close a different/newer session.
    expireSession(config._authSession);
  }
  if (error.response) {
    return Promise.reject(toApiError(error.response.status, error.response.data));
  }
  if (error instanceof AxiosError) {
    return Promise.reject(new ApiError(0, "NETWORK_ERROR", "Không kết nối được máy chủ. Kiểm tra mạng và thử lại."));
  }
  return Promise.reject(error);
});

export const authApi = {
  async register(input: { fullName: string; phone: string; password: string; email?: string }) {
    return payload(await api.post<ApiEnvelope<{ user: unknown }>>("/register", input));
  },
  async login(input: { phone: string; password: string }) {
    return withSessionLock(async () => {
      const result = payload(await api.post<ApiEnvelope<SessionPayload>>("/login", input));
      onSession(result);
      return result;
    });
  },
  async sendOtp(input: { phone: string; purpose: "VERIFY_PHONE" | "RESET_PASSWORD" }) {
    return payload(await api.post<ApiEnvelope<{ accepted: boolean; expiresInSeconds: number; devOtp?: string }>>("/send-otp", input));
  },
  async verifyOtp(input: { phone: string; code: string }) {
    return payload(await api.post<ApiEnvelope<{ verified: boolean; phone: string }>>("/verify-otp", input));
  },
  async forgotPassword(input: { phone: string }) {
    return payload(await api.post<ApiEnvelope<{ accepted: boolean; expiresInSeconds: number; devOtp?: string }>>("/forgot-password", input));
  },
  async resetPassword(input: { phone: string; code: string; newPassword: string }) {
    return withSessionLock(async () => {
      const result = payload(await api.post<ApiEnvelope<{ passwordUpdated: boolean }>>("/reset-password", input));
      useAuthStore.getState().clearSession();
      publishAuth({ type: "logout" });
      window.dispatchEvent(new CustomEvent("trotot:logout"));
      return result;
    });
  },
  async refresh() {
    return refreshAcrossTabs(useAuthStore.getState().accessToken);
  },
  async me() {
    return payload(await api.get<ApiEnvelope<SessionPayload["user"]>>("/me"));
  },
  async logout() {
    const accessToken = useAuthStore.getState().accessToken;
    publishAuth({ type: "logout-start" });
    useAuthStore.getState().clearSession();
    const sendLogout = async () => {
      try {
        await api.post("/logout", {}, {
          headers: accessToken ? { Authorization: "Bearer " + accessToken } : undefined,
        });
      } finally {
        useAuthStore.getState().clearSession();
        publishAuth({ type: "logout" });
        window.dispatchEvent(new CustomEvent("trotot:logout"));
      }
    };
    if (typeof navigator !== "undefined" && navigator.locks) {
      await withSessionLock(sendLogout);
    } else {
      await sendLogout();
    }
  },
};

export function apiError(error: unknown) {
  if (error instanceof ApiError) return error;
  return new ApiError(0, "REQUEST_FAILED", "Đã có lỗi. Vui lòng thử lại.");
}
