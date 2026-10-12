import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { publicReadHeaders } from "@/lib/api/public-read-headers.server";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
const readHeaders = vi.mocked(headers);
const secret = "test-public-read-secret-32chars-abcdef";
beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-04T02:00:00Z"));
  vi.stubEnv("BFF_PROXY_SECRET", secret);vi.stubEnv("BACKEND_API_URL", "https://backend.test/api/v1/");
  vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-owned-edge-ip");
  readHeaders.mockReset();
});
afterEach(() => { vi.useRealTimers();vi.unstubAllEnvs(); });

it("signs the configured edge IPv4/IPv6 against exactly the upstream GET path", async () => {
  for (const ip of ["198.51.100.10", "2001:db8::20"]) {
    readHeaders.mockResolvedValue(new Headers({ "x-owned-edge-ip": ` ${ip} `, cookie: "private", authorization: "Bearer private",
      "x-forwarded-for": "192.0.2.66", "x-trotot-client-ip": "192.0.2.99", "x-trotot-proxy-signature": "forged" }));
    const result = await publicReadHeaders("properties/room%20%23%3F");
    const timestamp = String(Date.now());
    expect(result).toEqual({ "x-trotot-proxy-timestamp": timestamp, "x-trotot-client-ip": ip,
      "x-trotot-proxy-signature": createHmac("sha256", secret).update(`${timestamp}\nGET\n/api/v1/properties/room%20%23%3F\n${ip}`).digest("hex") });
    expect(result).not.toHaveProperty("cookie");expect(result).not.toHaveProperty("authorization");
  }
});
it("keeps local transport behavior and never trusts ordinary forwarding headers when no edge configured", async () => {
  vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
  expect(await publicReadHeaders("properties/long-term/search")).toEqual({});expect(readHeaders).not.toHaveBeenCalled();
});
it("rejects missing/multiple/malformed configured edge IP without an unsigned fallback", async () => {
  for (const ip of ["", "not-ip", "198.51.100.10,198.51.100.11"]) {
    readHeaders.mockResolvedValue(new Headers({ "x-owned-edge-ip": ip }));
    await expect(publicReadHeaders("properties/long-term/search")).rejects.toMatchObject({ status: 503, errorCode: "PUBLIC_PROXY_UNAVAILABLE" });
  }
});
it("fails closed on missing/short signer or missing production upstream", async () => {
  readHeaders.mockResolvedValue(new Headers({ "x-owned-edge-ip": "198.51.100.10" }));
  for (const value of ["", "short"]) { vi.stubEnv("BFF_PROXY_SECRET", value);
    await expect(publicReadHeaders("properties/long-term/search")).rejects.toMatchObject({ status: 503 }); }
  vi.stubEnv("BFF_PROXY_SECRET", secret);vi.stubEnv("NODE_ENV", "production");vi.stubEnv("BACKEND_API_URL", "");
  await expect(publicReadHeaders("properties/long-term/search")).rejects.toMatchObject({ status: 503 });
});
it("does not expose request context failure details", async () => {
  readHeaders.mockRejectedValue(new Error("Private header/transport details"));
  await expect(publicReadHeaders("properties/long-term/search")).rejects.toMatchObject({ status: 503, message: "Chưa thể kết nối máy chủ." });
});
