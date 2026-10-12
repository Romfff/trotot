import { afterEach, expect, it, vi } from "vitest";
import axios, { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "../src/stores/auth-store";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("ignores delayed cross-tab messages from an earlier session", async () => {
  vi.resetModules();
  const values = new Map<string, string>();
  const messages: unknown[] = [];
  let receive!: (event: { data: unknown }) => void;
  let receiveStorage!: (event: { key: string; newValue: string }) => void;
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
    addEventListener: (_name: string, callback: typeof receiveStorage) => { receiveStorage = callback; }, removeEventListener: vi.fn(),
  });
  vi.stubGlobal("BroadcastChannel", class {
    postMessage(message: unknown) { messages.push(message); }
    addEventListener(_name: string, callback: typeof receive) { receive = callback; }
    removeEventListener() {}
  });
  const { publishAuth, subscribeAuth } = await import("../src/lib/auth-channel");
  const { useAuthStore: store } = await import("../src/stores/auth-store");
  const onLogout = vi.fn();
  const unsubscribe = subscribeAuth(onLogout);
  const user = { id: "old-user", phone: "0912345678", fullName: "User", role: "TENANT" as const,
    email: null, avatarUrl: null, isPhoneVerified: true, isIdentityVerified: false,
    status: "ACTIVE", createdAt: null, updatedAt: null };
  publishAuth({ type: "session", accessToken: "old-token", user });
  publishAuth({ type: "logout" });
  publishAuth({ type: "session", accessToken: "new-token", user: { ...user, id: "new-user" } });
  receive({ data: messages[2] });
  receive({ data: messages[0] });
  receive({ data: messages[1] });
  receiveStorage({ key: "trotot-auth-logout-pending", newValue: "1" });
  expect(store.getState().user?.id).toBe("new-user");
  expect(onLogout).not.toHaveBeenCalled();
  publishAuth({ type: "logout" });
  receive({ data: messages[3] });
  expect(store.getState().accessToken).toBeNull();
  expect(onLogout).toHaveBeenCalledOnce();
  unsubscribe();
  useAuthStore.getState().clearSession();
});

it.each([false, true])("allows same-session cross-tab rotation but rejects a new same-account login (new login: %s)", async (newLogin) => {
  vi.resetModules();
  const values = new Map<string, string>();
  const messages: unknown[] = [];
  let receive!: (event: { data: unknown }) => void;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent: vi.fn(),
  });
  vi.stubGlobal("BroadcastChannel", class {
    postMessage(message: unknown) { messages.push(message); }
    addEventListener(_name: string, callback: typeof receive) { receive = callback; }
    removeEventListener() {}
  });
  vi.stubGlobal("navigator", { locks: { request: (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback() } });
  const { publishAuth, subscribeAuth } = await import("../src/lib/auth-channel");
  const { useAuthStore: store } = await import("../src/stores/auth-store");
  const { api, authApi } = await import("../src/lib/api/client");
  const user = { id: "cross-tab-fixture", phone: "0990000000", fullName: "Fixture", role: "TENANT" as const,
    email: null, avatarUrl: null, isPhoneVerified: true, isIdentityVerified: false,
    status: "ACTIVE", createdAt: null, updatedAt: null };
  store.getState().setSession("access-old", user, "original-session");
  const unsubscribe = subscribeAuth(vi.fn());
  const refresh = vi.spyOn(axios, "post");
  let rejectFirst!: (error: AxiosError) => void;
  let firstConfig!: InternalAxiosRequestConfig;
  let calls = 0;
  api.defaults.adapter = async (config) => {
    calls += 1;
    if (calls === 1) {
      firstConfig = config;
      return new Promise((_resolve, reject) => { rejectFirst = reject; });
    }
    expect(config.headers.get("Authorization")).toBe("Bearer access-new");
    return { data: { success: true, data: { user: { ...user, role: "HOST" } } }, status: 200,
      statusText: "OK", config, headers: new AxiosHeaders() };
  };
  try {
    const pending = authApi.becomeHost().catch((error: unknown) => error);
    await vi.waitFor(() => expect(calls).toBe(1));
    publishAuth({ type: "session", accessToken: "access-new", user, sessionId: newLogin ? "new-login" : "original-session" });
    receive({ data: messages.at(-1) });
    const unauthorized = { data: { success: false, errorCode: "UNAUTHORIZED", message: "Expired" }, status: 401,
      statusText: "Unauthorized", config: firstConfig, headers: new AxiosHeaders() } as AxiosResponse;
    rejectFirst(new AxiosError("expired", AxiosError.ERR_BAD_REQUEST, firstConfig, {}, unauthorized));
    const result = await pending;
    if (newLogin) {
      expect(result).toMatchObject({ errorCode: "SESSION_CHANGED" });
      expect(calls).toBe(1);
      expect(store.getState().user?.role).toBe("TENANT");
    } else {
      expect(result).toMatchObject({ user: { role: "HOST" } });
      expect(calls).toBe(2);
      expect(store.getState().sessionId).toBe("original-session");
    }
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    refresh.mockRestore();
    store.getState().clearSession();
  }
});

it.each(["current", "stale", "logout-pending", "same-session"])("storage recovery verifies the current shared identity (%s)", async scenario => {
  vi.resetModules();
  const values = new Map<string, string>([["trotot-auth-session-id", "current-session"]]);
  const surface = new EventTarget();
  Object.assign(surface, { localStorage: { getItem: (key: string) => values.get(key) ?? null } });
  vi.stubGlobal("window", surface);
  vi.stubGlobal("BroadcastChannel", undefined);
  const { subscribeAuth } = await import("../src/lib/auth-channel");
  const { useAuthStore: store } = await import("../src/stores/auth-store");
  store.getState().clearSession();
  if (scenario === "logout-pending") values.set("trotot-auth-logout-pending", "1");
  if (scenario === "same-session") store.setState({ sessionId: "current-session" });
  const recover = vi.fn();
  surface.addEventListener("trotot:shared-session", recover);
  const unsubscribe = subscribeAuth(vi.fn());
  try {
    surface.dispatchEvent(Object.assign(new Event("storage"), {
      key: "trotot-auth-session-id", newValue: scenario === "stale" ? "obsolete-session" : "current-session",
    }));
    expect(recover).toHaveBeenCalledTimes(scenario === "current" ? 1 : 0);
    expect(store.getState().accessToken).toBeNull();
    expect(store.getState().user).toBeNull();
    unsubscribe();
    surface.dispatchEvent(Object.assign(new Event("storage"), { key: "trotot-auth-session-id", newValue: "current-session" }));
    expect(recover).toHaveBeenCalledTimes(scenario === "current" ? 1 : 0);
  } finally { unsubscribe(); store.getState().clearSession(); }
});
