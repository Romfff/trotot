import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi } from "../src/lib/api/client";
import { bootstrapSession } from "../src/lib/bootstrap-session";
import { useAuthStore } from "../src/stores/auth-store";
import type { User } from "../src/lib/auth-types";
import { ApiError } from "../src/lib/auth-types";

vi.mock("../src/lib/api/client", () => ({ authApi: { refresh: vi.fn(), me: vi.fn() } }));
const user: User = {
  id: "first-user", phone: "0912345678", email: null, fullName: "First user", role: "TENANT",
  avatarUrl: null, isPhoneVerified: true, isIdentityVerified: false, status: "ACTIVE", createdAt: null, updatedAt: null,
};

afterEach(() => { useAuthStore.getState().clearSession(); vi.resetAllMocks(); });

describe("session bootstrap", () => {
  it.each([
    [0, "SESSION_CLOSED", "anonymous"],
    [0, "NETWORK_ERROR", "unavailable"],
    [503, "BACKEND_UNAVAILABLE", "unavailable"],
    [500, "INTERNAL_SERVER_ERROR", "unavailable"],
    [502, "INVALID_BACKEND_RESPONSE", "unavailable"],
    [429, "RATE_LIMITED", "unavailable"],
    [403, "INVALID_ORIGIN", "unavailable"],
    [401, "REFRESH_TOKEN_REVOKED", "anonymous"],
  ] as const)("classifies %s/%s as %s", async (status, code, expected) => {
    useAuthStore.getState().clearSession();
    vi.mocked(authApi.refresh).mockRejectedValue(new ApiError(status, code, "test"));
    await bootstrapSession(new QueryClient(), () => true);
    expect(useAuthStore.getState().status).toBe(expected);
    expect(useAuthStore.getState().user).toBeNull();
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it("restores the session and cache after retrying a temporary failure", async () => {
    const cache = new QueryClient();
    vi.mocked(authApi.refresh).mockRejectedValueOnce(new ApiError(502, "BACKEND_UNAVAILABLE", "test"));
    await bootstrapSession(cache, () => true);
    expect(useAuthStore.getState().status).toBe("unavailable");
    useAuthStore.getState().setStatus("initializing");
    vi.mocked(authApi.refresh).mockImplementationOnce(async () => {
      useAuthStore.getState().setSession("access-retry", user);
      return "access-retry";
    });
    vi.mocked(authApi.me).mockResolvedValue(user);
    await bootstrapSession(cache, () => true);
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBe("access-retry");
    expect(cache.getQueryData(["auth", "me"])).toEqual(user);
  });

  it("treats unexpected errors as unavailable rather than claiming the session expired", async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new Error("unexpected"));
    await bootstrapSession(new QueryClient(), () => true);
    expect(useAuthStore.getState().status).toBe("unavailable");
  });

  it.each([500, 502, 429])("treats a /me failure with status %s as unavailable", async (status) => {
    const cache = new QueryClient();
    vi.mocked(authApi.refresh).mockImplementation(async () => {
      useAuthStore.getState().setSession("access-first", user);
      return "access-first";
    });
    vi.mocked(authApi.me).mockRejectedValue(new ApiError(status, "REQUEST_FAILED", "test"));
    await bootstrapSession(cache, () => true);
    expect(useAuthStore.getState().status).toBe("unavailable");
    expect(cache.getQueryData(["auth", "me"])).toBeUndefined();
  });

  it("loads the current user into the session and cache", async () => {
    const cache = new QueryClient();
    vi.mocked(authApi.refresh).mockImplementation(async () => {
      useAuthStore.getState().setSession("access-first", user);
      return "access-first";
    });
    vi.mocked(authApi.me).mockResolvedValue(user);
    await bootstrapSession(cache, () => true);
    expect(cache.getQueryData(["auth", "me"])).toEqual(user);
    expect(useAuthStore.getState().user).toEqual(user);
  });

  it.each(["logout", "switch", "unmount"])("ignores a late /me response after %s", async (change) => {
    const cache = new QueryClient();
    let active = true;
    let finish!: (user: User) => void;
    vi.mocked(authApi.refresh).mockImplementation(async () => {
      useAuthStore.getState().setSession("access-first", user);
      return "access-first";
    });
    vi.mocked(authApi.me).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = bootstrapSession(cache, () => active);
    await vi.waitFor(() => expect(authApi.me).toHaveBeenCalledOnce());
    if (change === "logout") useAuthStore.getState().clearSession();
    else if (change === "switch") useAuthStore.getState().setSession("access-second", { ...user, id: "second-user" });
    else active = false;
    const expected = useAuthStore.getState();
    finish(user);
    await pending;
    expect(useAuthStore.getState()).toBe(expected);
    expect(cache.getQueryData(["auth", "me"])).toBeUndefined();
  });

  it("does not clear a new login when an older refresh fails", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(authApi.refresh).mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const pending = bootstrapSession(new QueryClient(), () => true);
    useAuthStore.getState().setSession("access-second", { ...user, id: "second-user" });
    fail(new Error("old refresh failed"));
    await pending;
    expect(useAuthStore.getState().accessToken).toBe("access-second");
    expect(useAuthStore.getState().user?.id).toBe("second-user");
  });
});
