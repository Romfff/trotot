import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { GET } from "../src/app/api/listings/[...path]/route";
import { PRESET_LOCATIONS, longTermSearchHref } from "@/lib/listing-locations";

const secret = "test-shared-bff-secret-0123456789-abcdef";
const fetchMock = vi.fn();
function call(path: string[], query = "", headers: Record<string, string> = {}) {
  return GET(new NextRequest(`https://frontend.test/api/listings/${path.join("/")}${query}`, { headers }), {
    params: Promise.resolve({ path }),
  });
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("BACKEND_API_URL", "https://backend.test/api/v1/");
  vi.stubEnv("BFF_PROXY_SECRET", secret);
  vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("maps home preset IDs and converts km to API meters without changing the price", () => {
  for (const location of PRESET_LOCATIONS) {
    const url = new URL(longTermSearchHref(location.id, "4000000", "3"), "https://frontend.test");
    expect(url.pathname).toBe("/thue-phong-tro");
    expect(url.searchParams.get("location")).toBe(location.id);
    expect(url.searchParams.get("maxPrice")).toBe("4000000");
    expect(url.searchParams.get("radius")).toBe("3000");
    expect(url.searchParams.has("poi")).toBe(false);
  }
  expect(longTermSearchHref("q1", "6000000", "1")).toContain("radius=1000");
});

it("forwards public search/envelope only, signs fixed upstream path and ignores client credentials/IP", async () => {
  const envelope = { success: true, data: [], meta: { page: 2, total: 0 } };
  fetchMock.mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 }));
  const result = await call(["properties", "long-term", "search"], "?minPrice=2000000&radius=3000&page=2", {
    authorization: "Bearer must-not-forward", cookie: "trotot_refresh=must-not-forward",
    "x-forwarded-for": "203.0.113.99", "x-trotot-client-ip": "203.0.113.99",
  });
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://backend.test/api/v1/properties/long-term/search?minPrice=2000000&radius=3000&page=2");
  const headers = new Headers(options.headers);
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("cookie")).toBeNull();
  expect(headers.get("x-trotot-client-ip")).toBe("");
  expect(headers.get("x-trotot-proxy-signature")).toBe(createHmac("sha256", secret)
    .update(`${headers.get("x-trotot-proxy-timestamp")}\nGET\n/api/v1/properties/long-term/search\n`).digest("hex"));
  expect(options.cache).toBe("no-store");
  expect(options.redirect).toBe("error");
  expect(await result.json()).toEqual(envelope);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(result.headers.get("set-cookie")).toBeNull();
});

it("only allows the existing catalog/search/detail paths, not Auth/Host/Admin or traversal", async () => {
  for (const path of [["auth", "me"], ["admin", "properties"], ["host", "properties"],
    ["properties", "id", "hide"], ["properties", ".."], ["properties", "../auth/me"], ["properties", "a\\b"]]) {
    expect((await call(path)).status).toBe(404);
  }
  expect(fetchMock).not.toHaveBeenCalled();
  for (const path of [["amenities"], ["properties", "phòng #?"]]) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] })));
    expect((await call(path)).status).toBe(200);
  }
  expect(fetchMock.mock.calls[1][0]).toBe("https://backend.test/api/v1/properties/ph%C3%B2ng%20%23%3F");
});

it("preserves backend 404/429/503 instead of replacing errors with fixture data", async () => {
  for (const status of [404, 429, 503]) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errorCode: "API_ERROR" }), { status }));
    const result = await call(["properties", "missing"]);
    expect(result.status).toBe(status);
    expect(await result.json()).toEqual({ success: false, errorCode: "API_ERROR" });
  }
});

it("contact alone forwards optional Bearer, never cookies, and preserves Retry-After", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errorCode: "RATE_LIMITED" }), { status: 429, headers: { "Retry-After": "60" } }));
  const response = await call(["properties", "sample", "contact"], "", { authorization: "Bearer valid.test.token", cookie: "private=secret", "x-forwarded-for": "203.0.113.90" });
  expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
  const headers = new Headers(fetchMock.mock.calls[0][1].headers);
  expect(headers.get("authorization")).toBe("Bearer valid.test.token");
  expect(headers.get("cookie")).toBeNull(); expect(headers.get("x-trotot-client-ip")).toBe("");
  expect(response.headers.get("cache-control")).toBe("no-store");
  for (const auth of ["Basic wrong", "Bearer", "Bearer " + "x".repeat(4097)]) expect((await call(["properties", "sample", "contact"], "", { authorization: auth })).status).toBe(401);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await call(["properties", "sample", "contact", "admin"])).status).toBe(404);
});

it("allows only public cost-estimate by slug, forwards usage without credentials, and preserves bounded Retry-After", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errorCode: "RATE_LIMITED" }), { status: 429, headers: { "Retry-After": "60" } }));
  const response = await call(["properties", "sample-slug", "cost-estimate"], "?electricityKwh=1.5&vehicles=2", { cookie: "private", authorization: "Bearer private" });
  expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
  expect(fetchMock.mock.calls[0][0]).toBe("https://backend.test/api/v1/properties/sample-slug/cost-estimate?electricityKwh=1.5&vehicles=2");
  const headers = new Headers(fetchMock.mock.calls[0][1].headers); expect(headers.has("cookie")).toBe(false); expect(headers.has("authorization")).toBe(false);
  for (const path of [["properties"], ["properties", "..", "cost-estimate"], ["properties", "a/b", "cost-estimate"], ["properties", "sample", "cost-estimate", "admin"]]) expect((await call(path)).status).toBe(404);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("homestay calendar/search/quote and catalog use public reads without guest credentials",async()=>{
  const id="00000000-0000-4000-8000-000000000001";
  for(const path of [["homestays","search"],["homestays","check-availability"],["homestays","synthetic-slug"],["homestays","units",id,"calendar"],["catalog","wards"]]){
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({success:true,data:{}})));
    expect((await call(path,"?month=2026-10",{cookie:"private",authorization:"Bearer private"})).status).toBe(200);
    const headers=new Headers(fetchMock.mock.calls.at(-1)![1].headers);expect(headers.has("authorization")).toBe(false);expect(headers.has("cookie")).toBe(false);
  }
  for(const path of [["homestays","units","------------------------------------","calendar"],["homestays","units",id,"bookings"],["homestays","../host/bookings"],["catalog","users"]])expect((await call(path)).status).toBe(404);
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

it("validates the configured edge IP; missing config/network/invalid JSON fail closed without secrets", async () => {
  vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-real-ip");
  expect((await call(["amenities"])).status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] })));
  expect((await call(["amenities"], "", { "x-real-ip": "203.0.113.8" })).status).toBe(200);
  expect(new Headers(fetchMock.mock.calls[0][1].headers).get("x-trotot-client-ip")).toBe("203.0.113.8");
  vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
  fetchMock.mockRejectedValueOnce(new Error("private network details"));
  expect((await call(["amenities"])).status).toBe(503);
  fetchMock.mockResolvedValueOnce(new Response("not JSON"));
  expect((await call(["amenities"])).status).toBe(503);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BACKEND_API_URL", "");
  fetchMock.mockClear();
  const result = await call(["amenities"]);
  expect(result.status).toBe(503);
  expect(JSON.stringify(await result.json())).not.toContain("private");
  expect(fetchMock).not.toHaveBeenCalled();
});
