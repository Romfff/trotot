import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { GET, POST, PUT, DELETE } from "../src/app/api/management/[...path]/route";

const origin = "http://localhost:3000", id = "00000000-0000-4000-8000-000000000001";
const bank = ["host", "bank-account"], notice = ["host", "bank-notifications", id, "read"];
const input = { expectedVersion: 0, bankCode: "FIXTURE", accountNumber: "1234567890", accountName: "Synthetic only" };
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
function request(method: string, body: unknown = input, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/management/host/bank-account?page=2&limit=20`, {
    method, headers: { origin, authorization: "Bearer fixture-access", "content-type": "application/json", "idempotency-key": "bank-same-key", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.stubEnv("FRONTEND_ORIGIN", origin); vi.stubEnv("BACKEND_API_URL", "http://backend.test/api/v1");
  vi.stubEnv("BFF_PROXY_SECRET", "finance-test-secret-0123456789abcdef"); vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("S4 Host financial BFF allowlist", () => {
  it.each([
    {path:["admin","finance","settlements"],body:{hostId:id,reason:"Synthetic"}},
    {path:["admin","finance","settlements",id,"reverse"],body:{reason:"Synthetic"}},
    {path:["admin","finance","bookings",id,"late-refund-cases"],body:{expectedVersion:7,reason:"Synthetic",evidenceNote:"Private fixture"}},
  ])("forwards approved financial POST $path and rejects extra fields or foreign Origin",async({path,body})=>{
    const upstream=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,message:"Synthetic",data:{}})));vi.stubGlobal("fetch",upstream);
    expect((await POST(request("POST",body),context(path))).status).toBe(200);
    expect(JSON.parse(upstream.mock.calls[0][1].body)).toEqual(body);
    expect(new Headers(upstream.mock.calls[0][1].headers).get("idempotency-key")).toBe("bank-same-key");
    expect((await POST(request("POST",{...body,amount:"1"}),context(path))).status).toBe(400);
    expect((await POST(request("POST",body,{origin:"https://foreign.test"}),context(path))).status).toBe(403);
    expect(upstream).toHaveBeenCalledOnce();
  });
  it("forwards monthly year through the private signed GET without refresh cookies", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, message: "Synthetic", data: {} })));
    vi.stubGlobal("fetch", upstream);
    const response = await GET(new NextRequest(`${origin}/api/management/host/finance/revenue?year=2026`, { headers: { authorization: "Bearer fixture-access", cookie: "private-refresh" } }), context(["host", "finance", "revenue"]));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, init] = upstream.mock.calls[0];expect(url).toBe("http://backend.test/api/v1/host/finance/revenue?year=2026");
    const headers = new Headers(init.headers);expect(headers.get("cookie")).toBeNull();expect(init.cache).toBe("no-store");
    expect(headers.get("x-trotot-proxy-signature")).toBe(createHmac("sha256", process.env.BFF_PROXY_SECRET!).update(`${headers.get("x-trotot-proxy-timestamp")}\nGET\n/api/v1/host/finance/revenue\n`).digest("hex"));
    expect((await POST(request("POST", {}), context(["host", "finance", "revenue"]))).status).toBe(404);
    expect(upstream).toHaveBeenCalledOnce();
  });
  it.each([bank, ["host", "finance"], ["host", "finance", "transactions"], ["host", "finance", "debts"], ["host", "finance", "settlements"], ["host", "bank-notifications"], ["host", "payout-notifications"]].map(parts => ({ parts })))("forwards only approved private GET $parts and pagination, without cookies or cache", async ({ parts }) => {
    const envelope = { success: true, data: [], meta: { page: 2, limit: 20, unreadCount: 4 } };
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope)));
    vi.stubGlobal("fetch", upstream);
    const response = await GET(request("GET", undefined, { cookie: "refresh-stays-private" }), context(parts));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(envelope);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("set-cookie")).toBeNull();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(`http://backend.test/api/v1/${parts.join("/")}?page=2&limit=20`);
    expect(new Headers(init.headers).get("cookie")).toBeNull(); expect(init.cache).toBe("no-store");
  });
  it("forwards exact input/version zero/key and signed PUT without granting verified status", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { version: 1, payoutReady: false } })));
    vi.stubGlobal("fetch", upstream);
    expect((await PUT(request("PUT"), context(bank))).status).toBe(200);
    const [url, init] = upstream.mock.calls[0], headers = new Headers(init.headers);
    expect(url).toBe("http://backend.test/api/v1/host/bank-account"); expect(JSON.parse(init.body)).toEqual(input);
    expect(headers.get("idempotency-key")).toBe("bank-same-key"); expect(headers.get("authorization")).toBe("Bearer fixture-access");
    expect(headers.get("x-trotot-proxy-signature")).toBe(createHmac("sha256", process.env.BFF_PROXY_SECRET!).update(`${headers.get("x-trotot-proxy-timestamp")}\nPUT\n/api/v1/host/bank-account\n`).digest("hex"));
  });
  it("does not invent an idempotency key when it is missing; backend rejects it", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, errorCode: "INVALID_IDEMPOTENCY_KEY" }), { status: 400 }));
    vi.stubGlobal("fetch", upstream);
    expect((await PUT(request("PUT", input, { "idempotency-key": "" }), context(bank))).status).toBe(400);
    expect(new Headers(upstream.mock.calls[0][1].headers).get("idempotency-key")).toBeNull();
  });
  it.each([
    {}, { ...input, expectedVersion: -1 }, { ...input, expectedVersion: 0.5 }, { ...input, expectedVersion: 2147483647 },
    { ...input, hostId: id }, { ...input, status: "VERIFIED" }, { ...input, payoutReady: true },
    { ...input, bankCode: "" }, { ...input, bankCode: "x".repeat(21) }, { ...input, bankCode: "../bank" },
    { ...input, accountNumber: "" }, { ...input, accountNumber: 1234 }, { ...input, accountNumber: "12 34" },
    { ...input, accountNumber: "1".repeat(51) }, { ...input, accountName: " " }, { ...input, accountName: "x".repeat(151) },
  ])("rejects forged/malformed bank input %j before upstream", async payload => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await PUT(request("PUT", payload), context(bank))).status).toBe(400); expect(upstream).not.toHaveBeenCalled();
  });
  it("allows bank normalization at backend and does not silently rewrite retry payload", async () => {
    const payload = { ...input, bankCode: " fixture ", accountName: " Synthetic only " };
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} })));
    vi.stubGlobal("fetch", upstream);
    expect((await PUT(request("PUT", payload), context(bank))).status).toBe(200);
    expect(JSON.parse(upstream.mock.calls[0][1].body)).toEqual(payload);
  });
  it.each([notice, ["host", "payout-notifications", id, "read"]].map(parts => ({ parts })))("allows read receipt empty body only, without forwarding a write retry key $parts", async ({ parts }) => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} })));
    vi.stubGlobal("fetch", upstream);
    expect((await POST(request("POST", {}), context(parts))).status).toBe(200);
    expect(new Headers(upstream.mock.calls[0][1].headers).get("idempotency-key")).toBeNull();
    expect((await POST(request("POST", { recipientId: id }), context(parts))).status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it.each([
    { handler: POST, method: "POST", parts: bank }, { handler: DELETE, method: "DELETE", parts: bank },
    { handler: PUT, method: "PUT", parts: ["host", "finance"] }, { handler: POST, method: "POST", parts: ["host", "finance", "withdraw"] },
    { handler: GET, method: "GET", parts: ["host", "finance", "complaints", id, "export"] }, { handler: GET, method: "GET", parts: ["host", "payouts", id, "export"] },
    { handler: GET, method: "GET", parts: notice }, { handler: POST, method: "POST", parts: ["host", "bank-notifications", "../other", "read"] },
    { handler: POST, method: "POST", parts: ["host", "payout-notifications"] }, { handler: GET, method: "GET", parts: ["host", "payout-notifications", id] },
    { handler: PUT, method: "PUT", parts: ["host", "payout-notifications", id, "read"] }, { handler: DELETE, method: "DELETE", parts: ["host", "payout-notifications", id, "read"] },
    { handler: POST, method: "POST", parts: ["host", "payout-notifications", "invalid", "read"] },
  ])("does not open extra financial routes $method $parts", async ({ handler, method, parts }) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await handler(request(method), context(parts))).status).toBe(404); expect(upstream).not.toHaveBeenCalled();
  });
  it("enforces bearer/Origin/JSON and signed proxy configuration for financial routes", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await GET(request("GET", undefined, { authorization: "" }), context(bank))).status).toBe(401);
    expect((await PUT(request("PUT", input, { origin: "https://evil.test" }), context(bank))).status).toBe(403);
    expect((await POST(request("POST", {}, { origin: "" }), context(notice))).status).toBe(403);
    expect((await PUT(request("PUT", input, { "content-type": "text/plain" }), context(bank))).status).toBe(415);
    vi.stubEnv("BFF_PROXY_SECRET", "");
    expect((await GET(request("GET"), context(bank))).status).toBe(503); expect(upstream).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 409, 429, 503])("preserves backend %s error/version and Retry-After without retry", async status => {
    const envelope = { success: false, errorCode: "STALE_BANK_VERSION", data: { version: 3 } };
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status, headers: { "retry-after": "60" } }));
    vi.stubGlobal("fetch", upstream);
    const response = await PUT(request("PUT"), context(bank));
    expect(response.status).toBe(status); expect(await response.json()).toEqual(envelope);
    expect(response.headers.get("retry-after")).toBe(status === 429 ? "60" : null); expect(upstream).toHaveBeenCalledTimes(1);
  });
});
