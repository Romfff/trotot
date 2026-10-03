import { afterEach, describe, expect, it, vi } from "vitest";
import { authPending } from "../src/lib/auth-pending";

function browserSessionStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OTP resend cooldown", () => {
  it("persists per normalized phone and purpose, then expires", () => {
    browserSessionStorage();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    authPending.startCooldown("RESET_PASSWORD", "+84 (912) 345-678");

    expect(authPending.getCooldownRemaining("RESET_PASSWORD", "84912345678")).toBe(60);
    expect(authPending.getCooldownRemaining("RESET_PASSWORD", "0912345678")).toBe(60);
    expect(authPending.getCooldownRemaining("RESET_PASSWORD", "0084912345678")).toBe(60);
    expect(authPending.getCooldownRemaining("VERIFY_PHONE", "84912345678")).toBe(0);
    now.mockReturnValue(1_059_100);
    expect(authPending.getCooldownRemaining("RESET_PASSWORD", "84912345678")).toBe(1);
    now.mockReturnValue(1_060_001);
    expect(authPending.getCooldownRemaining("RESET_PASSWORD", "84912345678")).toBe(0);
  });
});
