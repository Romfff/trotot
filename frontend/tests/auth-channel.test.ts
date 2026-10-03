import { afterEach, expect, it, vi } from "vitest";
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
