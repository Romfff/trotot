import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT, DELETE } from "../src/app/api/management/[...path]/route";
const id = "00000000-0000-4000-8000-000000000001", origin = "http://localhost:3000";
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const request = (method = "GET", body: unknown = {}, headers: Record<string, string> = {}) => new NextRequest(`${origin}/api/management/conversations`, {
  method, headers: { authorization: "Bearer synthetic-token", ...(method !== "GET" ? { origin, "content-type": "application/json" } : {}), ...headers }, ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
});
beforeEach(() => { vi.stubEnv("FRONTEND_ORIGIN", origin); vi.stubEnv("BACKEND_API_URL", "https://backend.test/api/v1"); vi.stubEnv("BFF_PROXY_SECRET", "chat-bff-test-secret-at-least-32-characters"); vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", ""); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("S5 chat BFF, mock upstream", () => {
  it.each([[['conversations']], [['conversations', id, 'messages']], [['conversations', 'unread']]])("forwards the exact private GET %j without cookies", async path => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }))); vi.stubGlobal("fetch", fetch);
    const response = await GET(request("GET", {}, { cookie: "private-cookie" }), context(path));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch.mock.calls[0][0]).toBe(`https://backend.test/api/v1/${path.join("/")}`);
    expect(new Headers(fetch.mock.calls[0][1].headers).get("cookie")).toBeNull(); expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each([[['conversations'], { propertyId: id }], [['conversations', id, 'messages'], { clientMessageId: id, text: ' Message fixture ' }], [['conversations', id, 'read'], {messageId:id}]])("forwards only approved POST mapping %j", async (path, body) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { id } }), { status: 201 })); vi.stubGlobal("fetch", fetch);
    expect((await POST(request("POST", body), context(path as string[]))).status).toBe(201);
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(body)); expect(fetch.mock.calls[0][1].redirect).toBe("error");
  });
  it.each([{}, {messageId:'bad'}, {messageId:id,userId:id}])("rejects forged read cursors %j", async body => {
    const fetch = vi.fn();vi.stubGlobal('fetch',fetch);
    expect((await POST(request('POST',body),context(['conversations',id,'read']))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ propertyId: id, hostId: id }, { propertyId: ".." }, { propertyId: 1 }, {}])("rejects participant injection/invalid create %j", async body => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect((await POST(request("POST", body), context(["conversations"]))).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ text: " " }, { text: "x".repeat(3001) }, { text: 12 }, { clientMessageId: ".." }, { senderId: id }])("rejects forged message %j", async bad => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect((await POST(request("POST", { clientMessageId: id, text: "fixture", ...bad }), context(["conversations", id, "messages"]))).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks unauthenticated, cross-origin, other paths/methods before upstream", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await GET(request("GET", {}, { authorization: "" }), context(["conversations"]))).status).toBe(401);
    expect((await POST(request("POST", { propertyId: id }, { origin: "https://evil.test" }), context(["conversations"]))).status).toBe(403);
    for (const method of [PUT, DELETE]) expect((await method(request("POST"), context(["conversations", id, "messages"]))).status).toBe(404);
    for (const path of [["conversations", id], ["conversations", "..", "messages"], ["host", "conversations"]]) expect((await GET(request(), context(path))).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 429, 503])("preserves server failure %i without automatic message replay", async status => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, errorCode: "CHAT_ERROR", message: "Fixture" }), { status, headers: { "Retry-After": "60" } })); vi.stubGlobal("fetch", fetch);
    const response = await POST(request("POST", { clientMessageId: id, text: "fixture" }), context(["conversations", id, "messages"])); expect(response.status).toBe(status); expect(fetch).toHaveBeenCalledOnce();
    if (status === 429) expect(response.headers.get("retry-after")).toBe("60");
  });
});
