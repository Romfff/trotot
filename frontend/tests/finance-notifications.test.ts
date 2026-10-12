import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT, DELETE } from "../src/app/api/management/[...path]/route";
import { financeNotificationsApi } from "@/lib/api/finance-notifications";
import { managementRequest } from "@/lib/api/client";
vi.mock("@/lib/api/client", () => ({ managementRequest: vi.fn() }));
const origin = "http://localhost:3000", id = "00000000-0000-4000-8000-000000000001";
const path = ["finance", "notifications"], read = [...path, id, "read"];
const context = (parts: string[]) => ({ params: Promise.resolve({ path: parts }) });
const req = (method: string, body: unknown = {}, headers: Record<string, string> = {}) => new NextRequest(`${origin}/api/management/finance/notifications?page=2&limit=20`, {
  method, headers: { origin, authorization: "Bearer fixture", "content-type": "application/json", cookie: "never-forward", ...headers },
  ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("BACKEND_API_URL", "http://backend.test/api/v1"); vi.stubEnv("FRONTEND_ORIGIN", origin);
  vi.stubEnv("BFF_PROXY_SECRET", "finance-notice-test-secret-32characters"); vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("S4 finance notifications transport (no UI/polling)", () => {
  it("preserves paginated envelope and abort signal", async () => {
    const signal = new AbortController().signal, envelope = { success: true, data: [], meta: { page: 2, unreadCount: 4 } };
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope);
    expect(await financeNotificationsApi.list(2, signal)).toBe(envelope);
    expect(managementRequest).toHaveBeenCalledWith("/finance/notifications", { params: { page: 2, limit: 20 }, signal });
  });
  it("marks exactly the supplied ID read with empty body, no recipient or role override", async () => {
    const data = { id, readAt: "2026-10-06T00:00:00Z" };
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, data });
    expect(await financeNotificationsApi.markRead(id)).toBe(data);
    expect(managementRequest).toHaveBeenCalledWith(`/finance/notifications/${id}/read`, { method: "POST", data: {} });
  });
  it("encodes IDs and propagates errors without retry or a fake receipt", async () => {
    const error = new Error("Synthetic API failure"); vi.mocked(managementRequest).mockRejectedValueOnce(error);
    await expect(financeNotificationsApi.markRead("a/b")).rejects.toBe(error);
    expect(managementRequest).toHaveBeenCalledTimes(1);
    expect(managementRequest).toHaveBeenCalledWith("/finance/notifications/a%2Fb/read", { method: "POST", data: {} });
  });
  it("forwards private pagination without cookies or cached financial responses", async () => {
    const envelope = { success: true, data: [], meta: { unreadCount: 2 } };
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope))); vi.stubGlobal("fetch", upstream);
    const result = await GET(req("GET"), context(path));
    expect(await result.json()).toEqual(envelope); expect(result.headers.get("cache-control")).toBe("no-store");
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("http://backend.test/api/v1/finance/notifications?page=2&limit=20");
    expect(new Headers(init.headers).get("cookie")).toBeNull(); expect(init.cache).toBe("no-store");
  });
  it("accepts only empty read body", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { id } }))); vi.stubGlobal("fetch", upstream);
    expect((await POST(req("POST"), context(read))).status).toBe(200);
    for (const body of [{ recipientId: id }, { expectedVersion: 1 }, [], null]) expect((await POST(req("POST", body), context(read))).status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(1);expect(upstream.mock.calls[0][1].body).toBe("{}");
  });
  it("checks bearer, Origin and JSON before forwarding a read write", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await GET(req("GET", {}, { authorization: "" }), context(path))).status).toBe(401);
    expect((await POST(req("POST", {}, { origin: "https://evil.test" }), context(read))).status).toBe(403);
    expect((await POST(req("POST", {}, { "content-type": "text/plain" }), context(read))).status).toBe(415);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    { handler: PUT, method: "PUT", parts: read }, { handler: DELETE, method: "DELETE", parts: read },
    { handler: POST, method: "POST", parts: path }, { handler: GET, method: "GET", parts: read },
    { handler: POST, method: "POST", parts: [...path, "invalid", "read"] },
    { handler: GET, method: "GET", parts: ["finance", "notifications", id] },
    { handler: GET, method: "GET", parts: ["finance", "complaints"] },
  ])("does not open unapproved routes $method $parts", async ({ handler, method, parts }) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await handler(req(method), context(parts))).status).toBe(404); expect(upstream).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 429, 503])("propagates backend %s without retries or success fallback", async status => {
    const envelope = { success: false, errorCode: "NOTIFICATION_NOT_FOUND" };
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status, headers: { "retry-after": "30" } })); vi.stubGlobal("fetch", upstream);
    const result = await POST(req("POST"), context(read));
    expect(result.status).toBe(status);expect(await result.json()).toEqual(envelope);
    expect(result.headers.get("retry-after")).toBe(status === 429 ? "30" : null); expect(upstream).toHaveBeenCalledTimes(1);
  });
});
