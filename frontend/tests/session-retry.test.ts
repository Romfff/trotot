import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { AppProviders } from "../src/components/providers";
import { useAuthStore } from "../src/stores/auth-store";

const mocks = vi.hoisted(() => ({ effect: vi.fn(), bootstrap: vi.fn(), replace: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: mocks.effect,
  useState: (initial: () => unknown) => [initial(), vi.fn()],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("../src/lib/bootstrap-session", () => ({ bootstrapSession: mocks.bootstrap }));
vi.mock("../src/lib/auth-channel", () => ({ subscribeAuth: () => vi.fn() }));

afterEach(() => {
  useAuthStore.getState().clearSession();
  vi.unstubAllGlobals();
});

it("retries only an unavailable session, prevents duplicate clicks and removes the listener on unmount", () => {
  const window = new EventTarget();
  vi.stubGlobal("window", window);
  renderToStaticMarkup(createElement(AppProviders, null, null));
  const cleanup = mocks.effect.mock.calls[0][0]() as () => void;
  try {
    mocks.bootstrap.mockClear();
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
  useAuthStore.getState().setStatus("unavailable");
  window.dispatchEvent(new Event("trotot:retry-session"));
  expect(mocks.bootstrap).toHaveBeenCalledOnce();
});
