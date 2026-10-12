import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { GET, POST } from "../src/app/api/auth/[action]/route";

const origin = "http://localhost:3000";
const user = {
  id: "user-1",
  phone: "0912345678",
  email: null,
  fullName: "Nguyễn Văn An",
  role: "TENANT",
  avatarUrl: null,
  isPhoneVerified: true,
  isIdentityVerified: false,
  status: "ACTIVE",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function envelope(data: unknown, success = true) {
  return new Response(JSON.stringify({ success, message: "Yêu cầu thành công.", ...(success ? { data } : {}) }), {
    status: success ? 200 : 401,
    headers: { "content-type": "application/json" },
  });
}

function post(action: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return new NextRequest(origin + "/api/auth/" + action, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function context(action: string) {
  return { params: Promise.resolve({ action }) };
}

beforeEach(() => {
  process.env.FRONTEND_ORIGIN = origin;
  process.env.BACKEND_API_URL = "http://backend.test/api/v1";
  vi.stubEnv("BFF_PROXY_SECRET", "test-shared-bff-secret-0123456789-abcdef");
  vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("same-origin Auth Route Handler", () => {
  it("protects become-host with Origin and Bearer, forwards only its fixed path and does not expose refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ user: { ...user, role: "HOST" }, refreshToken: "must-not-leak" }));
    vi.stubGlobal("fetch",fetchMock);
    expect((await POST(post("become-host",{}, { origin: "https://evil.example", authorization: "Bearer access" }),context("become-host"))).status).toBe(403);
    expect((await POST(post("become-host"),context("become-host"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    const result = await POST(post("become-host",{}, { authorization: "Bearer access" }),context("become-host"));
    const [url,init] = fetchMock.mock.calls[0] as [string,RequestInit];
    expect(url).toBe("http://backend.test/api/v1/auth/become-host");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer access");
    expect((await result.json()).data).toEqual({ user: { ...user,role: "HOST" } });
    expect(result.headers.get("set-cookie")).toBeNull();
  });
  it("rejects an invalid Host response instead of claiming a successful role switch", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(envelope({ user })));
    expect((await POST(post("become-host",{}, { authorization: "Bearer access" }),context("become-host"))).status).toBe(502);
  });
  it("signs proxy context and ignores untrusted forwarding headers by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ accessToken: "access", refreshToken: "refresh", user }));
    vi.stubGlobal("fetch", fetchMock);
    await POST(post("login", {}, { "x-forwarded-for": "203.0.113.9" }), context("login"));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    const timestamp = headers.get("x-trotot-proxy-timestamp");
    expect(headers.get("x-trotot-client-ip")).toBe("");
    expect(headers.get("x-trotot-proxy-signature")).toBe(createHmac("sha256", process.env.BFF_PROXY_SECRET!)
      .update(`${timestamp}\nPOST\n/api/v1/auth/login\n`).digest("hex"));
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-real-ip");
    await POST(post("login", {}, { "x-real-ip": "203.0.113.8" }), context("login"));
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("x-trotot-client-ip")).toBe("203.0.113.8");
    expect((await POST(post("login", {}, { "x-real-ip": "203.0.113.8, 1.2.3.4" }), context("login"))).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rejects missing or hostile Origin without calling the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const missingOrigin = new NextRequest(origin + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect((await POST(missingOrigin, context("login"))).status).toBe(403);
    const response = await POST(post("login", {}, { origin: "https://evil.example" }), context("login"));

    expect(response.status).toBe(403);
    expect((await response.json()).errorCode).toBe("INVALID_ORIGIN");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("requires JSON and rejects routes outside the fixed allowlist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wrongContentType = new NextRequest(origin + "/api/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "text/plain" },
      body: "phone=0912345678",
    });
    expect((await POST(wrongContentType, context("login"))).status).toBe(415);
    expect((await POST(post("anything"), context("anything"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sets refresh as HttpOnly cookie and returns only the access token and user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ accessToken: "access-secret", refreshToken: "refresh-secret", user }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(post("login", { phone: user.phone, password: "TroTot1234" }), context("login"));
    const body = await response.json();
    const cookie = response.headers.get("set-cookie") || "";

    expect(response.status).toBe(200);
    expect(body.data.accessToken).toBe("access-secret");
    expect(body.data.refreshToken).toBeUndefined();
    expect(cookie).toContain("trotot_refresh=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/api/auth");
  });

  it("forwards refresh only from the HttpOnly cookie and rotates it without exposing it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ accessToken: "access-2", refreshToken: "refresh-2", user }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(post("refresh", {}, { cookie: "trotot_refresh=refresh-1" }), context("refresh"));
    const body = await response.json();
    const cookie = response.headers.get("set-cookie") || "";
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("http://backend.test/api/v1/auth/refresh-token");
    expect(JSON.parse(String(init.body))).toEqual({ refreshToken: "refresh-1" });
    expect(body.data.refreshToken).toBeUndefined();
    expect(cookie).toContain("refresh-2");
  });

  it.each(["access-expired", "access-from-other-account", ""])("revokes the cookie session without refreshing when bearer is '%s'", async (accessToken) => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith("/auth/logout")
      ? envelope({ signedOut: true })
      : new Response(JSON.stringify({ success: false, errorCode: "RATE_LIMITED" }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(post("logout", { refreshToken: "untrusted-body-token" }, {
      cookie: "trotot_refresh=refresh-old",
      authorization: "Bearer " + accessToken,
    }), context("logout"));
    const result = await response.json();
    const logoutCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const clearCookie = response.headers.get("set-cookie") || "";

    expect(response.status).toBe(200);
    expect(result.data.signedOut).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(logoutCall[0]).toBe("http://backend.test/api/v1/auth/logout");
    expect(JSON.parse(String(logoutCall[1].body))).toEqual({ refreshToken: "refresh-old" });
    expect(new Headers(logoutCall[1].headers).get("authorization")).toBeNull();
    expect(clearCookie).toContain("Max-Age=0");
    expect(result.data.refreshToken).toBeUndefined();
  });

  it("preserves the refresh cookie when refresh hits a temporary backend failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false, errorCode: "BACKEND_UNAVAILABLE", message: "Try again",
    }), { status: 502 })));
    const response = await POST(post("refresh", {}, { cookie: "trotot_refresh=still-valid" }), context("refresh"));
    expect(response.status).toBe(502);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not claim server revocation when logout cannot reach the backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const response = await POST(post("logout", {}, { cookie: "trotot_refresh=still-valid" }), context("logout"));
    expect(response.status).toBe(503);
    expect((await response.json()).success).toBe(false);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("clears refresh cookies after a successful password reset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ passwordUpdated: true }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(post("reset-password", { phone: user.phone, code: "123456", newPassword: "NewPass123" }, {
      cookie: "trotot_refresh=old-session",
    }), context("reset-password"));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("forwards /me with Bearer auth and marks its response non-cacheable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope(user));
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(origin + "/api/auth/me", {
      headers: { authorization: "Bearer access-token" },
    });
    const response = await GET(request, context("me"));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(response.status).toBe(200);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer access-token");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
