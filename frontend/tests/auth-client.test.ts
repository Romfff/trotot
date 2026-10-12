import axios, { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, authApi, managementRequest } from "../src/lib/api/client";
import { isLogoutPending, publishAuth } from "../src/lib/auth-channel";
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
  vi.useRealTimers();
  api.defaults.adapter = originalAdapter;
  useAuthStore.getState().clearSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Axios session coordination", () => {
  it("keeps refresh in flight across document unload without exposing credentials to storage", async () => {
    browserWithSerialLocks();
    const refresh = vi.spyOn(axios, "post").mockResolvedValue(response({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, data: { accessToken: "access-new", user } }));
    expect(await authApi.refresh()).toBe("access-new");
    expect(refresh).toHaveBeenCalledWith("/api/auth/refresh", {}, expect.objectContaining({
      adapter: "fetch", fetchOptions: { keepalive: true }, withCredentials: true, timeout: 12_000,
    }));
    expect(window.localStorage.getItem("trotot-auth-session-id")).toBe(useAuthStore.getState().sessionId);
    expect(window.localStorage.getItem("trotot-auth-refresh-pending-until")).toBeNull();
  });
  it.each(["refresh", "login", "logout"] as const)("waits for an unloaded refresh before issuing %s", async (action) => {
    browserWithSerialLocks();vi.useFakeTimers();
    window.localStorage.setItem("trotot-auth-refresh-pending-until", String(Date.now()+15_000));
    const refresh = vi.spyOn(axios,"post").mockResolvedValue(response({headers:new AxiosHeaders()} as InternalAxiosRequestConfig,
      {success:true,data:{accessToken:"new-access",user}}));
    const dispatch=vi.fn(async(config:InternalAxiosRequestConfig)=>response(config,{success:true,data:{accessToken:"login-access",user}}));
    api.defaults.adapter=dispatch;
    const pending=action==="login"?authApi.login({phone:user.phone,password:"Password123"}):authApi[action]();
    await vi.advanceTimersByTimeAsync(14_900);
    expect(refresh).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);await pending;
    expect(action==="refresh"?refresh:dispatch).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("trotot-auth-refresh-pending-until")).toBeNull();
  });
  it("resumes promptly when another live tab completes refresh and removes its marker", async()=>{
    browserWithSerialLocks();vi.useFakeTimers();
    window.localStorage.setItem("trotot-auth-refresh-pending-until",String(Date.now()+15_000));
    const refresh=vi.spyOn(axios,"post").mockResolvedValue(response({headers:new AxiosHeaders()} as InternalAxiosRequestConfig,
      {success:true,data:{accessToken:"new-access",user}}));
    const pending=authApi.refresh();await vi.advanceTimersByTimeAsync(100);
    expect(refresh).not.toHaveBeenCalled();window.localStorage.removeItem("trotot-auth-refresh-pending-until");
    await vi.advanceTimersByTimeAsync(100);expect(await pending).toBe("new-access");
  });
  it.each(["invalid", "Infinity", String(9_999_999_999_999)])("bounds stale or malformed coordination metadata (%s)",async(value)=>{
    browserWithSerialLocks();vi.useFakeTimers();window.localStorage.setItem("trotot-auth-refresh-pending-until",value);
    const refresh=vi.spyOn(axios,"post").mockResolvedValue(response({headers:new AxiosHeaders()} as InternalAxiosRequestConfig,
      {success:true,data:{accessToken:"new-access",user}}));
    const pending=authApi.refresh();await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toBe("new-access");expect(refresh).toHaveBeenCalledOnce();
  });
  it("does not rotate when browser storage is blocked",async()=>{
    browserWithSerialLocks();vi.spyOn(window.localStorage,"setItem").mockImplementation(()=>{throw new Error("blocked");});
    const refresh=vi.spyOn(axios,"post");
    expect(await authApi.refresh().catch(error=>error)).toMatchObject({errorCode:"BROWSER_STORAGE_UNAVAILABLE"});
    expect(refresh).not.toHaveBeenCalled();expect(useAuthStore.getState().user).toBeNull();
  });
  it("keeps the wait bounded if the wall clock moves backwards",async()=>{
    browserWithSerialLocks();vi.useFakeTimers();
    const started=Date.now();window.localStorage.setItem("trotot-auth-refresh-pending-until",String(started+15_000));
    const refresh=vi.spyOn(axios,"post").mockResolvedValue(response({headers:new AxiosHeaders()} as InternalAxiosRequestConfig,
      {success:true,data:{accessToken:"new-access",user}}));
    const pending=authApi.refresh();await vi.advanceTimersByTimeAsync(100);
    vi.setSystemTime(started-3_600_000);await vi.advanceTimersByTimeAsync(14_900);
    expect(await pending).toBe("new-access");expect(refresh).toHaveBeenCalledOnce();
  });
  it("retains a bounded marker after an unacknowledged refresh without claiming a session",async()=>{
    browserWithSerialLocks();
    vi.spyOn(axios,"post").mockRejectedValue(new AxiosError("offline"));
    expect(await authApi.refresh().catch(error=>error)).toMatchObject({errorCode:"NETWORK_ERROR"});
    expect(Number(window.localStorage.getItem("trotot-auth-refresh-pending-until"))).toBeGreaterThan(Date.now());
    expect(useAuthStore.getState().user).toBeNull();
  });
  it("clears coordination after a confirmed HTTP rejection",async()=>{
    browserWithSerialLocks();vi.spyOn(axios,"post").mockRejectedValue(unauthenticated({headers:new AxiosHeaders()} as InternalAxiosRequestConfig));
    expect(await authApi.refresh().catch(error=>error)).toMatchObject({status:401});
    expect(window.localStorage.getItem("trotot-auth-refresh-pending-until")).toBeNull();
  });
  it.each(["me", "becomeHost"] as const)("does not dispatch %s from stale memory after another tab starts a new login", async (action) => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user, "original-session");
    publishAuth({ type: "session", accessToken: "access-second", user: { ...user, id: "second-user" }, sessionId: "new-login" });
    const dispatch = vi.fn();
    api.defaults.adapter = dispatch;
    expect(await authApi[action]().catch((error: unknown) => error)).toMatchObject({ errorCode: "SESSION_CHANGED" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("trotot-auth-session-id")).toBe("new-login");
  });

  it.each([false, true])("never retries a delayed promotion 401 after logout and a new login (same account: %s)", async (sameAccount) => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    const nextUser = sameAccount ? user : { ...user, id: "second-user" };
    const refresh = vi.spyOn(axios, "post");
    let rejectPromotion!: (error: AxiosError) => void;
    let firstConfig!: InternalAxiosRequestConfig;
    let promotions = 0;
    api.defaults.adapter = async (config) => {
      if (config.url === "/logout") return response(config, { success: true, data: { signedOut: true } });
      if (config.url === "/login") return response(config, { success: true, data: { accessToken: "access-second", user: nextUser } });
      promotions += 1;
      if (promotions === 1) {
        firstConfig = config;
        return new Promise((_resolve, reject) => { rejectPromotion = reject; });
      }
      return response(config, { success: true, data: { user: { ...nextUser, role: "HOST" } } });
    };
    const pending = authApi.becomeHost().catch((error: unknown) => error);
    await vi.waitFor(() => expect(promotions).toBe(1));
    await authApi.logout();
    await authApi.login({ phone: nextUser.phone, password: "Password123" });
    rejectPromotion(unauthenticated(firstConfig));
    expect(await pending).toMatchObject({ errorCode: "SESSION_CHANGED" });
    expect(promotions).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(useAuthStore.getState().accessToken).toBe("access-second");
    expect(useAuthStore.getState().user).toMatchObject({ id: nextUser.id, role: "TENANT" });
  });

  it("rejects an old request even when a same-account login returns the same access token", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    const refresh = vi.spyOn(axios, "post");
    let rejectPromotion!: (error: AxiosError) => void;
    let firstConfig!: InternalAxiosRequestConfig;
    let promotions = 0;
    api.defaults.adapter = async (config) => {
      if (config.url === "/login") return response(config, { success: true, data: { accessToken: "access-old", user } });
      promotions += 1;
      if (promotions === 1) {
        firstConfig = config;
        return new Promise((_resolve, reject) => { rejectPromotion = reject; });
      }
      return response(config, { success: true, data: { user: { ...user, role: "HOST" } } });
    };
    const pending = authApi.becomeHost().catch((error: unknown) => error);
    await vi.waitFor(() => expect(promotions).toBe(1));
    await authApi.login({ phone: user.phone, password: "Password123" });
    rejectPromotion(unauthenticated(firstConfig));
    expect(await pending).toMatchObject({ errorCode: "SESSION_CHANGED" });
    expect(promotions).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.role).toBe("TENANT");
  });

  it("does not refresh or resend an old mutation if the session changes while waiting for the browser lock", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    let releaseLock!: () => void;
    const heldLock = navigator.locks.request("trotot-auth-refresh-v1", { mode: "exclusive" },
      () => new Promise<void>((resolve) => { releaseLock = resolve; }));
    await vi.waitFor(() => expect(releaseLock).toBeTypeOf("function"));
    const refresh = vi.spyOn(axios, "post");
    let promotions = 0;
    api.defaults.adapter = async (config) => { promotions += 1; throw unauthenticated(config); };
    const pending = authApi.becomeHost().catch((error: unknown) => error);
    await vi.waitFor(() => expect(promotions).toBe(1));
    useAuthStore.getState().setSession("access-second", { ...user, id: "second-user" });
    releaseLock();
    await heldLock;
    expect(await pending).toMatchObject({ errorCode: "SESSION_CHANGED" });
    expect(refresh).not.toHaveBeenCalled();
    expect(promotions).toBe(1);
    expect(useAuthStore.getState().user).toMatchObject({ id: "second-user", role: "TENANT" });
  });

  it("checks the original session again just before dispatching a refreshed mutation", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    vi.spyOn(axios, "post").mockResolvedValue(response({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, data: { accessToken: "access-new", user } }));
    let promotions = 0;
    api.defaults.adapter = async (config) => { promotions += 1; throw unauthenticated(config); };
    // Axios runs newly registered request interceptors first: simulate a login
    // between the refresh promise resolving and the retry reaching our guard.
    const interceptor = api.interceptors.request.use((config) => {
      if ((config as InternalAxiosRequestConfig & { _authRetried?: boolean })._authRetried) {
        useAuthStore.getState().setSession("access-second", { ...user, id: "second-user" });
      }
      return config;
    });
    try {
      expect(await authApi.becomeHost().catch((error: unknown) => error)).toMatchObject({ errorCode: "SESSION_CHANGED" });
      expect(promotions).toBe(1);
      expect(useAuthStore.getState().user).toMatchObject({ id: "second-user", role: "TENANT" });
    } finally {
      api.interceptors.request.eject(interceptor);
    }
  });

  it("reuses a completed refresh for a later 401 belonging to that same session", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    const sessionId = useAuthStore.getState().sessionId;
    const refresh = vi.spyOn(axios, "post").mockResolvedValue(response({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, data: { accessToken: "access-new", user } }));
    let firstCalls = 0;
    let releaseLate!: (error: AxiosError) => void;
    let lateConfig!: InternalAxiosRequestConfig;
    api.defaults.adapter = async (config) => {
      if (config.headers.get("Authorization") === "Bearer access-new") return response(config, { success: true, data: user });
      firstCalls += 1;
      if (firstCalls === 1) throw unauthenticated(config);
      lateConfig = config;
      return new Promise((_resolve, reject) => { releaseLate = reject; });
    };
    const first = authApi.me();
    const late = authApi.me();
    expect((await first).id).toBe(user.id);
    await vi.waitFor(() => expect(releaseLate).toBeTypeOf("function"));
    releaseLate(unauthenticated(lateConfig));
    expect((await late).id).toBe(user.id);
    expect(refresh).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().sessionId).toBe(sessionId);
  });

  it.each(["lock", "refresh"])("rejects a new login in another tab before its broadcast arrives while waiting for %s", async (phase) => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user, "original-session");
    publishAuth({ type: "session", accessToken: "access-old", user, sessionId: "original-session" });
    let releaseLock!: () => void;
    const heldLock = phase === "lock"
      ? navigator.locks.request("trotot-auth-refresh-v1", { mode: "exclusive" },
        () => new Promise<void>((resolve) => { releaseLock = resolve; }))
      : null;
    if (heldLock) await vi.waitFor(() => expect(releaseLock).toBeTypeOf("function"));
    let finishRefresh!: (value: AxiosResponse) => void;
    const refresh = vi.spyOn(axios, "post").mockImplementation(() => new Promise<AxiosResponse>((resolve) => { finishRefresh = resolve; }) as never);
    let promotions = 0;
    api.defaults.adapter = async (config) => { promotions += 1; throw unauthenticated(config); };
    const pending = authApi.becomeHost().catch((error: unknown) => error);
    await vi.waitFor(() => expect(promotions).toBe(1));
    if (phase === "refresh") await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    // Shared metadata changes synchronously; the receiving tab has not applied
    // the BroadcastChannel event and still holds the previous account in memory.
    publishAuth({ type: "session", accessToken: "access-second", user, sessionId: "new-login" });
    if (heldLock) { releaseLock(); await heldLock; }
    else finishRefresh(response({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, data: { accessToken: "access-rotated", user } }));
    expect(await pending).toMatchObject({ errorCode: "SESSION_CHANGED" });
    expect(refresh).toHaveBeenCalledTimes(phase === "refresh" ? 1 : 0);
    expect(promotions).toBe(1);
    expect(useAuthStore.getState().accessToken).toBe("access-old");
    expect(window.localStorage.getItem("trotot-auth-session-id")).toBe("new-login");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it("does not label a refresh response for another account as the original session", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user);
    const sessionId = useAuthStore.getState().sessionId;
    vi.spyOn(axios, "post").mockResolvedValue(response({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, data: { accessToken: "access-second", user: { ...user, id: "second-user" } } }));
    let promotions = 0;
    api.defaults.adapter = async (config) => { promotions += 1; throw unauthenticated(config); };
    expect(await authApi.becomeHost().catch((error: unknown) => error)).toMatchObject({ errorCode: "SESSION_CHANGED" });
    expect(promotions).toBe(1);
    expect(useAuthStore.getState().sessionId).toBe(sessionId);
    expect(useAuthStore.getState().user?.id).toBe(user.id);
  });

  it("does not publish a late promotion success over another tab's newer login before its broadcast arrives", async () => {
    browserWithSerialLocks();
    useAuthStore.getState().setSession("access-old", user, "original-session");
    publishAuth({ type: "session", accessToken: "access-old", user, sessionId: "original-session" });
    let finish!: () => void;
    api.defaults.adapter = async (config) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return response(config, { success: true, data: { user: { ...user, role: "HOST" } } });
    };
    const pending = authApi.becomeHost().catch((error: unknown) => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    publishAuth({ type: "session", accessToken: "access-second", user: { ...user, id: "second-user" }, sessionId: "new-login" });
    finish();
    expect(await pending).toMatchObject({ errorCode: "SESSION_CHANGED" });
    expect(useAuthStore.getState().user?.role).toBe("TENANT");
    expect(window.localStorage.getItem("trotot-auth-session-id")).toBe("new-login");
  });

  it("adopts the shared identity when a fresh tab bootstraps its HttpOnly session", async () => {
    browserWithSerialLocks();
    publishAuth({ type: "session", accessToken: "access-other-tab", user, sessionId: "existing-session" });
    useAuthStore.getState().clearSession();
    vi.spyOn(axios, "post").mockResolvedValue(response({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, data: { accessToken: "access-new", user } }));
    expect(await authApi.refresh()).toBe("access-new");
    expect(useAuthStore.getState().sessionId).toBe("existing-session");
    expect(useAuthStore.getState().user?.id).toBe(user.id);
  });

  it("updates Host in memory after protected promotion and refresh retry without a nested lock deadlock", async () => {
    browserWithSerialLocks(); useAuthStore.getState().setSession("access-old",user);
    const refresh = vi.spyOn(axios,"post").mockResolvedValue(response({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      { success: true, data: { accessToken: "access-new",user } }));
    api.defaults.adapter = async config => {
      expect(config.url).toBe("/become-host");
      if (config.headers.get("Authorization") !== "Bearer access-new") throw unauthenticated(config);
      return response(config,{ success: true,data: { user: { ...user,role: "HOST" } } });
    };
    expect((await authApi.becomeHost()).user.role).toBe("HOST");
    expect(refresh).toHaveBeenCalledOnce(); expect(useAuthStore.getState().user?.role).toBe("HOST");
    expect(useAuthStore.getState().accessToken).toBe("access-new");
  });
  it("publishes a confirmed Host role after an older Tenant refresh completes", async()=>{
    browserWithSerialLocks();useAuthStore.getState().setSession("old-access",user,"same-session");
    let finish!: (value:AxiosResponse)=>void;
    const refresh=vi.spyOn(axios,"post").mockImplementation(()=>new Promise<AxiosResponse>(resolve=>{finish=resolve;}) as never);
    const pendingRefresh=authApi.refresh();await vi.waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
    let requests=0;
    api.defaults.adapter=async config=>{requests++;return response(config,{success:true,data:{user:{...user,role:"HOST"}}});};
    const promotion=authApi.becomeHost();await vi.waitFor(()=>expect(requests).toBe(1));
    expect(useAuthStore.getState().user?.role).toBe("TENANT");
    finish(response({headers:new AxiosHeaders()} as InternalAxiosRequestConfig,{success:true,data:{accessToken:"new-access",user}}));
    await pendingRefresh;expect((await promotion).user.role).toBe("HOST");
    expect(useAuthStore.getState()).toMatchObject({accessToken:"new-access",sessionId:"same-session",user:{role:"HOST"}});
  });
  it("cannot restore or overwrite a session with a late become-host response after logout", async () => {
    browserWithSerialLocks(); useAuthStore.getState().setSession("access-old",user);
    let finish!: () => void;
    api.defaults.adapter = async config => {
      if (config.url === "/logout") return response(config,{ success: true,data: { signedOut: true } });
      await new Promise<void>(resolve => { finish = resolve; });
      return response(config,{ success: true,data: { user: { ...user,role: "HOST" } } });
    };
    const pending = authApi.becomeHost().catch((error: unknown) => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await authApi.logout(); finish();
    expect(await pending).toMatchObject({ errorCode: "SESSION_CHANGED" });
    expect(useAuthStore.getState().status).toBe("anonymous"); expect(useAuthStore.getState().user).toBeNull();
  });
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

 describe("private management session coordination",()=>{
  it("uses only the current memory bearer on the fixed same-origin BFF",async()=>{
    browserWithSerialLocks();useAuthStore.getState().setSession("access-admin",{...user,role:"ADMIN"});
    api.defaults.adapter=async config=>{expect(config.baseURL).toBe("/api/management");expect(config.headers.Authorization).toBe("Bearer access-admin");return response(config,{success:true,data:[]});};
    expect(await managementRequest("/admin/properties")).toMatchObject({data:[]});
  });
  it("blocks anonymous private dispatch instead of attempting a refresh",async()=>{
    browserWithSerialLocks();useAuthStore.getState().clearSession();const dispatch=vi.fn();api.defaults.adapter=dispatch;
    expect(await managementRequest("/admin/properties").catch(e=>e)).toMatchObject({errorCode:"ACCESS_TOKEN_REQUIRED"});expect(dispatch).not.toHaveBeenCalled();
  });
  it.each(["account","role"])("rejects a late successful private response after %s changes",async change=>{
    browserWithSerialLocks();useAuthStore.getState().setSession("access-admin",{...user,role:"ADMIN"},"admin-session");
    let finish!:()=>void;api.defaults.adapter=async config=>new Promise(resolve=>{finish=()=>resolve(response(config,{success:true,data:{private:"old-admin"}}));});
    const pending=managementRequest("/admin/properties").catch(e=>e);await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));
    useAuthStore.getState().setSession("new-access",change==="role"?{...user,role:"TENANT"}:{...user,id:"other-admin",role:"ADMIN"},change==="role"?"admin-session":"new-session");finish();
    expect(await pending).toMatchObject({errorCode:"SESSION_CHANGED"});
  });
  it("does not refresh or retry a stale version review",async()=>{
    browserWithSerialLocks();useAuthStore.getState().setSession("access-admin",{...user,role:"ADMIN"});const refresh=vi.spyOn(axios,"post");let requests=0;
    api.defaults.adapter=async config=>{requests++;throw new AxiosError("stale",AxiosError.ERR_BAD_REQUEST,config,{},response(config,{success:false,errorCode:"STALE_LISTING_VERSION",message:"Reload"},409));};
    expect(await managementRequest("/admin/properties/id/approve",{method:"POST",data:{expectedVersion:2}}).catch(e=>e)).toMatchObject({status:409,errorCode:"STALE_LISTING_VERSION"});
    expect(requests).toBe(1);expect(refresh).not.toHaveBeenCalled();
  });
  it("refreshes an expired private credential once and retains the management route on retry",async()=>{
    browserWithSerialLocks();const adminUser={...user,role:"ADMIN" as const};useAuthStore.getState().setSession("old-access",adminUser);
    const refresh=vi.spyOn(axios,"post").mockResolvedValue(response({headers:new AxiosHeaders()}as InternalAxiosRequestConfig,{success:true,data:{accessToken:"new-access",user:adminUser}}));let requests=0;
    api.defaults.adapter=async config=>{expect(config.baseURL).toBe("/api/management");requests++;if(requests===1)throw unauthenticated(config);expect(config.headers.Authorization).toBe("Bearer new-access");return response(config,{success:true,data:[]});};
    expect(await managementRequest("/admin/properties")).toMatchObject({data:[]});expect(requests).toBe(2);expect(refresh).toHaveBeenCalledTimes(1);
  });
 });
