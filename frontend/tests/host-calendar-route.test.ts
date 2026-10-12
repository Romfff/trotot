import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { GET, POST, PUT, DELETE } from "../src/app/api/management/[...path]/route";

const origin = "http://localhost:3000";
const id = "00000000-0000-4000-8000-000000000001";
const path = ["host", "calendar", id];
const context = (parts: string[]) => ({ params: Promise.resolve({ path: parts }) });
const body = { expectedVersion: 1, dates: ["2026-10-20"], customPrice: 350000.5 };
function request(method: string, payload: unknown = body, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/management/host/calendar/${id}?month=2026-10`, {
    method, headers: { authorization: "Bearer fixture-access", origin, "content-type": "application/json", "idempotency-key": "calendar-retry", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(payload) }),
  });
}
beforeEach(() => {
  vi.stubEnv("FRONTEND_ORIGIN", origin); vi.stubEnv("BACKEND_API_URL", "http://backend.test/api/v1");
  vi.stubEnv("BFF_PROXY_SECRET", "calendar-test-secret-0123456789abcdef"); vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Sprint 4 approved calendar BFF", () => {
  it("forwards private GET calendar/month and homestay list/detail, with no cookies/cache", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }))));
    vi.stubGlobal("fetch", fetchMock);
    for (const parts of [path, ["host", "homestays"], ["host", "homestays", id]]) {
      const response = await GET(request("GET", undefined, { cookie: "refresh-must-stay-private" }), context(parts));
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(fetchMock.mock.calls[0][0]).toBe(`http://backend.test/api/v1/host/calendar/${id}?month=2026-10`);
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init.headers).get("cookie")).toBeNull();
  });
  it.each([
    { handler: PUT, method: "PUT", action: "pricing", payload: body },
    { handler: PUT, method: "PUT", action: "pricing", payload: { ...body, customPrice: null } },
    { handler: POST, method: "POST", action: "toggle-block", payload: { expectedVersion: 1, dates: body.dates, isBlocked: true } },
    { handler: POST, method: "POST", action: "toggle-block", payload: { expectedVersion: 1, dates: body.dates, isBlocked: false } },
  ])("forwards exact approved $method/$action payload and retry key with signed context", async ({ handler, method, action, payload }) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { version: 2, updatedDates: body.dates } })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await handler(request(method, payload), context([...path, action]))).status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]; const headers = new Headers(init.headers);
    expect(url).toBe(`http://backend.test/api/v1/host/calendar/${id}/${action}`);
    expect(init.method).toBe(method); expect(JSON.parse(init.body)).toEqual(payload);
    expect(headers.get("idempotency-key")).toBe("calendar-retry"); expect(headers.get("authorization")).toBe("Bearer fixture-access");
    expect(headers.get("x-trotot-proxy-signature")).toBe(createHmac("sha256", process.env.BFF_PROXY_SECRET!).update(`${headers.get("x-trotot-proxy-timestamp")}\n${method}\n/api/v1/host/calendar/${id}/${action}\n`).digest("hex"));
  });
  it.each([
    {}, { ...body, hostId: id }, { ...body, expectedVersion: 0 }, { ...body, expectedVersion: 2147483647 },
    { ...body, dates: [] }, { ...body, dates: ["2026-10-20", "2026-10-20"] }, { ...body, dates: ["bad"] },
    { ...body, dates: [20] }, { ...body, customPrice: "350000" }, { expectedVersion: 1, dates: body.dates },
  ])("refuses invalid/forged pricing body %j before upstream", async payload => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await PUT(request("PUT", payload), context([...path, "pricing"]))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("enforces bearer, Origin and JSON on calendar writes", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request("GET", undefined, { authorization: "" }), context(path))).status).toBe(401);
    expect((await PUT(request("PUT", body, { origin: "https://evil.test" }), context([...path, "pricing"]))).status).toBe(403);
    expect((await PUT(request("PUT", body, { "content-type": "text/plain" }), context([...path, "pricing"]))).status).toBe(415);
    expect((await POST(request("POST", { expectedVersion: 1, dates: body.dates, isBlocked: "false" }), context([...path, "toggle-block"]))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("allows 366 unique dates but rejects 367", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} })));
    vi.stubGlobal("fetch", fetchMock);
    const dates = Array.from({ length: 367 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    expect((await PUT(request("PUT", { ...body, dates: dates.slice(0, 366) }), context([...path, "pricing"]))).status).toBe(200);
    expect((await PUT(request("PUT", { ...body, dates }), context([...path, "pricing"]))).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    { handler: POST, method: "POST", parts: [...path, "pricing"] },
    { handler: PUT, method: "PUT", parts: [...path, "toggle-block"] },
    { handler: DELETE, method: "DELETE", parts: path },
    { handler: GET, method: "GET", parts: [...path, "pricing"] },
    { handler: GET, method: "GET", parts: ["host", "calendar", "../other"] },
    { handler: POST, method: "POST", parts: ["admin", "homestays"] },
    { handler: PUT, method: "PUT", parts: ["admin", "homestays", id] },
    { handler: GET, method: "GET", parts: ["admin", "calendar", id] },
  ])("does not open unrelated methods/paths $method $parts", async ({ handler, method, parts }) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await handler(request(method), context(parts))).status).toBe(404); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 409, 429, 503])("preserves backend %s, Retry-After and error data without automatic replay", async status => {
    const failure = { success: false, errorCode: "SERVER_DECISION", data: { version: 3 } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(failure), { status, headers: { "retry-after": "60" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await PUT(request("PUT"), context([...path, "pricing"]));
    expect(response.status).toBe(status); expect(await response.json()).toEqual(failure);
    expect(response.headers.get("retry-after")).toBe(status === 429 ? "60" : null); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
