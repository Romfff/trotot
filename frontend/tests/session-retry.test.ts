import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { AppProviders } from "../src/components/providers";
import { useAuthStore } from "../src/stores/auth-store";
import { QueryClient } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ effect: vi.fn(), bootstrap: vi.fn(), synchronize: vi.fn(), replace: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: mocks.effect,
  useState: (initial: () => unknown) => [initial(), vi.fn()],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("../src/lib/bootstrap-session", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/bootstrap-session")>(),
  bootstrapSession: mocks.bootstrap, createSharedSessionSynchronizer: () => mocks.synchronize,
}));
vi.mock("../src/lib/auth-channel", () => ({ subscribeAuth: () => vi.fn() }));

afterEach(() => {
  useAuthStore.getState().clearSession();
  mocks.effect.mockClear();
  vi.unstubAllGlobals();
});

it.each(["trotot:logout", "trotot:session-expired"])("%s drops private cache without cancelling public reads", (event) => {
  mocks.effect.mockClear();
  mocks.replace.mockClear();
  const window = new EventTarget(); vi.stubGlobal("window", window);
  renderToStaticMarkup(createElement(AppProviders, null, null));
  const cleanup = mocks.effect.mock.calls[0][0]() as () => void;
  const cache = mocks.bootstrap.mock.calls.at(-1)![0] as QueryClient;
  cache.setQueryData(["bookings", "old-session"], "private-booking");
  cache.setQueryDefaults(["homestay-calendar"], { meta: { public: true } });
  cache.setQueryData(["homestay-calendar", "fixture"], "public-dates");
  try {
    window.dispatchEvent(new Event(event));
    expect(cache.getQueryData(["bookings", "old-session"])).toBeUndefined();
    expect(cache.getQueryData(["homestay-calendar", "fixture"])).toBe("public-dates");
    if (event === "trotot:session-expired") expect(mocks.replace).toHaveBeenCalledWith("/login?sessionExpired=1");
    else expect(mocks.replace).not.toHaveBeenCalled();
  } finally { cleanup(); cache.clear(); }
});

it("retries only an unavailable session, prevents duplicate clicks and removes the listener on unmount", () => {
  const window = new EventTarget();
  vi.stubGlobal("window", window);
  renderToStaticMarkup(createElement(AppProviders, null, null));
  const cleanup = mocks.effect.mock.calls[0][0]() as () => void;
  try {
    mocks.bootstrap.mockClear();
    mocks.synchronize.mockClear();
    window.dispatchEvent(new Event("trotot:shared-session"));
    expect(mocks.synchronize).toHaveBeenCalledOnce();
    useAuthStore.getState().setStatus("unavailable");
    window.dispatchEvent(new Event("trotot:retry-session"));
    window.dispatchEvent(new Event("trotot:retry-session"));
    expect(mocks.bootstrap).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().status).toBe("initializing");
    expect(mocks.bootstrap.mock.calls[0][1]()).toBe(true);
    useAuthStore.getState().clearSession();
    window.dispatchEvent(new Event("trotot:retry-session"));
    expect(mocks.bootstrap).toHaveBeenCalledOnce();
  } finally {
    cleanup();
  }
  expect(mocks.bootstrap.mock.calls[0][1]()).toBe(false);
  window.dispatchEvent(new Event("trotot:shared-session"));
  expect(mocks.synchronize).toHaveBeenCalledOnce();
  useAuthStore.getState().setStatus("unavailable");
  window.dispatchEvent(new Event("trotot:retry-session"));
  expect(mocks.bootstrap).toHaveBeenCalledOnce();
});

it("clears role-scoped cache when the same Tenant becomes Host without changing account", () => {
  mocks.effect.mockClear();
  const window = new EventTarget(); vi.stubGlobal("window",window);
  const user = { id: "role-fixture",phone: "0990000000",fullName: "Fixture",role: "TENANT" as const,email: null,
    avatarUrl: null,isPhoneVerified: true,isIdentityVerified: false,status: "ACTIVE",createdAt: null,updatedAt: null };
  useAuthStore.getState().setSession("access",user);
  renderToStaticMarkup(createElement(AppProviders,null,null));
  const cleanup = mocks.effect.mock.calls[0][0]() as () => void;
  const cache = mocks.bootstrap.mock.calls.at(-1)![0] as QueryClient;
  cache.setQueryData(["bookings","old-session"],"private-booking");
  cache.setQueryDefaults(["homestay-calendar"],{meta:{public:true}});
  cache.setQueryData(["homestay-calendar","fixture"],"public-dates");
  try {
    useAuthStore.getState().setSession("access",{ ...user,role: "HOST" });
    expect(cache.getQueryData(["bookings","old-session"])).toBeUndefined();
    expect(cache.getQueryData(["homestay-calendar","fixture"])).toBe("public-dates");
  } finally { cleanup(); cache.clear(); }
});
