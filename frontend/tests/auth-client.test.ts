import axios, { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, authApi } from "../src/lib/api/client";
import { isLogoutPending } from "../src/lib/auth-channel";
import { useAuthStore } from "../src/stores/auth-store";

const user = {
  id: "client-user",
  phone: "0912345678",
  email: null,
  fullName: "Nguyễn Văn An",
  role: "TENANT" as const,
  avatarUrl: null,
  isPhoneVerified: true,
  isIdentityVerified: false,
  status: "ACTIVE",
  createdAt: null,
  updatedAt: null,
};

const originalAdapter = api.defaults.adapter;

function response<T>(config: InternalAxiosRequestConfig, data: T, status = 200): AxiosResponse<T> {
  return { data, status, statusText: status === 200 ? "OK" : "Unauthorized", headers: new AxiosHeaders(), config };
}

function unauthenticated(config: InternalAxiosRequestConfig) {
  const failure = new AxiosError("expired", AxiosError.ERR_BAD_REQUEST, config, {}, response(config, {
    success: false,
    errorCode: "UNAUTHORIZED",
    message: "Phiên đăng nhập hết hạn.",
  }, 401));
  return failure;
}

function browserWithSerialLocks() {
  const values = new Map<string, string>();
  let queue = Promise.resolve();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal("BroadcastChannel", class {
    postMessage() {}
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: (_name: string, _options: { mode: string }, callback: () => Promise<unknown>) => {
        const current = queue.then(callback);
        queue = current.then(() => undefined, () => undefined);
        return current;
      },
    },
  });
}

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  useAuthStore.getState().clearSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Axios session coordination", () => {
  it.each([false, true])("handles a final protected 401 after refresh without closing a newer login (%s)", async (newLogin) => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    const refresh = vi.spyOn(axios, "post").mockResolvedValue(response(
      { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, data: { accessToken: "access-new", user } },
    ));
    let calls = 0;
    let rejectRetry!: (error: AxiosError) => void;
    let retryConfig!: InternalAxiosRequestConfig;
    api.defaults.adapter = async (config) => {
      calls += 1;
      if (calls === 1) throw unauthenticated(config);
      retryConfig = config;
      return new Promise((_resolve, reject) => { rejectRetry = reject; });
    };
    const request = authApi.me().catch((error: unknown) => error);
    await vi.waitFor(() => expect(calls).toBe(2));
    if (newLogin) useAuthStore.getState().setSession("access-second", { ...user, id: "second-user" });
    rejectRetry(unauthenticated(retryConfig));
    expect(await request).toMatchObject({ status: 401 });
    expect(refresh).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().status).toBe(newLogin ? "authenticated" : "anonymous");
    expect(useAuthStore.getState().user?.id).toBe(newLogin ? "second-user" : undefined);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(newLogin ? 0 : 1);
    expect(isLogoutPending()).toBe(!newLogin);
  });
  it.each([200, 401])("finishes old refresh Set-Cookie before issuing a new login (refresh status %s)", async (status) => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    let finish!: (value: AxiosResponse) => void;
    let reject!: (error: AxiosError) => void;
    let cookie = "refresh-old";
    const refresh = vi.spyOn(axios, "post").mockImplementation(() => new Promise<AxiosResponse>((resolve, fail) => {
      finish = resolve; reject = fail;
    }) as never);
    let logins = 0;
    api.defaults.adapter = async (config) => {
      expect(config.url).toBe("/login");
      logins += 1;
      cookie = "refresh-second";
      return response(config, { success: true, data: { accessToken: "access-second", user: { ...user, id: "second-user" } } });
    };
    const pendingRefresh = authApi.refresh().catch((error: unknown) => error);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const login = authApi.login({ phone: user.phone, password: "Password123" });
    await Promise.resolve();
    expect(logins).toBe(0);
    cookie = status === 200 ? "refresh-rotated-old" : "";
    if (status === 200) finish(response({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, data: { accessToken: "access-rotated-old", user } }));
    else reject(unauthenticated({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig));
    await pendingRefresh;
    await login;
    expect(cookie).toBe("refresh-second");
    expect(useAuthStore.getState().user?.id).toBe("second-user");
  });

  it("completes logout cookie/store cleanup before a queued login", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    let finishLogout!: () => void;
    let logoutStarted = false;
    let loginStarted = false;
    let cookie = "refresh-old";
    api.defaults.adapter = async (config) => {
      if (config.url === "/logout") {
        logoutStarted = true;
        await new Promise<void>((resolve) => { finishLogout = resolve; });
        cookie = "";
        return response(config, { success: true, data: { signedOut: true } });
      }
      loginStarted = true;
      cookie = "refresh-second";
      return response(config, { success: true, data: { accessToken: "access-second", user: { ...user, id: "second-user" } } });
    };
    const logout = authApi.logout();
    await vi.waitFor(() => expect(logoutStarted).toBe(true));
    const login = authApi.login({ phone: user.phone, password: "Password123" });
    await Promise.resolve();
    expect(loginStarted).toBe(false);
    finishLogout();
    await Promise.all([logout, login]);
    expect(cookie).toBe("refresh-second");
    expect(useAuthStore.getState().user?.id).toBe("second-user");
    expect(isLogoutPending()).toBe(false);
  });
  it.each([false, true])("handles a rejected old refresh without closing a newer login (new login: %s)", async (newLogin) => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    let rejectRefresh!: (error: AxiosError) => void;
    const refresh = vi.spyOn(axios, "post").mockImplementation(() => new Promise<AxiosResponse>((_resolve, reject) => { rejectRefresh = reject; }) as never);
    api.defaults.adapter = async (config) => { throw unauthenticated(config); };
    const pending = authApi.me().catch((error: unknown) => error);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    if (newLogin) useAuthStore.getState().setSession("access-second", { ...user, id: "second-user" });
    rejectRefresh(unauthenticated({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig));
    const result = await pending;
    if (newLogin) {
      expect(result).toMatchObject({ errorCode: "SESSION_CHANGED" });
      expect(useAuthStore.getState().accessToken).toBe("access-second");
      expect(useAuthStore.getState().user?.id).toBe("second-user");
      expect(window.dispatchEvent).not.toHaveBeenCalled();
      expect(isLogoutPending()).toBe(false);
    } else {
      expect(result).toMatchObject({ status: 401 });
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(window.dispatchEvent).toHaveBeenCalledOnce();
      expect(isLogoutPending()).toBe(true);
    }
  });

  it("does not overwrite a newer login with an old refresh response", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    let finish!: (value: AxiosResponse) => void;
    const refresh = vi.spyOn(axios, "post").mockImplementation(() => new Promise<AxiosResponse>((resolve) => { finish = resolve; }) as never);
    const pending = authApi.refresh().catch((error: unknown) => error);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    useAuthStore.getState().setSession("access-second", { ...user, id: "second-user" });
    finish(response({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, message: "ok", data: { accessToken: "access-stale", user } }));
    expect(await pending).toMatchObject({ errorCode: "SESSION_CHANGED" });
    expect(useAuthStore.getState().accessToken).toBe("access-second");
    expect(useAuthStore.getState().user?.id).toBe("second-user");
  });

  it("shares one refresh across concurrent protected 401s", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    const refresh = vi.spyOn(axios, "post").mockResolvedValue(response(
      { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, message: "ok", data: { accessToken: "access-new", user } },
    ));
    let meRequests = 0;
    api.defaults.adapter = async (config) => {
      meRequests += 1;
      const token = config.headers.get("Authorization");
      if (token !== "Bearer access-new") throw unauthenticated(config);
      return response(config, { success: true, message: "ok", data: user });
    };

    const [first, second] = await Promise.all([authApi.me(), authApi.me()]);

    expect(first.id).toBe(user.id);
    expect(second.id).toBe(user.id);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(meRequests).toBe(4);
    expect(useAuthStore.getState().accessToken).toBe("access-new");
  });

  it("does not restore a session when logout starts during an in-flight refresh", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    let finishRefresh!: (value: AxiosResponse) => void;
    const pendingRefresh = new Promise<AxiosResponse>((resolve) => { finishRefresh = resolve; });
    const refresh = vi.spyOn(axios, "post").mockImplementation(() => pendingRefresh as never);
    let meRequests = 0;
    api.defaults.adapter = async (config) => {
      if (config.url === "/logout") return response(config, { success: true, message: "ok", data: { signedOut: true } });
      meRequests += 1;
      throw unauthenticated(config);
    };

    const pendingMe = authApi.me().then((value) => value, (error: unknown) => error);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const pendingLogout = authApi.logout();
    finishRefresh(response(
      { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, message: "ok", data: { accessToken: "access-stale", user } },
    ));

    const result = await pendingMe;
    await pendingLogout;

    expect(result).toMatchObject({ errorCode: "SESSION_CLOSED" });
    expect(meRequests).toBe(1);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(isLogoutPending()).toBe(true);
  });
});
