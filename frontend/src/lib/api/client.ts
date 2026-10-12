import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { ApiError, toApiError, type ApiEnvelope, type ApiErrorBody } from "@/lib/auth-types";
import { getSharedSessionId, isLogoutPending, publishAuth } from "@/lib/auth-channel";
import { useAuthStore } from "@/stores/auth-store";

type RetryConfig = InternalAxiosRequestConfig & {
  _authRetried?: boolean;
  _authSession?: ReturnType<typeof useAuthStore.getState>;
  _authSessionId?: string | null;
};
type SessionPayload = { accessToken: string; user: import("@/lib/auth-types").User };
export const api = axios.create({ baseURL: "/api/auth", timeout: 12_000, headers: { "Content-Type": "application/json" }, withCredentials: true });
let refreshing: { sessionId: string | null; promise: Promise<string> } | null = null;
const refreshPendingKey = "trotot-auth-refresh-pending-until";
// ponytail: bounded unload coordination, not durable recovery of a lost
// response; a server acknowledgement protocol is needed beyond this window.
const refreshUnloadWindowMs = 15_000; // BFF upstream timeout is 10s; client timeout is 12s.

function refreshStorage() {
  try { return window.localStorage; }
  catch { throw new ApiError(0, "BROWSER_STORAGE_UNAVAILABLE", "Không thể đồng bộ phiên. Hãy cho phép lưu trữ trình duyệt rồi thử lại."); }
}

async function waitForUnloadedRefresh() {
  try {
    const storage = refreshStorage(), pending = storage.getItem(refreshPendingKey);
    if (!pending) return;
    // The Web Lock dies with the document, but a keepalive response can still
    // write Set-Cookie. Metadata is not a credential or an authentication grant.
    const remaining = Math.min(refreshUnloadWindowMs, Math.max(0, (Number(pending) || 0) - Date.now()));
    // Wall-clock adjustments must not extend a live wait indefinitely.
    const until = performance.now() + remaining;
    while (performance.now() < until && storage.getItem(refreshPendingKey) === pending) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (storage.getItem(refreshPendingKey) === pending) storage.removeItem(refreshPendingKey);
  } catch {
    throw new ApiError(0, "BROWSER_STORAGE_UNAVAILABLE", "Không thể đồng bộ phiên. Hãy cho phép lưu trữ trình duyệt rồi thử lại.");
  }
}

function payload<T>(response: { data: ApiEnvelope<T> }): T {
  return response.data.data;
}

function onSession(session: SessionPayload, sessionId?: string) {
  useAuthStore.getState().setSession(session.accessToken, session.user, sessionId);
  publishAuth({ type: "session", ...session, sessionId: useAuthStore.getState().sessionId ?? undefined });
}

