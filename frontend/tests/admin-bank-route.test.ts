import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT, DELETE } from "../src/app/api/management/[...path]/route";
const origin = "http://localhost:3000", id = "00000000-0000-4000-8000-000000000001";
const parts = ["admin", "finance", "bank-accounts"], input = { expectedVersion: 1, reason: " Fixture ", evidenceNote: " Synthetic evidence " };
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
const req = (method: string, body: unknown = input, headers: Record<string, string> = {}) => new NextRequest(`${origin}/api/management/admin/finance/bank-accounts?page=2&limit=20`, {
  method, headers: { origin, authorization: "Bearer fixture", "content-type": "application/json", "idempotency-key": "same-key", ...headers },
  ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
});
beforeEach(() => { vi.stubEnv("FRONTEND_ORIGIN", origin); vi.stubEnv("BACKEND_API_URL", "http://backend.test/api/v1"); vi.stubEnv("BFF_PROXY_SECRET", "fixture-secret-at-least-32-characters"); vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Admin bank BFF", () => {
  it.each([parts, [...parts, id]].map(path => ({ path })))("allows exact read $path, no cookies and no store", async ({ path }) => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, message: "OK", data: [] }))); vi.stubGlobal("fetch", upstream);
    const response = await GET(req("GET", undefined, { cookie: "private-refresh" }), ctx(path));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, init] = upstream.mock.calls[0]; expect(url).toBe(`http://backend.test/api/v1/${path.join("/")}?page=2&limit=20`);
    expect(new Headers(init.headers).get("cookie")).toBeNull();
  });
  it.each(["verify", "reject"])("forwards %s evidence/version/key unchanged", async action => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, message: "OK", data: {} }))); vi.stubGlobal("fetch", upstream);
    expect((await POST(req("POST"), ctx([...parts, id, action]))).status).toBe(200);
    const [url, init] = upstream.mock.calls[0]; expect(url).toBe(`http://backend.test/api/v1/${parts.join("/")}/${id}/${action}`);
    expect(JSON.parse(init.body)).toEqual(input); expect(new Headers(init.headers).get("idempotency-key")).toBe("same-key");
  });
  it.each([{}, { ...input, reason: " " }, { ...input, evidenceNote: "x".repeat(501) }, { ...input, expectedVersion: -1 },
    { ...input, expectedVersion: 2147483647 }, { ...input, expectedVersion: 0.5 }, { ...input, status: "VERIFIED" }, { ...input, hostId: id }])("rejects forged body %j", async body => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await POST(req("POST", body), ctx([...parts, id, "verify"]))).status).toBe(400); expect(upstream).not.toHaveBeenCalled();
  });
  it("preserves Origin/Bearer/JSON guards", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream); const path = [...parts, id, "verify"];
    expect((await POST(req("POST", input, { origin: "https://evil.test" }), ctx(path))).status).toBe(403);
    expect((await POST(req("POST", input, { authorization: "" }), ctx(path))).status).toBe(401);
    expect((await POST(req("POST", input, { "content-type": "text/plain" }), ctx(path))).status).toBe(415); expect(upstream).not.toHaveBeenCalled();
  });
  it.each([{ method: "GET", path: [...parts, id, "verify"], handler: GET }, { method: "POST", path: parts, handler: POST },
    { method: "PUT", path: [...parts, id], handler: PUT }, { method: "DELETE", path: [...parts, id], handler: DELETE },
    { method: "POST", path: [...parts, id, "force-verify"], handler: POST }])("does not open $method $path", async ({ method, path, handler }) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await handler(req(method), ctx(path))).status).toBe(404); expect(upstream).not.toHaveBeenCalled();
  });
  it.each([403, 404, 409, 429, 503])("preserves backend %s and no auto retry", async status => {
    const body = { success: false, errorCode: "STALE_BANK_VERSION", message: "Fixture" };
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "retry-after": "60" } })); vi.stubGlobal("fetch", upstream);
    const response = await POST(req("POST"), ctx([...parts, id, "verify"])); expect(response.status).toBe(status); expect(await response.json()).toEqual(body);
    expect(response.headers.get("retry-after")).toBe(status === 429 ? "60" : null); expect(upstream).toHaveBeenCalledTimes(1);
  });
});