function assertSession(sessionId: string | null | undefined) {
  if (isLogoutPending()) throw new ApiError(0, "SESSION_CLOSED", "Phiên đăng nhập đã được đóng.");
  const sharedSessionId = getSharedSessionId();
  if (sessionId === undefined || useAuthStore.getState().sessionId !== sessionId
    || (sessionId && sharedSessionId && sharedSessionId !== sessionId)) {
    throw new ApiError(0, "SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
  }
}

async function requestRefresh(): Promise<string> {
  if (isLogoutPending()) throw new ApiError(0, "SESSION_CLOSED", "Phiên đăng nhập đang được đóng.");
  const previousSession = useAuthStore.getState();
  const previousSharedSessionId = getSharedSessionId();
  const pending = String(Date.now() + refreshUnloadWindowMs);
  let responseReceived = false;
  try {
    // Fail closed if shared coordination cannot be written, rather than risk
    // rotating a credential that the next document cannot safely receive.
    try { refreshStorage().setItem(refreshPendingKey, pending); }
    catch { throw new ApiError(0, "BROWSER_STORAGE_UNAVAILABLE", "Không thể đồng bộ phiên. Hãy cho phép lưu trữ trình duyệt rồi thử lại."); }
    const response = await axios.post<ApiEnvelope<SessionPayload>>("/api/auth/refresh", {}, {
      // Rotation can commit while this document is unloading. Let the browser
      // finish receiving its HttpOnly Set-Cookie instead of aborting the XHR.
      adapter: "fetch",
      fetchOptions: { keepalive: true },
      withCredentials: true,
      headers: { "Content-Type": "application/json" },
      timeout: 12_000,
    });
    responseReceived = true;
    const session = payload(response);
    assertSession(previousSession.sessionId);
    if (useAuthStore.getState() !== previousSession || getSharedSessionId() !== previousSharedSessionId
      || (previousSession.user && session.user.id !== previousSession.user.id)) {
      throw new ApiError(0, "SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
    }
    onSession(session, previousSession.sessionId ?? previousSharedSessionId ?? undefined);
    return session.accessToken;
  } catch (error) {
    if (error instanceof AxiosError && error.response) responseReceived = true;
    if (error instanceof ApiError) throw error;
    assertSession(previousSession.sessionId);
    if (useAuthStore.getState() !== previousSession || getSharedSessionId() !== previousSharedSessionId) {
      throw new ApiError(0, "SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
    }
    if (error instanceof AxiosError && error.response) {
      throw toApiError(error.response.status, error.response.data);
    }
    if (error instanceof AxiosError) {
      throw new ApiError(0, "NETWORK_ERROR", "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
    }
    throw error;
  } finally {
    try {
      const storage = refreshStorage();
      // A rejected/aborted fetch is NOT an acknowledgement: keepalive may
      // still deliver Set-Cookie after the promise failed during navigation.
      if (responseReceived && storage.getItem(refreshPendingKey) === pending) storage.removeItem(refreshPendingKey);
    } catch { /* Keep the bounded marker if storage becomes unavailable. */ }
  }
}

async function refreshAcrossTabs(failedToken: string | null, sessionId: string | null): Promise<string> {
  assertSession(sessionId);
  const sharedSessionId = getSharedSessionId();
  return withSessionLock(async () => {
    assertSession(sessionId);
    if (getSharedSessionId() !== sharedSessionId) throw new ApiError(0, "SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
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
  return navigator.locks.request("trotot-auth-refresh-v1", { mode: "exclusive" }, async () => {
    await waitForUnloadedRefresh();
    return callback();
  });
}

api.interceptors.request.use((config) => {
  const session = useAuthStore.getState();
  const retryConfig = config as RetryConfig;
  if (retryConfig._authRetried) assertSession(retryConfig._authSessionId);
  else retryConfig._authSessionId = session.sessionId;
  retryConfig._authSession = session;
  const token = session.accessToken;
  if (config.baseURL === "/api/management") {
    assertSession(retryConfig._authSessionId);
    if (!token) throw new ApiError(401, "ACCESS_TOKEN_REQUIRED", "Cần đăng nhập để tiếp tục.");
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (token && (config.url === "/me" || config.url === "/become-host")) assertSession(retryConfig._authSessionId);
  if (token && (config.url === "/me" || config.url === "/logout" || config.url === "/become-host")) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function expireSession(session: ReturnType<typeof useAuthStore.getState> | undefined) {
  if (!session || useAuthStore.getState() !== session) return;
  const sharedSessionId = getSharedSessionId();
  if (sharedSessionId && sharedSessionId !== session.sessionId) return;
  session.clearSession();
  publishAuth({ type: "logout" });
  window.dispatchEvent(new CustomEvent("trotot:session-expired"));
}

api.interceptors.response.use((response) => {
  if (response.config.baseURL === "/api/management") {
    const sent = response.config as RetryConfig;
    assertSession(sent._authSessionId);
    const current = useAuthStore.getState().user;
    const previous = sent._authSession?.user;
    if (!current || current.id !== previous?.id || current.role !== previous?.role || current.status !== previous?.status) {
      throw new ApiError(0, "SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
    }
  }
  return response;
}, async (error: AxiosError<ApiErrorBody>) => {
  const config = error.config as RetryConfig | undefined;
  const excluded = ["/login", "/register", "/send-otp", "/verify-otp", "/forgot-password", "/reset-password", "/refresh", "/logout"];
  if (error.response?.status === 401 && config && !config._authRetried && !excluded.includes(config.url || "")) {
    const failedSession = useAuthStore.getState();
    try {
      assertSession(config._authSessionId);
      config._authRetried = true;
      const sessionId = config._authSessionId as string | null;
      const failedToken = config._authSession?.accessToken ?? null;
      if (!refreshing || refreshing.sessionId !== sessionId) {
        const pending = { sessionId, promise: refreshAcrossTabs(failedToken, sessionId) };
        pending.promise = pending.promise.finally(() => { if (refreshing === pending) refreshing = null; });
        refreshing = pending;
      }
      const token = await refreshing.promise;
      assertSession(sessionId);
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
    const session = useAuthStore.getState();
    return refreshAcrossTabs(session.accessToken, session.sessionId);
  },
  async me() {
    return payload(await api.get<ApiEnvelope<SessionPayload["user"]>>("/me"));
  },
  async becomeHost() {
    // Do not hold the refresh lock across this request: a 401 may need to acquire it.
    const response = await api.post<ApiEnvelope<{ user: SessionPayload["user"] }>>("/become-host", {});
    const result = payload(response);
    // Publish the confirmed role AFTER any older refresh has finished publishing.
    // Only lock this local update, never the protected HTTP request/retry above.
    return withSessionLock(async () => {
      const current = useAuthStore.getState();
      if (isLogoutPending() || !current.accessToken || current.sessionId !== (response.config as RetryConfig)._authSessionId) {
        throw new ApiError(0, "SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
      }
      assertSession((response.config as RetryConfig)._authSessionId);
      if (result.user?.id !== current.user?.id || result.user?.role !== "HOST") {
        throw new ApiError(502, "INVALID_BACKEND_RESPONSE", "Máy chủ trả thông tin Host không hợp lệ.");
      }
      onSession({ accessToken: current.accessToken, user: result.user }, current.sessionId ?? undefined);
      return result;
    });
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

// Reuse Auth refresh/session coordination for same-origin private management calls.
export async function managementRequest<T>(path: string, options: { method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; data?: unknown; params?: Record<string, number | string>; headers?: Record<string,string>; signal?: AbortSignal } = {}): Promise<T> {
  const response = await api.request<T>({ ...options, baseURL: "/api/management", url: path });
  return response.data;
}
